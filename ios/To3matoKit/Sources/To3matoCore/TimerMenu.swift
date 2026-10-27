import Foundation

/// Mac의 timerMenuState() 결과. 메뉴 막대와 Live Activity가 같은 값을 쓴다.
public struct TimerMenuState: Equatable, Sendable {
  public var ratio: Double
  /// "idle", "focus", "checkin", "rest"
  public var phase: String
  public var paused: Bool
  public var taskTitle: String
  public var clock: String
  public var status: String
  public var primary: String
  public var primaryEnabled: Bool
  public var end: String
  public var endEnabled: Bool
  public var command: Command?

  public init(
    ratio: Double, phase: String, paused: Bool, taskTitle: String, clock: String, status: String, primary: String,
    primaryEnabled: Bool, end: String, endEnabled: Bool, command: Command?
  ) {
    self.ratio = ratio
    self.phase = phase
    self.paused = paused
    self.taskTitle = taskTitle
    self.clock = clock
    self.status = status
    self.primary = primary
    self.primaryEnabled = primaryEnabled
    self.end = end
    self.endEnabled = endEnabled
    self.command = command
  }
}

extension Domain {
  /// Mac의 timerMenuState(). 문구는 domain.mjs와 같다.
  public static func timerMenuState(_ state: AppState, now: Double) -> TimerMenuState {
    let timer = state.timer
    let remaining = (timer.map { $0.duration - elapsedSeconds($0, now) } ?? state.settings.focus).rounded(.up)
    let minutes = Int((remaining / 60).rounded(.down))
    let seconds = Int(remaining.truncatingRemainder(dividingBy: 60))
    let clock = "\(String(minutes).leftPadded(2)):\(String(seconds).leftPadded(2))"
    let rest = timer?.phase == .rest
    let checkin = timer?.phase == .checkin
    let today = localDate(Date(timeIntervalSince1970: now / 1000))
    let next = state.tasks.first { $0.date == today && !$0.done }
    let status = timerStatus(timer)
    let taskTitle: String
    if let timer {
      taskTitle = state.tasks.first { $0.id == timer.taskId }?.title ?? ""
    } else {
      taskTitle = next?.title ?? ""
    }
    let primary: String
    if timer?.running == true {
      primary = "일시정지"
    } else if rest || checkin {
      primary = "휴식 시작"
    } else if timer != nil {
      primary = "집중 재개"
    } else {
      primary = "집중 시작"
    }
    let command: Command?
    if checkin {
      command = Command("checkin:skip")
    } else if timer != nil {
      command = Command("timer:toggle")
    } else if let next {
      command = Command("timer:play", ["id": .string(next.id)])
    } else {
      command = nil
    }
    return TimerMenuState(
      ratio: timer.map { max(0, 1 - elapsedSeconds($0, now) / $0.duration) } ?? 0,
      phase: timer?.phase.rawValue ?? "idle",
      paused: timer.map { !$0.running } ?? false,
      taskTitle: taskTitle,
      clock: clock,
      status: status,
      primary: primary,
      primaryEnabled: timer != nil || next != nil,
      end: rest ? "휴식 종료" : "집중 종료",
      endEnabled: timer != nil,
      command: command)
  }
}
