import SwiftUI
import UserNotifications

@main
struct To3matoApp: App {
  @State private var model: AppModel
  @Environment(\.scenePhase) private var scenePhase

  init() {
    AppFont.register()
    let model = AppModel()
    model.start()
    _model = State(initialValue: model)
    // Live Activity의 일시정지·종료 버튼이 앱의 타이머 명령을 그대로 보낸다.
    TimerCommands.handler = { command in
      model.now = .now
      switch command {
      case .toggle: model.toggleTimer()
      case .end: model.endTimer()
      }
    }
    UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
    NotificationDelegate.shared.open = { model.runSheetOpen = true }
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .preferredColorScheme(.light)
        .onOpenURL { model.handle($0) }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { model.resume() }
    }
  }
}

/// 알림을 누르면 실행 화면(체크인 카드)을 연다. 앱이 앞에 있을 때도 알림을 보여준다.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
  static let shared = NotificationDelegate()
  var open: @MainActor () -> Void = {}

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound]
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
    await MainActor.run { open() }
  }
}
