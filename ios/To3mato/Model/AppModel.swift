import Foundation
import Observation
import SwiftUI

/// UI 단계의 메모리 상태. 저장, 도메인 규칙, 동기화는 다음 단계에서 Mac의 domain.mjs와 같은 규칙으로 옮긴다.
/// 여기의 동작은 화면 확인에 필요한 만큼만 흉내 낸다.
@Observable
final class AppModel {
  static let maxTaskEstimate = 2
  static let maxBatchSize = 500

  var settings = Settings()
  var projects: [Project] = []
  var tasks: [TaskItem] = []
  var records: [FocusRecord] = []
  var tickets: [Ticket] = []
  var templates: [TaskTemplate] = []
  var clips: [Clip] = []
  var deliveries: [Delivery] = []
  var timer: TimerState? {
    didSet { if timer != oldValue { liveActivity.sync(self) } }
  }
  var now = Date.now
  @ObservationIgnored private let liveActivity = LiveActivityController()

  // 화면 상태
  var tab: AppTab = .todo
  var runSheetOpen = false
  var reviewOpen = false
  var planOpen = false
  var toast: String?

  // MARK: 파생 값

  var today: String { Day.key(now) }

  func sections() -> [TodoSection] {
    let today = today
    let tomorrow = Day.offset(1, from: today)
    let dated = Set(tasks.map(\.date).filter { !$0.isEmpty })
    let upcoming = dated.filter { $0 > tomorrow }.sorted()
    let past = dated.filter { $0 < today }
      .filter { date in tasks.contains { $0.date == date && !$0.done } }
      .sorted(by: >)
    return ([today, tomorrow] + upcoming + past + [""]).map { date in
      let label: String
      if date.isEmpty {
        label = "미지정"
      } else if date == today {
        label = "오늘"
      } else if date == tomorrow {
        label = "내일"
      } else {
        let year = date.prefix(4) != today.prefix(4) ? "\(Int(date.prefix(4)) ?? 0)년 " : ""
        let month = Int(date.dropFirst(5).prefix(2)) ?? 0
        let day = Int(date.suffix(2)) ?? 0
        label = "\(year)\(month)월 \(day)일"
      }
      return TodoSection(date: date, label: label, tasks: tasks.filter { $0.date == date })
    }
  }

  var todayTasks: [TaskItem] { tasks.filter { $0.date == today } }
  var pendingToday: [TaskItem] { todayTasks.filter { !$0.done } }

  func used(_ taskId: String) -> Double {
    records.filter { $0.taskId == taskId }.reduce(0) { $0 + $1.pomodoros }
  }

  func doneOn(_ date: String) -> Double {
    records.filter { Day.key($0.at) == date }.reduce(0) { $0 + $1.pomodoros }
  }

  func allocated(on date: String) -> Int {
    tasks.filter { $0.date == date }.reduce(0) { $0 + $1.estimate }
  }

  func project(_ id: String) -> Project? { projects.first { $0.id == id } }

  var timerTask: TaskItem? { tasks.first { $0.id == timer?.taskId } }

  var elapsed: Double { timer?.elapsedSeconds(at: now) ?? 0 }

  var remainingSeconds: Int {
    Int(max(0, ((timer?.duration ?? settings.focus) - elapsed).rounded(.up)))
  }

  var clock: String {
    String(format: "%02d:%02d", remainingSeconds / 60, remainingSeconds % 60)
  }

