import Foundation

/// Mac의 src/lib/domain.mjs. 화면은 명령만 보내고 규칙은 여기서 처리한다.
public enum Domain {
  public static let maxTaskEstimate = 2
  public static let maxLegacyEstimate = 48
  public static let ticketStickers = ["", "star", "heart", "leaf"]
  public static let defaultRemindDays = [1, 2, 3, 4, 5]
  public static let defaultDailyCapacity = 8
  public static let maxTemplateSteps = 20
  public static let maxTemplates = 500
  static let taskLimitError = "한 번에 1~500개의 할 일을 추가할 수 있습니다. 전체 한도는 20,000개입니다."

  public static func localDate(_ date: Date = .now) -> String { CalendarTime.dateInZone(date) }

  public static func offsetDate(_ offset: Int, _ base: String = localDate()) -> String {
    CalendarTime.shiftDay(base, offset)
  }

  public static func createInitialState(date: String = localDate()) -> AppState {
    var state = AppState()
    state.projects = [
      Project(id: "p1", name: "사이드 프로젝트", icon: "folder", color: "#d08c6f"),
      Project(id: "p2", name: "디자인 학습", icon: "book", color: "#84956c"),
      Project(id: "p3", name: "독서", icon: "leaf", color: "#b49b65"),
    ]
    state.tasks = [
      TaskItem(id: "t1", title: "프로젝트 아이디어 정리", estimate: 2, remaining: 2, project: "p1", date: date),
      TaskItem(id: "t2", title: "디자인 강의 수강", estimate: 2, remaining: 2, project: "p2", date: date),
      TaskItem(id: "t3", title: "도서 읽기", estimate: 1, remaining: 1, project: "p3", date: date),
      TaskItem(id: "t4", title: "첫 화면 참고 자료 조사", estimate: 2, remaining: 2, project: "p1", date: offsetDate(1, date)),
      TaskItem(id: "t5", title: "주간 할 일 정리", estimate: 1, remaining: 1, project: "", date: ""),
    ]
    return state
  }

  // MARK: 타이머

  public static func roundedPomodoros(_ elapsed: Double, _ duration: Double) -> Double {
    min(1, max(0, ((elapsed / duration) * 2 + 0.5).rounded(.down) / 2))
  }

  public static func elapsedSeconds(_ timer: TimerState, _ now: Double) -> Double {
    min(timer.duration, max(0, timer.elapsed + (timer.running ? max(0, now - timer.startedAt) / 1000 : 0)))
  }

  @discardableResult
  public static func settleTimer(_ state: inout AppState, _ now: Double) -> FocusRecord? {
    guard let t = state.timer else { return nil }
    let seconds = elapsedSeconds(t, now)
    var record: FocusRecord?
    if t.phase == .focus, let taskId = t.taskId, !taskId.isEmpty, seconds > 0 {
      let value = FocusRecord(
        id: IDs.make(), taskId: taskId, seconds: seconds, pomodoros: roundedPomodoros(seconds, t.duration),
        duration: t.duration, at: now)
      state.records.append(value)
      record = value
    }
    state.timer = nil
    return record
  }

  @discardableResult
  public static func startTask(_ state: inout AppState, _ taskId: String, _ duration: Double, _ now: Double) -> FocusRecord? {
    if var timer = state.timer, timer.phase == .focus, timer.taskId == taskId {
      if !timer.running {
        timer.startedAt = now
        timer.running = true
        state.timer = timer
      }
      return nil
    }
    let record = settleTimer(&state, now)
    state.timer = TimerState(taskId: taskId, duration: duration, elapsed: 0, startedAt: now, running: true, phase: .focus)
    return record
  }

  public static func startRest(_ state: inout AppState, _ now: Double) {
    state.timer = TimerState(
      taskId: nil, duration: state.settings.rest, elapsed: 0, startedAt: now, running: true, phase: .rest)
  }

  /// A finished focus writes its record at once and then waits in `checkin`
  /// until the user saves progress, completes the task, or skips. Rest starts
  /// from the check-in commands, never from the clock.
  @discardableResult
  public static func advanceTimer(_ state: inout AppState, _ now: Double) -> Bool {
    guard let t = state.timer, t.running, elapsedSeconds(t, now) >= t.duration else { return false }
    settleTimer(&state, now)
    if t.phase == .focus {
      state.timer = TimerState(
        taskId: t.taskId, duration: t.duration, elapsed: t.duration, startedAt: now, running: false, phase: .checkin)
    }
    return true
  }

