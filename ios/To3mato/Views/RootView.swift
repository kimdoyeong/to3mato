import SwiftUI

/// 유리 탭 바 네 개.
/// iPhone은 어느 탭에서도 탭 바 위의 타이머 바가 유지된다.
/// iPad는 Mac처럼 왼쪽 작업 영역과 오른쪽 실행 영역을 한 화면에 둔다.
struct RootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.horizontalSizeClass) private var sizeClass
  @AppStorage("onboarding-done") private var onboardingDone = false

  private var wide: Bool { sizeClass == .regular }

  var body: some View {
    HStack(spacing: 0) {
      tabs
      if wide {
        Rectangle()
          .fill(Palette.line)
          .frame(width: 2)
          .ignoresSafeArea()
        ExecutionPanel()
          .frame(width: 400)
      }
    }
    .environment(\.showsTimerBar, !wide)
    .sheet(isPresented: Binding(get: { model.runSheetOpen && !wide }, set: { model.runSheetOpen = $0 })) {
      RunSheet()
    }
    .fullScreenCover(isPresented: Bindable(model).reviewOpen) {
      ReviewScreen()
    }
    .fullScreenCover(isPresented: Binding(get: { !onboardingDone }, set: { onboardingDone = !$0 })) {
      OnboardingScreen { onboardingDone = true }
    }
    .overlay(alignment: .top) { ToastView() }
    .task {
      while !Task.isCancelled {
        model.tick(.now)
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  private var tabs: some View {
    @Bindable var model = model
    return TabView(selection: $model.tab) {
      Tab("할 일", systemImage: AppIcon.symbol("todo"), value: AppTab.todo) {
        TodoScreen().timerBarInset()
      }
      Tab("프로젝트", systemImage: AppIcon.symbol("folder"), value: AppTab.projects) {
        ProjectsScreen().timerBarInset()
      }
      Tab("캘린더", systemImage: AppIcon.symbol("calendar"), value: AppTab.calendar) {
        CalendarScreen().timerBarInset()
      }
      Tab("집중 로그", systemImage: AppIcon.symbol("camera"), value: AppTab.log) {
        FocusLogScreen().timerBarInset()
      }
    }
    .tint(Palette.red)
  }
}

extension EnvironmentValues {
  /// iPad 두 열 화면에서는 오른쪽 실행 영역이 타이머 바를 대신한다.
  @Entry var showsTimerBar = true
}

extension View {
  /// 탭 내용 아래에 하단 타이머 바를 붙인다.
  func timerBarInset() -> some View { modifier(TimerBarInset()) }
}

private struct TimerBarInset: ViewModifier {
  @Environment(\.showsTimerBar) private var showsTimerBar

  func body(content: Content) -> some View {
    content.safeAreaInset(edge: .bottom, spacing: 0) {
      if showsTimerBar {
        TimerBar()
          .frame(maxWidth: ReadableWidth.maxWidth)
          .padding(.horizontal, 12)
          .padding(.bottom, 6)
      }
    }
  }
}

/// Mac의 `.toast`와 같은 처리 결과 알림
struct ToastView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let text = model.toast {
      Text(text)
        .font(.hand(TextSize.base))
        .foregroundStyle(Palette.paper)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Palette.ink, in: WobbleShape(radii: Wobble.s))
        .shadow(color: Palette.toastShadow.opacity(0.25), radius: 0, y: 3)
        .padding(.top, 8)
        .transition(.move(edge: .top).combined(with: .opacity))
        .accessibilityAddTraits(.updatesFrequently)
        .id(text)
    }
  }
}
