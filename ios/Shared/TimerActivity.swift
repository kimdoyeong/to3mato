import ActivityKit
import AppIntents
import SwiftUI

// 앱과 Live Activity 확장이 함께 쓰는 타이머 계약.
// Live Activity의 모양은 시스템 기본이고 토마토 도장과 --red만 가져온다.

nonisolated struct TimerActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    enum Phase: String, Codable { case focus, checkin, rest }

    var phase: Phase
    var running: Bool
    /// 할 일 제목. 휴식 중에는 `휴식`
    var title: String
    /// Mac의 timerMenuState() 상태 문구
    var status: String
    /// 진행 중이면 종료 예정 시각. 시스템이 이 시각까지 스스로 센다.
    var endsAt: Date
    var startedAt: Date
    /// 멈춰 있을 때 보여줄 남은 초
    var remaining: Int
    var estimate: Int
    var used: Double

    var clock: String { String(format: "%02d:%02d", remaining / 60, remaining % 60) }
    var progress: Double {
      let total = endsAt.timeIntervalSince(startedAt)
      return total > 0 ? min(1, max(0, 1 - Double(remaining) / total)) : 0
    }
  }

  var taskId: String
}

/// Live Activity 버튼이 앱에 보내는 명령. Mac의 `timer:toggle`, `timer:end`와 같다.
enum TimerCommand { case toggle, end }

@MainActor
enum TimerCommands {
  /// 앱이 실행될 때 등록한다. 확장 프로세스에서는 비어 있다.
  static var handler: ((TimerCommand) -> Void)?
}

struct ToggleTimerIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "일시정지"
  static let isDiscoverable = false

  @MainActor
  func perform() async throws -> some IntentResult {
    TimerCommands.handler?(.toggle)
    return .result()
  }
}

struct EndTimerIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "집중 종료"
  static let isDiscoverable = false

  @MainActor
  func perform() async throws -> some IntentResult {
    TimerCommands.handler?(.end)
    return .result()
  }
}

/// Live Activity용 토마토 도장. 앱의 TomatoStamp와 같은 경로다.
struct LiveTomato: View {
  var filled = true
  var size: CGFloat = 20

  static let red = Color(red: 0xd9 / 255, green: 0x45 / 255, blue: 0x2f / 255)
  private static let fruit = Color(red: 0xef / 255, green: 0x5b / 255, blue: 0x43 / 255)
  private static let leaf = Color(red: 0x69 / 255, green: 0xa8 / 255, blue: 0x4f / 255)

  var body: some View {
    ZStack {
      Fruit().fill(filled ? Self.fruit : .white.opacity(0.15))
      Fruit().stroke(filled ? Self.red : .white.opacity(0.6), lineWidth: 1.4 * size / 24)
      Calyx().fill(filled ? Self.leaf : .white.opacity(0.6))
    }
    .frame(width: size, height: size)
  }

  private struct Fruit: Shape {
    func path(in rect: CGRect) -> Path {
      var p = Path()
      p.move(to: CGPoint(x: 12, y: 7))
      p.addCurve(to: CGPoint(x: 2.5, y: 13.5), control1: CGPoint(x: 7, y: 4.5), control2: CGPoint(x: 2, y: 8))
      p.addCurve(to: CGPoint(x: 12, y: 22), control1: CGPoint(x: 3, y: 18.5), control2: CGPoint(x: 7, y: 22))
      p.addCurve(to: CGPoint(x: 21.5, y: 13.5), control1: CGPoint(x: 17, y: 22), control2: CGPoint(x: 21, y: 18.5))
      p.addCurve(to: CGPoint(x: 12, y: 7), control1: CGPoint(x: 22, y: 8), control2: CGPoint(x: 17, y: 4.5))
      p.closeSubpath()
      return p.applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24))
    }
  }

  private struct Calyx: Shape {
    func path(in rect: CGRect) -> Path {
      var p = Path()
      p.addLines(
        [
          (12, 8.5), (7.6, 8.1), (9.6, 6.1), (6.8, 4.9), (9.8, 4.5), (10.2, 2.3), (12, 4), (13.8, 2.3),
          (14.2, 4.5), (17.2, 4.9), (14.4, 6.1), (16.4, 8.1),
        ].map { CGPoint(x: $0.0, y: $0.1) })
      p.closeSubpath()
      return p.applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24))
    }
  }
}
