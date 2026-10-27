import Foundation
import Observation
import SwiftUI
import To3matoCloud
import To3matoCore

/// 화면 상태와 명령 창구. 규칙은 To3matoCore의 Domain과 SyncEngine이 처리한다.
/// 연동하지 않으면 기기 파일에, 연동하면 계정 저장소와 Supabase에 기록한다.
@MainActor
@Observable
final class AppModel {
  static let maxTaskEstimate = Domain.maxTaskEstimate
  static let maxBatchSize = 500

  var state = AppState() {
    didSet {
      if state.timer != oldValue.timer {
        liveActivity.sync(self)
        notifications.sync(self)
      }
    }
  }
  var now = Date.now
  var account = AccountState()
  var clips: [Clip] = []
  var deliveries: [Delivery] = []

  // 화면 상태
  var tab: AppTab = .todo
  var runSheetOpen = false
  var reviewOpen = false
  var planOpen = false
  var toast: String?

  @ObservationIgnored private let liveActivity = LiveActivityController()
  @ObservationIgnored private let notifications = NotificationScheduler()
  @ObservationIgnored private let localStore = LocalStore(url: AppPaths.localState)
  @ObservationIgnored private var cloud: CloudAccount?
  @ObservationIgnored private var engine: SyncEngine?
  @ObservationIgnored private var repository: FileEnvelopeRepository?
  @ObservationIgnored private var syncClock = SyncClock()
  /// 계정 저장소를 보여주는 중인지. 연동을 꺼도 로그인 상태면 계정 데이터를 보여준다(Mac과 같음).
  @ObservationIgnored private var active = false
  @ObservationIgnored private var advancing = false

  // MARK: 파생 값

  var tasks: [TaskItem] { state.tasks }
  var projects: [Project] { state.projects }
  var records: [FocusRecord] { state.records }
  var tickets: [Ticket] { state.tickets }
  var templates: [TaskTemplate] { state.templates }
  var timer: TimerState? { state.timer }
  var settings: Settings { state.settings }

  /// 명령에 쓰는 현재 시각(ms). 연동 중에는 서버 시간으로 보정한다.
  var nowMs: Double { active ? syncClock.now() : epochMilliseconds(now) }

  var today: String { Domain.localDate(Date(timeIntervalSince1970: nowMs / 1000)) }

  func sections() -> [TodoSection] { Domain.todoSections(tasks, today: today) }

  var todayTasks: [TaskItem] { tasks.filter { $0.date == today } }
  var pendingToday: [TaskItem] { todayTasks.filter { !$0.done } }

  func used(_ taskId: String) -> Double { Domain.usedPomodoros(state, taskId) }

  func doneOn(_ date: String) -> Double {
    records.filter { Domain.localDate($0.date) == date }.reduce(0) { $0 + $1.pomodoros }
  }

  func allocated(on date: String) -> Int {
    tasks.filter { $0.date == date }.reduce(0) { $0 + $1.estimate }
  }

  func project(_ id: String) -> Project? { projects.first { $0.id == id } }

  var timerTask: TaskItem? { tasks.first { $0.id == timer?.taskId } }

  var elapsed: Double { timer.map { Domain.elapsedSeconds($0, nowMs) } ?? 0 }

  var remainingSeconds: Int {
    Int(max(0, ((timer?.duration ?? settings.focus) - elapsed).rounded(.up)))
  }

  var clock: String {
    String(format: "%02d:%02d", remainingSeconds / 60, remainingSeconds % 60)
  }

  var timerStatus: String { Domain.timerStatus(timer) }

  func isCurrent(_ task: TaskItem) -> Bool {
    timer?.phase != .rest && timer?.taskId == task.id
  }

  func summary(_ projectId: String) -> ProjectSummary {
    let own = tasks.filter { $0.project == projectId }
    let open = own.filter { !$0.done }
    let used = own.reduce(0) { $0 + self.used($1.id) }
    let remaining = open.reduce(0) { $0 + $1.remaining }
    let issued = tickets.filter { $0.projectId == projectId && !$0.voided }
    return ProjectSummary(
      tickets: issued.count, left: open.count, used: used, remaining: remaining,
      progress: used + Double(remaining) > 0 ? used / (used + Double(remaining)) : 0,
      recent: Array(issued.suffix(2).reversed()))
  }

