import Foundation

// Mac의 domain.mjs 입력 검증과 normalizeState(). 오류 문구는 Mac과 같다.

public enum Check {
  static let invalidInput = "입력 내용을 확인하세요."
  static let invalidNumber = "숫자 범위를 확인하세요."
  static let unsupported = "지원하지 않는 데이터 형식입니다."

  public static func jsLength(_ value: String) -> Int { value.utf16.count }

  static func text(_ value: JSON?, max: Int = 120) throws -> String {
    guard let raw = value?.string else { throw DomainError(invalidInput) }
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, jsLength(raw) <= max else { throw DomainError(invalidInput) }
    return trimmed
  }

  static func number(_ value: JSON?, _ min: Double, _ max: Double) throws -> Double {
    guard let number = value?.number, number.isFinite, number >= min, number <= max else {
      throw DomainError(invalidNumber)
    }
    return number
  }

  static func optionalText(_ value: JSON?, max: Int = 120) throws -> String {
    if JSON.absent(value) || value == .string("") { return "" }
    return try text(value, max: max)
  }

  static func integer(_ value: JSON?, _ min: Double, _ max: Double) throws -> Int {
    let result = try number(value, min, max)
    guard result.rounded() == result else { throw DomainError(invalidNumber) }
    return Int(result)
  }

  static func time(_ value: JSON?) throws -> String {
    if JSON.absent(value) || value == .string("") { return "" }
    guard let raw = value?.string, raw.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil
    else { throw DomainError("시간 형식이 올바르지 않습니다.") }
    return raw
  }

  static func weekdays(_ value: JSON?) throws -> [Int] {
    if JSON.absent(value) { return Domain.defaultRemindDays }
    guard let list = value?.array, list.count <= 7 else { throw DomainError("요일 선택을 확인하세요.") }
    var days: [Int] = []
    for item in list {
      guard let n = item.number, n.rounded() == n, n >= 0, n <= 6 else { throw DomainError("요일 선택을 확인하세요.") }
      days.append(Int(n))
    }
    return Array(Set(days)).sorted()
  }

  static func imageName(_ value: JSON?) -> String {
    guard let raw = value?.string,
      raw.range(of: #"^[A-Za-z0-9_-]{1,100}\.(png|jpe?g|webp|gif)$"#, options: .regularExpression) != nil
    else { return "" }
    return raw
  }

  static func date(_ value: JSON?) throws -> String {
    if value == .string("") { return "" }
    guard let raw = value?.string, raw.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
      let noon = CalendarTime.utcNoon(raw), CalendarTime.dateInZone(noon, TimeZone(identifier: "UTC")) == raw
    else { throw DomainError("날짜 형식이 올바르지 않습니다.") }
    return raw
  }

  static func position(_ value: JSON?) throws -> Int {
    try integer(value, 0, 100_000)
  }

  static func object(_ raw: JSON?) throws -> [String: JSON] {
    guard let object = raw?.object else { throw DomainError(unsupported) }
    return object
  }
}

struct TaskValues {
  var title: String
  var estimate: Int
  var date: String
  var project: String
}

extension Domain {
  static func taskValues(_ raw: [String: JSON]) throws -> TaskValues {
    let title = try Check.text(raw["title"])
    let estimate = try Check.number(raw["estimate"], 1, Double(maxLegacyEstimate))
    guard estimate.rounded() == estimate else { throw DomainError("예상 포모도로는 정수로 입력하세요.") }
    let date = try Check.date(raw["date"])
    let project = isTruthy(raw["project"]) ? try Check.text(raw["project"]) : ""
    return TaskValues(title: title, estimate: Int(estimate), date: date, project: project)
  }

  static func taskFields(_ raw: [String: JSON], projects: [Project], existingEstimate: Int? = nil) throws -> TaskValues {
    let values = try taskValues(raw)
    // Older tasks may keep their original estimate when editing other fields.
    if values.estimate != existingEstimate { _ = try Check.number(.number(Double(values.estimate)), 1, Double(maxTaskEstimate)) }
    if !values.project.isEmpty, !projects.contains(where: { $0.id == values.project }) {
      throw DomainError("프로젝트를 찾을 수 없습니다.")
    }
    return values
  }

  /// JS의 truthy 판정(문자열·숫자·불리언)
  static func isTruthy(_ value: JSON?) -> Bool {
    switch value {
    case .none, .null: false
    case .bool(let v): v
    case .number(let v): v != 0 && !v.isNaN
    case .string(let v): !v.isEmpty
    default: true
    }
  }

  // Row validators are shared with sync. Callers check references between rows.

  public static func validateProjectRow(_ raw: JSON?) throws -> (Project, position: Int) {
    let o = try Check.object(raw)
    let icon = o["icon"]?.string.flatMap { ["folder", "book", "leaf"].contains($0) ? $0 : nil } ?? "folder"
    let color = o["color"]?.string.flatMap {
      $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil ? $0 : nil
    } ?? "#84956c"
    let project = Project(
      id: try Check.text(o["id"]), name: try Check.text(o["name"], max: 80), icon: icon, color: color,
      outcome: try Check.optionalText(o["outcome"], max: 120), image: Check.imageName(o["image"]))
    return (project, try Check.position(o["position"]))
  }

