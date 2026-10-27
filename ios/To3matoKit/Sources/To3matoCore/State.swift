import Foundation

// Mac의 src/lib/types.ts와 같은 모양. 시각은 ms(Double), 날짜는 `YYYY-MM-DD`, 미지정은 빈 문자열이다.

public struct Settings: Equatable, Sendable {
  public var focus: Double = 1500
  public var rest: Double = 300
  /// 기기 설정. 동기화 문서에는 넣지 않는다(nil).
  public var trayDisplay: String? = "clock"
  public var dailyCapacity = Domain.defaultDailyCapacity
  public var planAt = ""
  public var reviewAt = ""
  public var remindDays = Domain.defaultRemindDays

  public init() {}
}

public struct Project: Equatable, Identifiable, Sendable {
  public var id: String
  public var name: String
  public var icon: String
  public var color: String
  public var outcome: String
  public var image: String

  public init(id: String, name: String, icon: String = "folder", color: String = "#84956c", outcome: String = "", image: String = "") {
    self.id = id
    self.name = name
    self.icon = icon
    self.color = color
    self.outcome = outcome
    self.image = image
  }
}

public struct TaskItem: Equatable, Identifiable, Hashable, Sendable {
  public var id: String
  public var title: String
  public var estimate: Int
  public var remaining: Int
  public var followUpOf: String
  public var project: String
  public var date: String
  public var done: Bool

  public init(
    id: String, title: String, estimate: Int, remaining: Int, followUpOf: String = "", project: String = "",
    date: String = "", done: Bool = false
  ) {
    self.id = id
    self.title = title
    self.estimate = estimate
    self.remaining = remaining
    self.followUpOf = followUpOf
    self.project = project
    self.date = date
    self.done = done
  }
}

public struct FocusRecord: Equatable, Identifiable, Sendable {
  public var id: String
  public var taskId: String
  public var seconds: Double
  public var pomodoros: Double
  public var duration: Double
  public var at: Double

  public init(id: String, taskId: String, seconds: Double, pomodoros: Double, duration: Double, at: Double) {
    self.id = id
    self.taskId = taskId
    self.seconds = seconds
    self.pomodoros = pomodoros
    self.duration = duration
    self.at = at
  }
}

public struct Ticket: Equatable, Identifiable, Sendable {
  public var id: String
  public var taskId: String
  public var title: String
  public var projectId: String
  public var completedAt: Double
  public var estimate: Int
  public var used: Double
  public var clipId = ""
  public var note = ""
  public var highlight = false
  /// "", "star", "heart", "leaf"
  public var sticker = ""
  public var voided = false

  public init(
    id: String, taskId: String, title: String, projectId: String, completedAt: Double, estimate: Int, used: Double
  ) {
    self.id = id
    self.taskId = taskId
    self.title = title
    self.projectId = projectId
    self.completedAt = completedAt
    self.estimate = estimate
    self.used = used
  }
}

public struct TemplateStep: Equatable, Hashable, Sendable {
  public var title: String
  public var estimate: Int

  public init(title: String, estimate: Int) {
    self.title = title
    self.estimate = estimate
  }
}

public struct TaskTemplate: Equatable, Identifiable, Sendable {
  public var id: String
  public var name: String
  public var steps: [TemplateStep]

  public init(id: String, name: String, steps: [TemplateStep]) {
    self.id = id
    self.name = name
    self.steps = steps
  }
}

public enum TimerPhase: String, Sendable {
  case focus, checkin, rest
}

public struct TimerState: Equatable, Sendable {
  public var taskId: String?
  public var duration: Double
  /// 초
  public var elapsed: Double
  /// ms
  public var startedAt: Double
  public var running: Bool
  public var phase: TimerPhase

  public init(taskId: String?, duration: Double, elapsed: Double, startedAt: Double, running: Bool, phase: TimerPhase) {
    self.taskId = taskId
    self.duration = duration
    self.elapsed = elapsed
    self.startedAt = startedAt
    self.running = running
    self.phase = phase
  }
}

public struct AppState: Equatable, Sendable {
  public var settings = Settings()
  public var projects: [Project] = []
  public var tasks: [TaskItem] = []
  public var records: [FocusRecord] = []
  public var tickets: [Ticket] = []
  public var templates: [TaskTemplate] = []
  public var timer: TimerState?

  public init() {}
}

/// 명령. Mac의 `{ type, payload }`와 같다.
public struct Command: Equatable, Sendable {
  public var type: String
  public var payload: [String: JSON]

  public init(_ type: String, _ payload: [String: JSON] = [:]) {
    self.type = type
    self.payload = payload
  }

  public var json: JSON { .object(["type": .string(type), "payload": .object(payload)]) }

  public init(json: JSON) throws {
    guard let type = json["type"]?.string else { throw DomainError("잘못된 요청입니다.") }
    self.type = type
    self.payload = json["payload"]?.object ?? [:]
  }
}

// MARK: JSON 변환. 키 순서와 null 처리는 Mac과 같다.

extension Settings {
  public var json: JSON {
    var object: [String: JSON] = [
      "focus": .number(focus), "rest": .number(rest), "dailyCapacity": .number(Double(dailyCapacity)),
      "planAt": .string(planAt), "reviewAt": .string(reviewAt),
      "remindDays": .array(remindDays.map { .number(Double($0)) }),
    ]
    if let trayDisplay { object["trayDisplay"] = .string(trayDisplay) }
    return .object(object)
  }
}

extension Project {
  public var json: JSON {
    ["id": .string(id), "name": .string(name), "icon": .string(icon), "color": .string(color),
     "outcome": .string(outcome), "image": .string(image)]
  }
}

extension TaskItem {
  public var json: JSON {
    ["id": .string(id), "title": .string(title), "estimate": .number(Double(estimate)),
     "remaining": .number(Double(remaining)), "followUpOf": .string(followUpOf), "project": .string(project),
     "date": .string(date), "done": .bool(done)]
  }
}

extension FocusRecord {
  public var json: JSON {
    ["id": .string(id), "taskId": .string(taskId), "seconds": .number(seconds), "pomodoros": .number(pomodoros),
     "duration": .number(duration), "at": .number(at)]
  }
}

extension Ticket {
  public var json: JSON {
    ["id": .string(id), "taskId": .string(taskId), "title": .string(title), "projectId": .string(projectId),
     "completedAt": .number(completedAt), "estimate": .number(Double(estimate)), "used": .number(used),
     "clipId": .string(clipId), "note": .string(note), "highlight": .bool(highlight), "sticker": .string(sticker),
     "voided": .bool(voided)]
  }
}

extension TaskTemplate {
  public var json: JSON {
    ["id": .string(id), "name": .string(name),
     "steps": .array(steps.map { ["title": .string($0.title), "estimate": .number(Double($0.estimate))] })]
  }
}

extension TimerState {
  public var json: JSON {
    ["taskId": .optional(taskId), "duration": .number(duration), "elapsed": .number(elapsed),
     "startedAt": .number(startedAt), "running": .bool(running), "phase": .string(phase.rawValue)]
  }
}

extension AppState {
  public var json: JSON {
    ["version": 1, "settings": settings.json, "projects": .array(projects.map(\.json)),
     "tasks": .array(tasks.map(\.json)), "records": .array(records.map(\.json)),
     "tickets": .array(tickets.map(\.json)), "templates": .array(templates.map(\.json)),
     "timer": timer?.json ?? .null]
  }
}