  /// Mac의 timerMenuState() 상태 문구
  var timerStatus: String {
    guard let timer else { return "집중 대기" }
    switch timer.phase {
    case .checkin: return "진척 확인"
    case .rest: return timer.running ? "휴식 중" : "휴식 대기"
    case .focus: return timer.running ? "집중 중" : "일시정지"
    }
  }

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
      let start = Day.weekStart(ticket.completedAt)
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
    let value = total / 7
    return value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
  }

  // MARK: 할 일

  func notify(_ message: String) {
    toast = message
    let shown = message
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(2.4))
      if self.toast == shown { self.toast = nil }
    }
  }

  func toggle(_ task: TaskItem) {
    guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
    tasks[index].done.toggle()
    if tasks[index].done {
      issueTicket(for: tasks[index])
      notify("할 일을 완료했습니다.")
    } else {
      if let ticket = tickets.lastIndex(where: { $0.taskId == task.id && !$0.voided }) {
        tickets[ticket].voided = true
      }
      notify("완료를 취소했습니다.")
    }
  }

  func setEstimate(_ task: TaskItem, _ estimate: Int) {
    guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
    tasks[index].estimate = estimate
    tasks[index].remaining = estimate
  }

  func move(_ taskId: String, to date: String) {
    guard let index = tasks.firstIndex(where: { $0.id == taskId }), tasks[index].date != date else { return }
    tasks[index].date = date
    notify("예정일을 변경했습니다.")
  }

  func delete(_ taskId: String) {
    tasks.removeAll { $0.id == taskId }
    if timer?.taskId == taskId { timer = nil }
    notify("할 일을 삭제했습니다. 집중 기록은 유지됩니다.")
  }

  /// 오늘 목록의 순서를 바꾼다. 다른 날짜의 할 일 위치는 그대로 둔다.
  func reorder(on date: String, from source: IndexSet, to destination: Int) {
    var ordered = tasks.filter { $0.date == date }
    ordered.move(fromOffsets: source, toOffset: destination)
    var iterator = ordered.makeIterator()
    tasks = tasks.map { $0.date == date ? (iterator.next() ?? $0) : $0 }
  }

  @discardableResult
  func addTask(title: String, estimate: Int = 1, date: String, project: String = "") -> String {
    let id = UUID().uuidString
    tasks.append(
      TaskItem(
        id: id, title: title.trimmingCharacters(in: .whitespaces), estimate: estimate,
        remaining: estimate, project: project, date: date))
    return id
  }

  func save(_ task: TaskItem) {
    if let index = tasks.firstIndex(where: { $0.id == task.id }) {
      tasks[index] = task
      notify("할 일을 수정했습니다.")
    } else {
      tasks.append(task)
      notify("할 일을 추가했습니다.")
    }
  }

  func addBatch(_ items: [TaskItem]) {
    tasks.append(contentsOf: items)
  }

  func apply(_ template: TaskTemplate, date: String, project: String) {
    for step in template.steps {
      addTask(title: step.title.replacingOccurrences(of: "%n%", with: "1"), estimate: step.estimate, date: date, project: project)
    }
  }

  func setCapacity(_ value: Int) {
    settings.dailyCapacity = min(16, max(1, value))
  }

  private func issueTicket(for task: TaskItem) {
    tickets.append(
      Ticket(
        id: UUID().uuidString, taskId: task.id, title: task.title, projectId: task.project,
        completedAt: now, estimate: task.estimate, used: used(task.id)))
  }

  // MARK: 타이머

  func tick(_ date: Date) {
    now = date
    guard var current = timer, current.running, current.elapsedSeconds(at: date) >= current.duration else { return }
    switch current.phase {
    case .focus:
      record(current, seconds: current.duration, pomodoros: 1)
      current.elapsed = current.duration
      current.running = false
      current.phase = .checkin
      timer = current
      runSheetOpen = true
    case .rest:
      timer = nil
    case .checkin:
      break
    }
  }

  func play(_ taskId: String) {
    if let current = timer, current.phase == .focus, current.taskId == taskId {
      toggleTimer()
      return
    }
    if let current = timer, current.phase == .focus, current.taskId != nil {
      let seconds = current.elapsedSeconds(at: now)
      let pomodoros = rounded(seconds / current.duration)
      record(current, seconds: seconds, pomodoros: pomodoros)
      if pomodoros > 0 { notify("\(pomodoros.pomodoroText)포모도로 기록 · 새 타이머 시작") }
    }
    timer = TimerState(
      taskId: taskId, duration: settings.focus, elapsed: 0, startedAt: now, running: true, phase: .focus)
  }

  func toggleTimer() {
    guard var current = timer else {
      if let first = pendingToday.first { play(first.id) }
      return
    }
    if current.running {
      current.elapsed = current.elapsedSeconds(at: now)
      current.running = false
    } else {
      current.startedAt = now
      current.running = true
    }
    timer = current
  }

  func endTimer() {
    guard let current = timer else { return }
    if current.phase == .focus {
      let seconds = current.elapsedSeconds(at: now)
      record(current, seconds: seconds, pomodoros: rounded(seconds / current.duration))
      notify("집중 기록 저장 완료")
    } else {
      notify("휴식 종료")
    }
    timer = nil
  }

  func checkinSave(remaining: Int) {
    guard let id = timer?.taskId, let index = tasks.firstIndex(where: { $0.id == id }) else { return }
    tasks[index].remaining = remaining
    startRest()
  }

  func checkinDone() {
    guard let id = timer?.taskId, let index = tasks.firstIndex(where: { $0.id == id }) else { return }
    tasks[index].done = true
    issueTicket(for: tasks[index])
    notify("할 일을 완료했습니다.")
    startRest()
  }

  func checkinFollowUp() {
    guard let id = timer?.taskId, let index = tasks.firstIndex(where: { $0.id == id }) else { return }
    tasks[index].done = true
    issueTicket(for: tasks[index])
    var next = tasks[index]
    next.id = UUID().uuidString
    next.done = false
    next.followUpOf = id
    next.estimate = 1
    next.remaining = 1
    next.date = today
    tasks.append(next)
    notify("할 일을 추가했습니다.")
    startRest()
  }

  private func startRest() {
    timer = TimerState(
      taskId: timer?.taskId, duration: settings.rest, elapsed: 0, startedAt: now, running: true, phase: .rest)
  }

  private func record(_ timer: TimerState, seconds: Double, pomodoros: Double) {
    guard let taskId = timer.taskId else { return }
    records.append(
      FocusRecord(
        id: UUID().uuidString, taskId: taskId, seconds: seconds, pomodoros: pomodoros,
        duration: timer.duration, at: now))
  }

  /// 작업 전환 시 0 / 0.5 / 1포모도로로 반올림한다.
  private func rounded(_ ratio: Double) -> Double {
    ratio >= 0.75 ? 1 : ratio >= 0.25 ? 0.5 : 0
  }

  // MARK: 프로젝트

  func saveProject(id: String?, name: String, outcome: String) {
    if let id, let index = projects.firstIndex(where: { $0.id == id }) {
      projects[index].name = name
      projects[index].outcome = outcome
      notify("프로젝트를 수정했습니다.")
    } else {
      let colors = ["#d08c6f", "#84956c", "#b49b65"]
      let icons = ["folder", "book", "leaf"]
      projects.append(
        Project(
          id: UUID().uuidString, name: name, icon: icons[projects.count % 3],
          color: colors[projects.count % 3], outcome: outcome))
      notify("프로젝트를 추가했습니다.")
    }
  }

  func deleteProject(_ id: String) {
    projects.removeAll { $0.id == id }
    for index in tasks.indices where tasks[index].project == id {
      tasks[index].project = ""
    }
  }

  func setImage(_ data: Data?, for projectId: String) {
    guard let index = projects.firstIndex(where: { $0.id == projectId }) else { return }
    projects[index].image = data
  }

  func decorate(_ ticketId: String, _ change: (inout Ticket) -> Void) {
    guard let index = tickets.firstIndex(where: { $0.id == ticketId }) else { return }
    change(&tickets[index])
  }
}

