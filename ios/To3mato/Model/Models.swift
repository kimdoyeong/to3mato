import Foundation
import SwiftUI

// Mac의 src/lib/types.ts와 같은 모양. 날짜는 `yyyy-MM-dd` 문자열, 미지정은 빈 문자열이다.

struct TaskItem: Identifiable, Hashable {
  var id: String
  var title: String
  var estimate: Int
  var remaining: Int
  var followUpOf = ""
  var project: String
  var date: String
  var done = false
}

struct Project: Identifiable, Hashable {
  var id: String
  var name: String
  var icon: String
  var color: String
  var outcome = ""
  var image: Data?

  var tint: Color { Color(hexString: color) }
}

struct FocusRecord: Identifiable, Hashable {
  var id: String
  var taskId: String
  var seconds: Double
  var pomodoros: Double
  var duration: Double
  var at: Date
}

enum TicketSticker: String, CaseIterable {
  case none = "", star, heart, leaf
}

struct Ticket: Identifiable, Hashable {
  var id: String
  var taskId: String
  var title: String
  var projectId: String
  var completedAt: Date
  var estimate: Int
  var used: Double
  var note = ""
  var highlight = false
  var sticker: TicketSticker = .none
  var voided = false
}

struct TemplateStep: Hashable {
  var title: String
  var estimate: Int
}

struct TaskTemplate: Identifiable, Hashable {
  var id: String
  var name: String
  var steps: [TemplateStep]
}

enum TimerPhase { case focus, checkin, rest }

struct TimerState: Equatable {
  var taskId: String?
  var duration: Double
  var elapsed: Double
  var startedAt: Date
  var running: Bool
  var phase: TimerPhase

  func elapsedSeconds(at now: Date) -> Double {
    elapsed + (running ? now.timeIntervalSince(startedAt) : 0)
  }
}

struct Settings: Equatable {
  var focus: Double = 1500
  var rest: Double = 300
  var dailyCapacity = 8
  var planAt: Date?
  var reviewAt: Date?
  var remindDays: Set<Int> = [1, 2, 3, 4, 5]
}

/// 같은 섹션 규칙: 오늘, 내일, 할 일이 있는 날짜, 미완료가 있는 지난 날짜, 미지정
struct TodoSection: Identifiable {
  var date: String
  var label: String
  var tasks: [TaskItem]
  var id: String { date.isEmpty ? "backlog" : date }
}

struct ProjectSummary {
  var tickets: Int
  var left: Int
  var used: Double
  var remaining: Int
  var progress: Double
  var recent: [Ticket]
}

struct TicketWeek: Identifiable {
  var id: String
  var label: String
  var tickets: [Ticket]
}

/// 집중 로그의 3초 영상. UI 단계에서는 썸네일 자리만 그린다.
struct Clip: Identifiable, Hashable {
  var id: String
  var taskTitle: String
  var at: Date
}

/// 월요일에 배달되는 영상 편지
struct Delivery: Identifiable, Hashable {
  var id: String
  var start: Date
  var end: Date
  var clipCount: Int
  var duration: Double
  var seen: Bool
}
