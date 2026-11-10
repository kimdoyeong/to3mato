import Foundation

// Mac의 src/lib/analytics.mjs에 있는 이벤트 목록. 이벤트 이름, 속성 이름과 값은 Mac과 같다.
// 이름, 횟수, 정해진 값만 담는다. 제목, 메모, 프로젝트 이름, ID, 이메일, 파일 이름은 넣지 않는다.

public struct AnalyticsEvent: Equatable, Sendable {
  public let event: String
  public let properties: [String: JSON]

  public init(_ event: String, _ properties: [String: JSON] = [:]) {
    self.event = event
    self.properties = properties
  }

  public var json: JSON { ["event": .string(event), "properties": .object(properties)] }
}

public enum AnalyticsEvents {
  public static let screens = ["todo", "projects", "calendar", "log", "settings", "review"]

  static let settingFields = ["focus", "rest", "trayDisplay", "dailyCapacity", "planAt", "reviewAt", "remindDays"]

  /// 목록에 있는 화면만 보고한다.
  public static func screen(_ name: String) -> AnalyticsEvent? {
    screens.contains(name) ? AnalyticsEvent("screen_viewed", ["screen": .string(name)]) : nil
  }

  /// 적용에 성공한 명령 하나를 이벤트 하나로 바꾼다. `before`는 명령을 적용하기 전 상태다.
  public static func command(_ command: Command, before: AppState) -> AnalyticsEvent? {
    let p = command.payload
    let created = !Domain.isTruthy(p["id"])
    func has(_ key: String) -> JSON { .bool(Domain.isTruthy(p[key])) }
    switch command.type {
    case "task:save":
      return created
        ? AnalyticsEvent(
          "task_created", ["has_date": has("date"), "has_project": has("project"), "estimate": count(p["estimate"]?.number)])
        : AnalyticsEvent("task_updated")
    case "task:batch":
      return AnalyticsEvent(
        "task_batch_created", ["count": .number(Double(p["tasks"]?.array?.count ?? 0)), "has_project": has("project")])
    case "task:delete":
      return AnalyticsEvent("task_deleted")
    case "task:toggle":
      let done = before.tasks.first { .string($0.id) == p["id"] }?.done == true
      return AnalyticsEvent(done ? "task_reopened" : "task_completed")
    case "task:move":
      return AnalyticsEvent("task_moved", ["has_date": has("date")])
    case "task:reorder":
      return AnalyticsEvent("task_reordered")
    case "project:save":
      return AnalyticsEvent(created ? "project_created" : "project_updated")
    case "project:delete":
      return AnalyticsEvent("project_deleted")
    case "ticket:update":
      return AnalyticsEvent(
        "ticket_updated",
        ["note": .bool(p["note"] != nil), "highlight": .bool(p["highlight"] != nil),
         "sticker": .bool(p["sticker"] != nil), "clip": .bool(p["clipId"] != nil)])
    case "template:save":
      return AnalyticsEvent(
        created ? "template_created" : "template_updated", ["steps": .number(Double(p["steps"]?.array?.count ?? 0))])
    case "template:delete":
      return AnalyticsEvent("template_deleted")
    case "template:apply":
      return AnalyticsEvent("template_applied", ["has_date": has("date"), "has_project": has("project")])
    case "timer:play":
      return AnalyticsEvent("timer_started")
    case "timer:toggle":
      guard let timer = before.timer, timer.phase != .checkin else { return nil }
      return AnalyticsEvent(
        timer.running ? "timer_paused" : "timer_resumed", ["phase": timer.phase == .rest ? "rest" : "focus"])
    case "timer:pause":
      return before.timer?.running == true ? AnalyticsEvent("timer_paused") : nil
    case "timer:end":
      return before.timer != nil ? AnalyticsEvent("timer_ended") : nil
    case "checkin:save":
      return AnalyticsEvent("checkin_saved", ["remaining": count(p["remaining"]?.number)])
    case "checkin:done":
      return AnalyticsEvent("checkin_done", ["clip": has("clipId")])
    case "checkin:followup":
      return AnalyticsEvent("checkin_followup")
    case "checkin:skip":
      return AnalyticsEvent("checkin_skipped")
    case "settings:save":
      return AnalyticsEvent(
        "settings_changed",
        ["fields": .string(p.keys.filter(settingFields.contains).sorted().joined(separator: ","))])
    default:
      return nil
    }
  }

  /// 두 상태 사이에 새로 생긴 집중 기록. 가져오기나 첫 동기화처럼 한꺼번에 늘어난 기록은 세지 않는다.
  public static func records(_ previous: AppState, _ next: AppState) -> [AnalyticsEvent] {
    let before = previous.records, after = next.records
    guard after.count > before.count, after.count - before.count <= 3 else { return [] }
    let known = Set(before.map(\.id))
    return after.filter { !known.contains($0.id) }.map {
      AnalyticsEvent(
        "focus_recorded",
        ["pomodoros": count($0.pomodoros), "minutes": count($0.duration / 60),
         "completed": .bool($0.seconds >= $0.duration)])
    }
  }

  /// 0~999의 정수
  private static func count(_ value: Double?) -> JSON {
    guard let value, value.isFinite else { return 0 }
    return .number(max(0, min(999, value.rounded(.towardZero))))
  }
}