  /// Sum of recorded pomodoros for one task.
  public static func usedPomodoros(_ state: AppState, _ taskId: String) -> Double {
    state.records.filter { $0.taskId == taskId }.reduce(0) { $0 + $1.pomodoros }
  }

  static func issueTicket(_ state: inout AppState, _ task: TaskItem, _ now: Double, clipId: String = "") {
    var ticket = Ticket(
      id: IDs.make(), taskId: task.id, title: task.title, projectId: task.project, completedAt: now,
      estimate: task.estimate, used: usedPomodoros(state, task.id))
    ticket.clipId = clipId
    state.tickets.append(ticket)
  }

  static func checkinTask(_ state: AppState) throws -> Int {
    guard let timer = state.timer, timer.phase == .checkin else { throw DomainError("진척 확인 중이 아닙니다.") }
    guard let index = state.tasks.firstIndex(where: { $0.id == timer.taskId }) else {
      throw DomainError("할 일을 찾을 수 없습니다.")
    }
    return index
  }

  static func newTask(_ fields: TaskValues) -> TaskItem {
    TaskItem(
      id: IDs.make(), title: fields.title, estimate: fields.estimate, remaining: fields.estimate,
      project: fields.project, date: fields.date)
  }

  static func taskIndex(_ state: AppState, _ id: JSON?, _ message: String = "할 일을 찾을 수 없습니다.") throws -> Int {
    guard let index = state.tasks.firstIndex(where: { .string($0.id) == id }) else { throw DomainError(message) }
    return index
  }

  // MARK: 명령