  public static func validateTaskRow(_ raw: JSON?) throws -> (TaskItem, position: Int) {
    let o = try Check.object(raw)
    let values = try taskValues(o)
    let remaining =
      JSON.absent(o["remaining"]) ? values.estimate : try Check.integer(o["remaining"], 0, Double(maxLegacyEstimate))
    let task = TaskItem(
      id: try Check.text(o["id"]), title: values.title, estimate: values.estimate, remaining: remaining,
      followUpOf: try Check.optionalText(o["followUpOf"], max: 120), project: values.project, date: values.date,
      done: o["done"] == .bool(true))
    return (task, try Check.position(o["position"]))
  }

  // Tickets are issued when a task is completed. They are history, like records.
  public static func validateTicketRow(_ raw: JSON?) throws -> Ticket {
    let o = try Check.object(raw)
    var ticket = Ticket(
      id: try Check.text(o["id"]), taskId: try Check.text(o["taskId"]), title: try Check.text(o["title"], max: 120),
      projectId: try Check.optionalText(o["projectId"], max: 120),
      completedAt: try Check.number(o["completedAt"], 0, 8_640_000_000_000_000),
      estimate: try Check.integer(o["estimate"], 1, Double(maxLegacyEstimate)),
      used: try Check.number(o["used"], 0, 100_000))
    ticket.clipId = try Check.optionalText(o["clipId"], max: 160)
    ticket.note = try Check.optionalText(o["note"], max: 200)
    ticket.highlight = o["highlight"] == .bool(true)
    ticket.sticker = o["sticker"]?.string.flatMap { ticketStickers.contains($0) ? $0 : nil } ?? ""
    ticket.voided = o["voided"] == .bool(true)
    return ticket
  }

  static func templateSteps(_ value: JSON?) throws -> [TemplateStep] {
    guard let list = value?.array, list.count >= 1, list.count <= maxTemplateSteps else {
      throw DomainError("템플릿 단계는 1~\(maxTemplateSteps)개여야 합니다.")
    }
    return try list.map { step in
      guard let o = step.object else { throw DomainError(Check.invalidInput) }
      return TemplateStep(
        title: try Check.text(o["title"], max: 120),
        estimate: try Check.integer(o["estimate"], 1, Double(maxTaskEstimate)))
    }
  }

  public static func validateTemplateRow(_ raw: JSON?) throws -> (TaskTemplate, position: Int) {
    let o = try Check.object(raw)
    let template = TaskTemplate(
      id: try Check.text(o["id"]), name: try Check.text(o["name"], max: 80), steps: try templateSteps(o["steps"]))
    return (template, try Check.position(o["position"]))
  }

  // Records have no position. They are ordered by time so devices never conflict.
  public static func validateRecordRow(_ raw: JSON?) throws -> FocusRecord {
    let o = try Check.object(raw)
    return FocusRecord(
      id: try Check.text(o["id"]), taskId: try Check.text(o["taskId"]),
      seconds: try Check.number(o["seconds"], 0, 86400), pomodoros: try Check.number(o["pomodoros"], 0, 1),
      duration: try Check.number(o["duration"], 1, 86400), at: try Check.number(o["at"], 0, 8_640_000_000_000_000))
  }

  public static func validateSettings(_ raw: JSON?) throws -> Settings {
    let o = raw?.object ?? [:]
    var settings = Settings()
    settings.focus = try Check.number(o["focus"], 1, 86400)
    settings.rest = try Check.number(o["rest"], 1, 86400)
    settings.trayDisplay = o["trayDisplay"]?.string.flatMap {
      ["clock", "bar", "ring", "hourglass"].contains($0) ? $0 : nil
    } ?? "clock"
    settings.dailyCapacity =
      JSON.absent(o["dailyCapacity"]) ? defaultDailyCapacity : try Check.integer(o["dailyCapacity"], 1, 16)
    settings.planAt = try Check.time(o["planAt"])
    settings.reviewAt = try Check.time(o["reviewAt"])
    settings.remindDays = try Check.weekdays(o["remindDays"])
    return settings
  }

  // FNV-1a 32-bit with two seeds. Fixed length keeps IDs within sync limits.
  static func fnv(_ value: String, _ seed: UInt32) -> String {
    var hash = seed
    for unit in value.utf16 {
      hash ^= UInt32(unit)
      hash = hash &* 0x0100_0193
    }
    return String(hash, radix: 16).leftPadded(8)
  }

  /// Deterministic ID for records saved before IDs existed.
  public static func legacyRecordId(_ record: [String: JSON]) -> String {
    let key = "[" + ["taskId", "at", "seconds", "duration", "pomodoros"].map { jsStringify(record[$0]) }.joined(separator: ",") + "]"
    return "legacy-\(fnv(key, 0x811c_9dc5))\(fnv(key, 0x050c_5d1f))"
  }

