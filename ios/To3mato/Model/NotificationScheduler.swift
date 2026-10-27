import Foundation
import To3matoCore
import UserNotifications

/// 집중·휴식 종료 시각에 로컬 알림을 예약한다. 문구는 Mac 알림과 같다.
/// 일시정지·종료·전환 때마다 다시 예약하거나 취소한다.
@MainActor
final class NotificationScheduler {
  private let center = UNUserNotificationCenter.current()
  private let identifier = "to3mato.timer"
  private var asked = false

  func requestPermission() {
    guard !asked else { return }
    asked = true
    Task { _ = try? await center.requestAuthorization(options: [.alert, .sound]) }
  }

  func sync(_ model: AppModel) {
    center.removePendingNotificationRequests(withIdentifiers: [identifier])
    guard let timer = model.timer, timer.running, timer.phase != .checkin else { return }
    let seconds = Double(model.remainingSeconds)
    guard seconds > 0 else { return }
    let content = UNMutableNotificationContent()
    if timer.phase == .rest {
      content.title = "휴식 끝"
      content.body = "휴식 시간이 끝났습니다. 다음 할 일을 시작하세요."
    } else {
      content.title = "집중 타이머 끝"
      content.body = model.timerTask.map { "\($0.title) · 1포모도로 완료." } ?? "1포모도로 완료."
    }
    content.sound = .default
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
    center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
  }
}
