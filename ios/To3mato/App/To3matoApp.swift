import SwiftUI

@main
struct To3matoApp: App {
  @State private var model: AppModel

  init() {
    AppFont.register()
    let model = AppModel.sample()
    _model = State(initialValue: model)
    // Live Activity의 일시정지·종료 버튼이 앱의 타이머 명령을 그대로 보낸다.
    TimerCommands.handler = { command in
      model.now = .now
      switch command {
      case .toggle: model.toggleTimer()
      case .end: model.endTimer()
      }
    }
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .preferredColorScheme(.light)
    }
  }
}