  func ticketWeeks(_ projectId: String) -> [TicketWeek] {
    var weeks: [TicketWeek] = []
    for ticket in tickets.filter({ $0.projectId == projectId }).sorted(by: { $0.completedAt > $1.completedAt }) {
      let start = Day.weekStart(ticket.completedDate)
      let id = Day.key(start)
      if let index = weeks.firstIndex(where: { $0.id == id }) {
        weeks[index].tickets.append(ticket)
      } else {
        let last = Day.calendar.date(byAdding: .day, value: 6, to: start) ?? start
        weeks.append(TicketWeek(id: id, label: "\(Day.short(start)) ~ \(Day.short(last))", tickets: [ticket]))
      }
    }
    return weeks
  }

  func sevenDayAverage() -> String {
    let total = (1...7).reduce(0.0) { $0 + doneOn(Day.offset(-$1, from: today)) }
    let value = (total / 7 * 10).rounded() / 10
    return value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
  }

  // MARK: 시작

  func start() {
    do {
      state = try localStore.load()
      if !localStore.exists { try localStore.save(state) }
    } catch {
      notify(error.localizedDescription)
    }
    applyLaunchArguments()
    Task { await restoreAccount() }
  }

  // MARK: 명령

  func notify(_ message: String) {
    toast = message
    let shown = message
    Task {
      try? await Task.sleep(for: .seconds(2.4))
      if toast == shown { toast = nil }
    }
  }

  /// 명령을 적용한다. 성공하면 success 문구를 알린다.
  func send(_ command: Command, success: String? = nil, then: (() -> Void)? = nil) {
    if active, let engine {
      Task {
        do {
          state = try await engine.dispatch(command)
          if let success { notify(success) }
          then?()
        } catch {
          notify(error.localizedDescription)
        }
      }
      return
    }
    do {
      state = try Domain.applyCommand(state, command, now: nowMs)
      try localStore.save(state)
      if let success { notify(success) }
      then?()
    } catch {
      notify(error.localizedDescription)
    }
  }

  func toggle(_ task: TaskItem) {
    send(Command("task:toggle", ["id": .string(task.id)]), success: task.done ? "완료를 취소했습니다." : "할 일을 완료했습니다.")
  }

  func setEstimate(_ task: TaskItem, _ estimate: Int) {
    guard estimate != task.estimate else { return }
    send(
      Command(
        "task:save",
        ["id": .string(task.id), "title": .string(task.title), "estimate": .number(Double(estimate)),
         "date": .string(task.date), "project": .string(task.project)]))
  }

  func move(_ taskId: String, to date: String) {
    guard let task = tasks.first(where: { $0.id == taskId }), task.date != date else { return }
    send(Command("task:move", ["id": .string(taskId), "date": .string(date)]), success: "예정일을 변경했습니다.")
  }

  func delete(_ taskId: String) {
    send(Command("task:delete", ["id": .string(taskId)]), success: "할 일을 삭제했습니다. 집중 기록은 유지됩니다.")
  }

  /// 한 날짜 목록 안에서 순서를 바꾼다. 앞에 놓을 할 일을 기준으로 옮긴다.
  func reorder(on date: String, from source: IndexSet, to destination: Int) {
    let ordered = tasks.filter { $0.date == date }
    guard let from = source.first, ordered.indices.contains(from) else { return }
    let moved = ordered[from]
    var before = ""
    if destination < ordered.count {
      before = ordered[destination].id
    } else if let last = ordered.last, let index = tasks.firstIndex(where: { $0.id == last.id }) {
      before = tasks[(index + 1)...].first { $0.id != moved.id }?.id ?? ""
    }
    guard before != moved.id else { return }
    send(Command("task:reorder", ["id": .string(moved.id), "before": .string(before)]))
  }

  func addTask(title: String, estimate: Int = 1, date: String, project: String = "") {
    send(
      Command(
        "task:save",
        ["title": .string(title), "estimate": .number(Double(estimate)), "date": .string(date), "project": .string(project)]),
      success: "할 일을 추가했습니다.")
  }

  /// 새 할 일이면 추가, 있으면 수정. remaining은 사용자가 바꿨을 때만 보낸다.
  func save(_ task: TaskItem, remaining: Int? = nil) {
    let existing = tasks.contains { $0.id == task.id }
    var payload: [String: JSON] = [
      "title": .string(task.title), "estimate": .number(Double(task.estimate)), "date": .string(task.date),
      "project": .string(task.project),
    ]
    if existing { payload["id"] = .string(task.id) }
    if let remaining { payload["remaining"] = .number(Double(remaining)) }
    send(Command("task:save", payload), success: existing ? "할 일을 수정했습니다." : "할 일을 추가했습니다.")
  }

