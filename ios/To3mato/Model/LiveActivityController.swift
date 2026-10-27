import ActivityKit
import Foundation

/// 타이머가 있는 동안 Live Activity를 띄운다. 진행 중에는 종료 예정 시각만 넘기고 시스템이 스스로 센다.
@MainActor
final class LiveActivityController {
  private var activity: Activity<TimerActivityAttributes>?

  init() {
    // 지난 실행에서 남은 Live Activity를 정리한다.
    for stale in Activity<TimerActivityAttributes>.activities {
      Task { await stale.end(nil, dismissalPolicy: .immediate) }
    }
  }

  func sync(_ model: AppModel) {
    guard let timer = model.timer else {
      end()
      return
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let content = ActivityContent(state: state(model, timer), staleDate: nil)
    let taskId = timer.taskId ?? ""
    if let activity, activity.attributes.taskId == taskId {
      Task { await activity.update(content) }
    } else {
      end()
      activity = try? Activity.request(
        attributes: TimerActivityAttributes(taskId: taskId), content: content, pushType: nil)
    }
  }

  func end() {
    guard let current = activity else { return }
    activity = nil
    Task { await current.end(nil, dismissalPolicy: .immediate) }
  }

  private func state(_ model: AppModel, _ timer: TimerState) -> TimerActivityAttributes.ContentState {
    let remaining = model.remainingSeconds
    let endsAt = model.now.addingTimeInterval(Double(remaining))
    let task = model.tasks.first { $0.id == timer.taskId }
    let phase: TimerActivityAttributes.ContentState.Phase =
      switch timer.phase {
      case .focus: .focus
      case .checkin: .checkin
      case .rest: .rest
      }
    return TimerActivityAttributes.ContentState(
      phase: phase,
      running: timer.running,
      title: timer.phase == .rest ? "휴식" : task?.title ?? "",
      status: model.timerStatus,
      endsAt: endsAt,
      startedAt: endsAt.addingTimeInterval(-timer.duration),
      remaining: remaining,
      estimate: task?.estimate ?? 0,
      used: task.map { model.used($0.id) } ?? 0)
  }
}