  public static func applyCommand(
    _ input: AppState, _ command: Command, now: Double, advance: Bool = true
  ) throws -> AppState {
    var state = input
    let p = command.payload
    if advance { advanceTimer(&state, now) }
    switch command.type {
    case "task:save":
      let existing = state.tasks.first { .string($0.id) == p["id"] }
      let fields = try taskFields(p, projects: state.projects, existingEstimate: existing?.estimate)
      if isTruthy(p["id"]) {
        let index = try taskIndex(state, p["id"])
        let previousEstimate = state.tasks[index].estimate
        state.tasks[index].title = fields.title
        state.tasks[index].estimate = fields.estimate
        state.tasks[index].date = fields.date
        state.tasks[index].project = fields.project
        // The remaining estimate follows a changed estimate unless given.
        if !JSON.absent(p["remaining"]) {
          state.tasks[index].remaining = try Check.integer(p["remaining"], 0, Double(maxLegacyEstimate))
        } else if fields.estimate != previousEstimate {
          state.tasks[index].remaining = fields.estimate
        }
      } else {
        state.tasks.append(newTask(fields))
      }

    case "task:batch":
      guard let project = p["project"]?.string,
        project.isEmpty || state.projects.contains(where: { $0.id == project })
      else { throw DomainError("프로젝트를 찾을 수 없습니다.") }
      guard let list = p["tasks"]?.array, list.count >= 1, list.count <= 500,
        state.tasks.count + list.count <= 20000
      else { throw DomainError(taskLimitError) }
      // Validate the entire batch before allocating IDs or changing any tasks.
      let fields = try list.map { item -> TaskValues in
        var row = item.object ?? [:]
        row["project"] = .string(project)
        return try taskFields(row, projects: state.projects)
      }
      state.tasks.append(contentsOf: fields.map(newTask))

    case "task:delete":
      let index = try taskIndex(state, p["id"])
      if state.timer?.taskId == state.tasks[index].id { settleTimer(&state, now) }
      state.tasks.remove(at: index)

    case "task:toggle":
      let index = try taskIndex(state, p["id"])
      let task = state.tasks[index]
      if !task.done {
        if state.timer?.taskId == task.id { settleTimer(&state, now) }
        state.tasks[index].done = true
        issueTicket(&state, state.tasks[index], now)
      } else {
        state.tasks[index].done = false
        if let ticket = state.tickets.lastIndex(where: { $0.taskId == task.id && !$0.voided }) {
          state.tickets[ticket].voided = true
        }
      }

    case "task:move":
      let index = try taskIndex(state, p["id"])
      state.tasks[index].date = try Check.date(p["date"])

    case "task:reorder":
      // Move a task directly before another one (or to the end of the list
      // when `before` is empty). Sections read tasks in array order.
      let from = try taskIndex(state, p["id"])
      if p["before"] == p["id"] { break }
      let task = state.tasks.remove(at: from)
      if isTruthy(p["before"]) {
        guard let to = state.tasks.firstIndex(where: { .string($0.id) == p["before"] }) else {
          state.tasks.insert(task, at: from)
          throw DomainError("할 일을 찾을 수 없습니다.")
        }
        state.tasks.insert(task, at: to)
      } else {
        state.tasks.append(task)
      }

    case "project:delete":
      guard state.projects.contains(where: { .string($0.id) == p["id"] }) else {
        throw DomainError("프로젝트를 찾을 수 없습니다.")
      }
      state.projects.removeAll { .string($0.id) == p["id"] }
      for index in state.tasks.indices where .string(state.tasks[index].project) == p["id"] {
        state.tasks[index].project = ""
      }

    case "project:save":
      let name = try Check.text(p["name"], max: 80)
      if isTruthy(p["id"]) {
        guard let index = state.projects.firstIndex(where: { .string($0.id) == p["id"] }) else {
          throw DomainError("프로젝트를 찾을 수 없습니다.")
        }
        state.projects[index].name = name
        if p.keys.contains("outcome") { state.projects[index].outcome = try Check.optionalText(p["outcome"], max: 120) }
        if p.keys.contains("image") { state.projects[index].image = Check.imageName(p["image"]) }
      } else {
        state.projects.append(
          Project(
            id: IDs.make(), name: name, icon: "folder", color: "#84956c",
            outcome: try Check.optionalText(p["outcome"], max: 120), image: Check.imageName(p["image"])))
      }

    case "ticket:update":
      guard let index = state.tickets.firstIndex(where: { .string($0.id) == p["id"] }) else {
        throw DomainError("티켓을 찾을 수 없습니다.")
      }
      if p.keys.contains("note") { state.tickets[index].note = try Check.optionalText(p["note"], max: 200) }
      if p.keys.contains("highlight") { state.tickets[index].highlight = p["highlight"] == .bool(true) }
      if p.keys.contains("sticker") {
        guard let sticker = p["sticker"]?.string, ticketStickers.contains(sticker) else {
          throw DomainError(Check.invalidInput)
        }
        state.tickets[index].sticker = sticker
      }
      if p.keys.contains("clipId") { state.tickets[index].clipId = try Check.optionalText(p["clipId"], max: 160) }

    case "template:save":
      let row = try validateTemplateRow(
        .object([
          "id": isTruthy(p["id"]) ? p["id"]! : "new", "name": p["name"] ?? .null, "steps": p["steps"] ?? .null,
          "position": 0,
        ])
      ).0
      if isTruthy(p["id"]) {
        guard let index = state.templates.firstIndex(where: { .string($0.id) == p["id"] }) else {
          throw DomainError("템플릿을 찾을 수 없습니다.")
        }
        state.templates[index].name = row.name
        state.templates[index].steps = row.steps
      } else {
        guard state.templates.count < maxTemplates else { throw DomainError("템플릿은 \(maxTemplates)개까지 저장할 수 있습니다.") }
        state.templates.append(TaskTemplate(id: IDs.make(), name: row.name, steps: row.steps))
      }

    case "template:delete":
      guard state.templates.contains(where: { .string($0.id) == p["id"] }) else {
        throw DomainError("템플릿을 찾을 수 없습니다.")
      }
      state.templates.removeAll { .string($0.id) == p["id"] }

    case "template:apply":
      // One round of the template becomes tasks on the given date at once.
      guard let template = state.templates.first(where: { .string($0.id) == p["id"] }) else {
        throw DomainError("템플릿을 찾을 수 없습니다.")
      }
      let date = try Check.date(p["date"] ?? "")
      let project = isTruthy(p["project"]) ? try Check.text(p["project"]) : ""
      if !project.isEmpty, !state.projects.contains(where: { $0.id == project }) {
        throw DomainError("프로젝트를 찾을 수 없습니다.")
      }
      guard state.tasks.count + template.steps.count <= 20000 else { throw DomainError(taskLimitError) }
      state.tasks.append(contentsOf: template.steps.map {
        newTask(
          TaskValues(
            title: $0.title.replacingOccurrences(of: "%n%", with: "1"), estimate: $0.estimate, date: date,
            project: project))
      })

    case "timer:play":
      guard let task = state.tasks.first(where: { .string($0.id) == p["id"] && !$0.done }) else {
        throw DomainError("실행할 할 일을 찾을 수 없습니다.")
      }
      startTask(&state, task.id, state.settings.focus, now)

    case "timer:toggle":
      guard var t = state.timer, t.phase != .checkin else { break }
      if t.running {
        t.elapsed = elapsedSeconds(t, now)
        t.running = false
      } else {
        t.startedAt = now
        t.running = true
      }
      state.timer = t

    case "timer:pause":
      if var t = state.timer, t.running {
        t.elapsed = elapsedSeconds(t, now)
        t.running = false
        state.timer = t
      }

    case "timer:end":
      settleTimer(&state, now)

    case "checkin:save":
      let index = try checkinTask(state)
      state.tasks[index].remaining = try Check.integer(p["remaining"], 0, Double(maxLegacyEstimate))
      startRest(&state, now)

    case "checkin:done":
      let index = try checkinTask(state)
      state.tasks[index].done = true
      issueTicket(&state, state.tasks[index], now, clipId: try Check.optionalText(p["clipId"], max: 160))
      startRest(&state, now)

    case "checkin:followup":
      // The finished estimate stays on record; a new task carries the rest.
      let index = try checkinTask(state)
      guard state.tasks.count < 20000 else { throw DomainError(taskLimitError) }
      let task = state.tasks[index]
      let title = JSON.absent(p["title"]) ? task.title : try Check.text(p["title"])
      var next = newTask(TaskValues(title: title, estimate: 1, date: task.date, project: task.project))
      next.followUpOf = task.id
      state.tasks.insert(next, at: index + 1)
      state.tasks[index].remaining = 0
      startRest(&state, now)

    case "checkin:skip":
      _ = try checkinTask(state)
      startRest(&state, now)

    case "settings:save":
      var next = state.settings.json.object ?? [:]
      for key in ["focus", "rest", "trayDisplay", "dailyCapacity", "planAt", "reviewAt", "remindDays"] {
        if !JSON.absent(p[key]) { next[key] = p[key] }
      }
      state.settings = try validateSettings(.object(next))

    default:
      throw DomainError("지원하지 않는 작업입니다.")
    }
    return state
  }

