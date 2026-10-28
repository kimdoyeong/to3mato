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

  /// 처음 한 번만 묻는다. 허용되면 granted를 불러 이미 지난 예약을 다시 건다.
  func requestPermission(granted: @escaping @MainActor () -> Void = {}) {
    guard !asked else { return }
    asked = true
    Task {
      if (try? await center.requestAuthorization(options: [.alert, .sound])) == true { granted() }
    }
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

  static let ritualPrefix = "to3mato.ritual."

  static func ritualKind(_ identifier: String) -> String? {
    guard identifier.hasPrefix(ritualPrefix) else { return nil }
    return identifier.dropFirst(ritualPrefix.count).split(separator: ".").first.map(String.init)
  }

  /// 계획·돌아보기 알림을 다음 7일치 예약한다. 고른 요일에만, 오늘 이미 마쳤으면 오늘 것은 뺀다.
  /// 문구는 Mac 알림과 같다(본문 없음).
  func syncReminders(_ model: AppModel) {
    let settings = model.settings
    let today = model.today
    let now = Date(timeIntervalSince1970: model.nowMs / 1000)
    var requests: [UNNotificationRequest] = []
    for offset in 0..<8 {
      let day = Domain.offsetDate(offset, today)
      guard settings.remindDays.contains(AppModel.weekday(day)) else { continue }
      for (kind, at, title, done) in [
        ("plan", settings.planAt, "계획 시작", model.plannedDate), ("review", settings.reviewAt, "돌아보기", model.reviewedDate),
      ] {
        let parts = at.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, done != day,
          let fire = CalendarTime.at(day, hour: parts[0], minute: parts[1]), fire > now
        else { continue }
        let content = UNMutableNotificationContent()
        content.title = title
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: fire.timeIntervalSince(now), repeats: false)
        requests.append(UNNotificationRequest(identifier: "\(Self.ritualPrefix)\(kind).\(day)", content: content, trigger: trigger))
      }
    }
    Task {
      let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(Self.ritualPrefix) }
      center.removePendingNotificationRequests(withIdentifiers: pending)
      for request in requests { try? await center.add(request) }
    }
  }
}