  /// JS `JSON.stringify` of a primitive inside an array (undefined becomes null).
  static func jsStringify(_ value: JSON?) -> String {
    switch value {
    case .none, .null: return "null"
    case .bool(let v): return v ? "true" : "false"
    case .number(let v): return jsNumber(v)
    case .string(let v):
      var out = "\""
      for scalar in v.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        default:
          if scalar.value < 0x20 {
            out += String(format: "\\u%04x", scalar.value)
          } else {
            out.unicodeScalars.append(scalar)
          }
        }
      }
      return out + "\""
    default:
      return (try? String(decoding: value!.data(), as: UTF8.self)) ?? "null"
    }
  }

  static func jsNumber(_ v: Double) -> String {
    if !v.isFinite { return "null" }
    if v.rounded() == v, abs(v) < 1e21 { return String(format: "%.0f", v) }
    return "\(v)"
  }

  /// Validate imports and disk state before accepting any changes.
  public static func normalizeState(_ raw: JSON) throws -> AppState {
    guard let o = raw.object, o["version"] == 1, let rawTasks = o["tasks"]?.array,
      let rawProjects = o["projects"]?.array, let rawRecords = o["records"]?.array,
      rawTasks.count <= 20000, rawRecords.count <= 100_000
    else { throw DomainError(Check.unsupported) }
    var state = AppState()
    state.settings = try validateSettings(o["settings"])
    state.projects = try rawProjects.map { try validateProjectRow(positioned($0)).0 }
    guard Set(state.projects.map(\.id)).count == state.projects.count else { throw DomainError("프로젝트 ID가 중복됩니다.") }
    state.tasks = try rawTasks.map {
      let task = try validateTaskRow(positioned($0)).0
      if !task.project.isEmpty, !state.projects.contains(where: { $0.id == task.project }) {
        throw DomainError("프로젝트를 찾을 수 없습니다.")
      }
      return task
    }
    guard Set(state.tasks.map(\.id)).count == state.tasks.count else { throw DomainError("할 일 ID가 중복됩니다.") }
    var explicit = Set<String>()
    for r in rawRecords {
      guard let id = r["id"] else { continue }
      let value = try Check.text(id)
      guard !explicit.contains(value) else { throw DomainError("집중 기록 ID가 중복됩니다.") }
      explicit.insert(value)
    }
    // Legacy records get stable IDs. Identical legacy rows get a numbered suffix.
    var used = explicit
    state.records = try rawRecords.map { r in
      guard var record = r.object else { throw DomainError(Check.unsupported) }
      if record["id"] == nil {
        let base = legacyRecordId(record)
        var id = base
        var n = 2
        while used.contains(id) {
          id = "\(base)-\(n)"
          n += 1
        }
        used.insert(id)
        record["id"] = .string(id)
      }
      return try validateRecordRow(.object(record))
    }
    let rawTickets = JSON.absent(o["tickets"]) ? [] : o["tickets"]?.array
    let rawTemplates = JSON.absent(o["templates"]) ? [] : o["templates"]?.array
    guard let rawTickets, let rawTemplates, rawTickets.count <= 20000, rawTemplates.count <= maxTemplates else {
      throw DomainError(Check.unsupported)
    }
    state.tickets = try rawTickets.map(validateTicketRow)
    guard Set(state.tickets.map(\.id)).count == state.tickets.count else { throw DomainError("티켓 ID가 중복됩니다.") }
    state.templates = try rawTemplates.map { try validateTemplateRow(positioned($0)).0 }
    guard Set(state.templates.map(\.id)).count == state.templates.count else { throw DomainError("템플릿 ID가 중복됩니다.") }
    if let t = o["timer"]?.object {
      guard let phase = t["phase"]?.string.flatMap(TimerPhase.init(rawValue:)) else {
        throw DomainError("타이머 상태가 올바르지 않습니다.")
      }
      let taskId = t["taskId"]?.string
      if phase != .rest, !state.tasks.contains(where: { $0.id == taskId && !$0.done }) {
        throw DomainError("실행 중인 작업을 찾을 수 없습니다.")
      }
      let duration = try Check.number(t["duration"], 1, 86400)
      state.timer = TimerState(
        taskId: phase == .rest ? nil : taskId, duration: duration,
        elapsed: try Check.number(t["elapsed"], 0, duration),
        startedAt: try Check.number(t["startedAt"], 0, 8_640_000_000_000_000),
        // A check-in waits for the user and never runs down.
        running: phase == .checkin ? false : t["running"] == .bool(true), phase: phase)
    } else if Domain.isTruthy(o["timer"]) {
      throw DomainError("타이머 상태가 올바르지 않습니다.")
    }
    return state
  }

  private static func positioned(_ row: JSON) throws -> JSON {
    guard var object = row.object else { throw DomainError(Check.unsupported) }
    object["position"] = 0
    return .object(object)
  }
}

extension String {
  func leftPadded(_ length: Int, with pad: Character = "0") -> String {
    count >= length ? self : String(repeating: pad, count: length - count) + self
  }
}