  func addBatch(_ items: [TaskItem], project: String) {
    send(
      Command(
        "task:batch",
        ["project": .string(project),
         "tasks": .array(items.map { ["title": .string($0.title), "estimate": .number(Double($0.estimate)), "date": .string($0.date)] })]),
      success: "할 일을 추가했습니다.")
  }

  func apply(_ template: TaskTemplate, date: String, project: String) {
    send(Command("template:apply", ["id": .string(template.id), "date": .string(date), "project": .string(project)]))
  }

  func saveTemplate(id: String?, name: String, steps: [TemplateStep], then: (() -> Void)? = nil) {
    var payload: [String: JSON] = [
      "name": .string(name),
      "steps": .array(steps.map { ["title": .string($0.title), "estimate": .number(Double($0.estimate))] }),
    ]
    if let id, !id.isEmpty { payload["id"] = .string(id) }
    send(Command("template:save", payload), then: then)
  }

  func setCapacity(_ value: Int) {
    guard (1...16).contains(value) else { return }
    send(Command("settings:save", ["dailyCapacity": .number(Double(value))]))
  }

  func saveSettings(_ payload: [String: JSON]) {
    send(Command("settings:save", payload))
  }

  /// "HH:mm" 설정을 시각으로 다룬다. nil이면 알림을 쓰지 않는다.
  func timeSetting(_ key: String) -> Date? {
    let value = key == "planAt" ? settings.planAt : settings.reviewAt
    let parts = value.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 2 else { return nil }
    return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: .now)
  }

  func setTimeSetting(_ key: String, _ date: Date?) {
    let value = date.map {
      let parts = Calendar.current.dateComponents([.hour, .minute], from: $0)
      return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    } ?? ""
    saveSettings([key: .string(value)])
  }

  var remindDays: Set<Int> {
    get { Set(settings.remindDays) }
    set { saveSettings(["remindDays": .array(newValue.sorted().map { .number(Double($0)) })]) }
  }

  func updateTicket(_ id: String, _ fields: [String: JSON]) {
    send(Command("ticket:update", fields.merging(["id": .string(id)]) { $1 }))
  }

  // MARK: 타이머

  func tick(_ date: Date) {
    now = date
    guard let timer, timer.running, Domain.elapsedSeconds(timer, nowMs) >= timer.duration else { return }
    if active, let engine {
      guard !advancing else { return }
      advancing = true
      Task {
        defer { advancing = false }
        if let next = try? await engine.dispatch(Command("timer:advance")) {
          state = next
          if next.timer?.phase == .checkin { runSheetOpen = true }
        }
      }
      return
    }
    var next = state
    guard Domain.advanceTimer(&next, nowMs) else { return }
    state = next
    try? localStore.save(state)
    if next.timer?.phase == .checkin { runSheetOpen = true }
  }

  func play(_ taskId: String) {
    if let timer, timer.phase == .focus, timer.taskId == taskId, timer.running {
      toggleTimer()
      return
    }
    let before = records.count
    send(Command("timer:play", ["id": .string(taskId)])) { [weak self] in
      guard let self, self.records.count > before, let last = self.records.last else { return }
      self.notify("\(last.pomodoros.pomodoroText)포모도로 기록 · 새 타이머 시작")
    }
    notifications.requestPermission()
  }

  func toggleTimer() {
    guard let timer else {
      if let first = pendingToday.first { play(first.id) }
      return
    }
    send(Command(timer.phase == .checkin ? "checkin:skip" : "timer:toggle"))
  }

  func endTimer() {
    let rest = timer?.phase == .rest
    send(Command("timer:end"), success: rest ? "휴식 종료" : "집중 기록 저장 완료")
  }

  func checkinSave(remaining: Int) {
    send(Command("checkin:save", ["remaining": .number(Double(remaining))]))
  }

  func checkinDone() { send(Command("checkin:done"), success: "할 일을 완료했습니다.") }

  func checkinFollowUp() { send(Command("checkin:followup"), success: "할 일을 추가했습니다.") }

  // MARK: 프로젝트

  func saveProject(id: String?, name: String, outcome: String) {
    var payload: [String: JSON] = ["name": .string(name), "outcome": .string(outcome)]
    if let id { payload["id"] = .string(id) }
    send(Command("project:save", payload), success: id == nil ? "프로젝트를 추가했습니다." : "프로젝트를 수정했습니다.")
  }

  func deleteProject(_ id: String) {
    send(Command("project:delete", ["id": .string(id)]))
  }

  func setImage(_ data: Data?, for projectId: String) {
    guard let project = project(projectId) else { return }
    do {
      let name = try data.map(ProjectImages.store) ?? ""
      send(Command("project:save", ["id": .string(project.id), "name": .string(project.name), "image": .string(name)]))
    } catch {
      notify(error.localizedDescription)
    }
  }

  // MARK: 가져오기·내보내기

  /// Mac의 JSON 내보내기와 같은 모양. 데이터만 포함한다.
  func exportData() -> Data {
    (try? state.json.data()) ?? Data()
  }

  /// 연동 중에는 추가·갱신 명령으로만 반영하고, 파일에 없는 항목을 지우지 않는다.
  func importData(_ data: Data) {
    do {
      let raw = try JSON.parse(data)
      if active, let engine {
        Task {
          do {
            state = try await engine.importData(raw)
            notify("데이터를 가져왔습니다.")
          } catch {
            notify(error.localizedDescription)
          }
        }
        return
      }
      var next = try Domain.normalizeState(raw)
      next.settings.trayDisplay = state.settings.trayDisplay
      if let backup = try? state.json.data() {
        try? backup.write(to: AppPaths.root.appendingPathComponent("local-state-backup.json"), options: .atomic)
      }
      state = next
      try localStore.save(state)
      notify("데이터를 가져왔습니다.")
    } catch let error as DomainError {
      notify(error.message)
    } catch {
      notify("파일을 읽을 수 없습니다.")
    }
  }

  // MARK: 계정과 연동

  private func cloudAccount() throws -> CloudAccount {
    if let cloud { return cloud }
    guard let url = Bundle.main.url(forResource: "Supabase", withExtension: "plist"),
      let values = NSDictionary(contentsOf: url) as? [String: String],
      let config = try CloudConfig.make(url: values["url"], key: values["publishableKey"])
    else { throw DomainError("이 실행 환경에서는 계정 기능을 사용할 수 없습니다.") }
    let cloud = CloudAccount(config: config)
    self.cloud = cloud
    return cloud
  }

  private func restoreAccount() async {
    guard let cloud = try? cloudAccount() else { return }
    account.configured = true
    account.user = await cloud.restore()
    if let user = account.user, FileEnvelopeRepository.exists(root: AppPaths.root, owner: user.id) {
      try? connect(user: user, seed: nil)
      if let engine, repository?.read().enabled == true { await engine.syncNow() }
    }
    Task { [weak self] in
      for await user in cloud.changes {
        guard let self else { return }
        if self.account.user?.id != user?.id { self.account.user = user }
      }
    }
  }

  private func connect(user: AccountUser, seed: AppState?) throws {
    if repository?.owner == user.id, engine != nil { return }
    Task { [engine] in await engine?.destroy() }
    let repository = try FileEnvelopeRepository(root: AppPaths.root, owner: user.id, seed: seed ?? SyncProtocol.emptyState())
    let clock = SyncClock()
    let engine = SyncEngine(
      repository: repository, transport: try cloudAccount().transport(userId: user.id), clock: clock,
      onChange: { [weak self] state, document, _ in
        Task { @MainActor in
          guard let self, self.active else { return }
          try? CalendarTime.setZone(document.timeZone)
          self.state = state
        }
      },
      onStatus: { [weak self] status in
        Task { @MainActor in self?.apply(status) }
      })
    self.repository = repository
    self.engine = engine
    self.syncClock = clock
    active = true
    state = SyncProtocol.projectedState(repository.read())
    try? CalendarTime.setZone(repository.read().confirmed.timeZone)
    Task {
      await engine.start()
      apply(await engine.status())
    }
  }

  private func apply(_ status: SyncStatus) {
    account.enabled = status.enabled
    account.connection = status.connection
    account.pending = status.pending
    account.conflicts = status.conflicts
    if !status.error.isEmpty || account.error == "동기화하지 못했습니다. 연결 상태를 확인하세요." || account.error == "다시 로그인하세요." {
      account.error = status.error
    }
  }

  func requestLink(email: String) {
    Task {
      account.busy = true
      defer { account.busy = false }
      do {
        account.error = ""
        try await cloudAccount().requestLink(email: email.trimmingCharacters(in: .whitespaces))
        account.linkSent = true
      } catch {
        account.error = error.localizedDescription
      }
    }
  }

  /// 메일의 로그인 링크로 앱이 열렸다.
  func handle(_ url: URL) {
    guard url.scheme == "to3mato" else { return }
    Task {
      do {
        let previous = repository?.owner
        let wasEnabled = repository?.read().enabled == true
        if let engine { try? await engine.disable() }
        let user = try await cloudAccount().open(url)
        account.user = user
        account.linkSent = false
        account.error = ""
        if let previous, previous != user.id {
          await engine?.destroy()
          engine = nil
          repository = nil
          active = false
          state = (try? localStore.load()) ?? state
        } else if wasEnabled, let engine {
          try await engine.enable()
        }
        if FileEnvelopeRepository.exists(root: AppPaths.root, owner: user.id), repository == nil {
          try connect(user: user, seed: nil)
        }
      } catch {
        account.error = error.localizedDescription
      }
    }
  }

  /// 이 기기의 연동을 켠다. 로컬 데이터는 처음 연동한 계정 하나에만 옮겨진다.
  func enableSync() {
    guard let user = account.user else { return }
    Task {
      account.busy = true
      defer { account.busy = false }
      do {
        let binding = try? JSON.parse(Data(contentsOf: AppPaths.binding))
        let seed = binding == nil ? try localStore.load() : nil
        try connect(user: user, seed: seed)
        if binding == nil {
          try FileManager.default.createDirectory(at: AppPaths.root, withIntermediateDirectories: true)
          try JSON.object(["owner": .string(user.id)]).data().write(to: AppPaths.binding, options: .atomic)
        }
        try repository?.backup()
        try await engine?.enable()
      } catch {
        account.error = error.localizedDescription
      }
    }
  }

  func disableSync() {
    Task { try? await engine?.disable() }
  }

  func syncNow() {
    Task { await engine?.syncNow() }
  }

  func logout() {
    Task {
      if let engine {
        try? await engine.disable()
        await engine.destroy()
      }
      engine = nil
      repository = nil
      active = false
      await cloud?.logout()
      account.user = nil
      account.enabled = false
      account.connection = "off"
      account.pending = 0
      account.conflicts = []
      account.error = ""
      CalendarTime.zone = nil
      state = (try? localStore.load()) ?? Domain.createInitialState()
    }
  }

  func deleteAccount() {
    Task {
      do {
        try await cloudAccount().deleteAccount()
        logout()
      } catch {
        account.error = error.localizedDescription
      }
    }
  }

  func resolve(_ id: String, action: String) {
    Task {
      do { try await engine?.resolve(id, action: action) } catch { account.error = error.localizedDescription }
    }
  }

  /// 앱이 다시 앞으로 나왔을 때 서버 시간과 상태를 다시 맞춘다.
  func resume() {
    syncClock.resume()
    now = .now
    syncNow()
  }

  // MARK: 화면 확인용 실행 인자. 예: `-ui-tab calendar -ui-phase checkin`

  private func applyLaunchArguments() {
    let defaults = UserDefaults.standard
    switch defaults.string(forKey: "ui-tab") {
    case "projects": tab = .projects
    case "calendar": tab = .calendar
    case "log": tab = .log
    default: break
    }
    if let phase = defaults.string(forKey: "ui-phase"), let task = pendingToday.first ?? tasks.first(where: { !$0.done }) {
      let at = nowMs
      switch phase {
      case "focus":
        state.timer = TimerState(taskId: task.id, duration: settings.focus, elapsed: 600, startedAt: at, running: true, phase: .focus)
      case "checkin":
        state.timer = TimerState(taskId: task.id, duration: settings.focus, elapsed: settings.focus, startedAt: at, running: false, phase: .checkin)
        runSheetOpen = true
      case "rest":
        state.timer = TimerState(taskId: nil, duration: settings.rest, elapsed: 60, startedAt: at, running: true, phase: .rest)
      default: break
      }
    }
    if defaults.bool(forKey: "ui-run") { runSheetOpen = true }
    if defaults.bool(forKey: "ui-review") { reviewOpen = true }
  }
}

enum AppTab: Hashable {
  case todo, projects, calendar, log
}