enum AppTab: Hashable {
  case todo, projects, calendar, log
}

extension AppModel {
  /// Mac의 createInitialState()와 같은 첫 데이터에 화면 확인용 기록을 더한다.
  static func sample(now: Date = .now) -> AppModel {
    let model = AppModel()
    let today = Day.key(now)
    model.projects = [
      Project(id: "p1", name: "사이드 프로젝트", icon: "folder", color: "#d08c6f"),
      Project(id: "p2", name: "디자인 학습", icon: "book", color: "#84956c"),
      Project(id: "p3", name: "독서", icon: "leaf", color: "#b49b65"),
    ]
    model.tasks = [
      TaskItem(id: "t1", title: "프로젝트 아이디어 정리", estimate: 2, remaining: 1, project: "p1", date: today),
      TaskItem(id: "t2", title: "디자인 강의 수강", estimate: 2, remaining: 2, project: "p2", date: today),
      TaskItem(id: "t3", title: "도서 읽기", estimate: 1, remaining: 0, project: "p3", date: today, done: true),
      TaskItem(id: "t4", title: "첫 화면 참고 자료 조사", estimate: 2, remaining: 2, project: "p1", date: Day.offset(1, from: today)),
      TaskItem(id: "t5", title: "주간 할 일 정리", estimate: 1, remaining: 1, project: "", date: ""),
    ]
    let hour: Double = 3600
    model.records = [
      FocusRecord(id: "r1", taskId: "t3", seconds: 1500, pomodoros: 1, duration: 1500, at: now.addingTimeInterval(-3 * hour)),
      FocusRecord(id: "r2", taskId: "t1", seconds: 1500, pomodoros: 1, duration: 1500, at: now.addingTimeInterval(-2 * hour)),
    ]
    model.tickets = [
      Ticket(
        id: "k1", taskId: "t3", title: "도서 읽기", projectId: "p3",
        completedAt: now.addingTimeInterval(-2.5 * hour), estimate: 1, used: 1, highlight: true, sticker: .star),
      Ticket(
        id: "k2", taskId: "t3-prev", title: "도서 읽기", projectId: "p3",
        completedAt: now.addingTimeInterval(-8 * 24 * hour), estimate: 1, used: 1.5),
    ]
    model.clips = [
      Clip(id: "c1", taskTitle: "도서 읽기", at: now.addingTimeInterval(-2.5 * hour)),
      Clip(id: "c2", taskTitle: "프로젝트 아이디어 정리", at: now.addingTimeInterval(-1.5 * hour)),
    ]
    let lastWeek = Day.calendar.date(byAdding: .day, value: -7, to: Day.weekStart(now)) ?? now
    model.deliveries = [
      Delivery(
        id: Day.key(lastWeek), start: lastWeek, end: Day.weekStart(now), clipCount: 6, duration: 18000,
        seen: false)
    ]
    model.planOpen = true
    model.now = now
    model.applyLaunchArguments()
    return model
  }

  /// 화면 확인용 실행 인자. 예: `-ui-tab calendar -ui-phase checkin`
  private func applyLaunchArguments() {
    let defaults = UserDefaults.standard
    switch defaults.string(forKey: "ui-tab") {
    case "projects": tab = .projects
    case "calendar": tab = .calendar
    case "log": tab = .log
    default: break
    }
    switch defaults.string(forKey: "ui-phase") {
    case "focus":
      timer = TimerState(taskId: "t1", duration: settings.focus, elapsed: 600, startedAt: now, running: true, phase: .focus)
    case "checkin":
      timer = TimerState(taskId: "t2", duration: settings.focus, elapsed: settings.focus, startedAt: now, running: false, phase: .checkin)
      runSheetOpen = true
    case "rest":
      timer = TimerState(taskId: "t1", duration: settings.rest, elapsed: 60, startedAt: now, running: true, phase: .rest)
    default: break
    }
    if defaults.bool(forKey: "ui-run") { runSheetOpen = true }
    if defaults.bool(forKey: "ui-review") { reviewOpen = true }
  }
}