  // MARK: 화면 계산

  public struct TodoSection: Identifiable, Sendable {
    public var date: String
    public var label: String
    public var tasks: [TaskItem]
    public var id: String { date.isEmpty ? "backlog" : date }
  }

  /// 오늘, 내일, 할 일이 있는 날짜, 미완료가 있는 지난 날짜, 미지정
  public static func todoSections(_ tasks: [TaskItem], today: String = localDate()) -> [TodoSection] {
    let tomorrow = offsetDate(1, today)
    let dated = Set(tasks.map(\.date).filter { !$0.isEmpty })
    let upcoming = dated.filter { $0 > tomorrow }.sorted()
    let past = dated.filter { $0 < today }.filter { day in tasks.contains { $0.date == day && !$0.done } }
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
        label = "\(year)\(Int(date.dropFirst(5).prefix(2)) ?? 0)월 \(Int(date.suffix(2)) ?? 0)일"
      }
      return TodoSection(date: date, label: label, tasks: tasks.filter { $0.date == date })
    }
  }

  /// Mac의 timerMenuState() 상태 문구
  public static func timerStatus(_ timer: TimerState?) -> String {
    guard let timer else { return "집중 대기" }
    switch timer.phase {
    case .checkin: return "진척 확인"
    case .rest: return timer.running ? "휴식 중" : "휴식 대기"
    case .focus: return timer.running ? "집중 중" : "일시정지"
    }
  }
}
