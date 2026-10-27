import SwiftUI
import To3matoCore

/// 첫 실행 안내 4단계와 계정 단계. 문구는 Mac의 Onboarding과 같다.
struct OnboardingScreen: View {
  let finish: () -> Void
  @Environment(AppModel.self) private var model
  @State private var step = 0

  private let intro: [(title: String, body: [String])] = [
    ("일단 3번만 해봅시다. 토오오오마토.", ["당신은 오늘 몇 개의 포모도로를 완료할 수 있을까요?", "기록이 자산이 되는 포모도로 앱입니다."]),
    ("할 일을 정리", ["날짜와 프로젝트로 분류하고 예상 포모도로를 입력합니다."]),
    ("하나를 실행", ["할 일의 재생 버튼을 누르면 해당 작업의 타이머가 시작됩니다."]),
    ("기록을 확인", ["예상량과 실제 기록을 비교해 다음 할 일의 분량을 정합니다."]),
  ]

  var body: some View {
    let last = intro.count
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        ForEach(0...last, id: \.self) { i in
          Capsule()
            .fill(i == step ? Palette.red : Palette.lineStrong)
            .frame(width: i == step ? 22 : 8, height: 8)
        }
      }
      .padding(.top, 24)
      .accessibilityHidden(true)

      Spacer()

      VStack(spacing: 18) {
        if step < last {
          art.frame(height: 140)
          HStack(spacing: 8) {
            if step > 0 { Circ(content: .number(step), state: .on) }
            DisplayText(intro[step].title, size: TextSize.title)
              .multilineTextAlignment(.center)
          }
          .modifier(WaveIf(on: step > 0))
          .accessibilityAddTraits(.isHeader)
          ForEach(intro[step].body, id: \.self) { line in
            Text(line)
              .font(.hand(TextSize.md))
              .foregroundStyle(Palette.muted)
              .multilineTextAlignment(.center)
          }
        } else {
          SectionTitle(title: "계정", size: TextSize.title)
          if !model.account.configured {
            body("이 실행 환경에서는 계정 기능을 사용할 수 없습니다.")
          } else if let user = model.account.user {
            body(user.email ?? "")
            if !model.account.enabled { body("연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.") }
          } else {
            body("연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.")
            AuthForm()
              .padding(.top, 8)
          }
          if !model.account.error.isEmpty {
            FormError(text: model.account.error)
          }
        }
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 30)
      .frame(maxWidth: .infinity)
      .paper(radii: Wobble.l, tape: .center)
      .frame(maxWidth: 560)
      .padding(.horizontal, 20)
      .animation(.snappy, value: step)

      Spacer()

      HStack {
        if step < last {
          Button("건너뛰기", action: finish).buttonStyle(TextButtonStyle())
          Spacer()
          if step > 0 {
            Button("이전") { step -= 1 }.buttonStyle(LineButtonStyle())
          }
          Button("다음") { step += 1 }.buttonStyle(PrimaryButtonStyle())
        } else {
          Button("이전") { step -= 1 }.buttonStyle(LineButtonStyle())
          Spacer()
          if !model.account.configured || model.account.enabled {
            Button("시작", action: finish).buttonStyle(PrimaryButtonStyle())
          } else if model.account.user == nil {
            Button("로그인 없이 시작", action: finish).buttonStyle(TextButtonStyle())
          } else {
            Button("나중에", action: finish).buttonStyle(TextButtonStyle())
            Button("연동") {
              model.enableSync()
              finish()
            }
            .buttonStyle(PrimaryButtonStyle())
          }
        }
      }
      .frame(maxWidth: 560)
      .padding(.horizontal, 24)
      .padding(.bottom, 20)
    }
    .background(DotBackground())
  }

  private func body(_ text: String) -> some View {
    Text(text)
      .font(.hand(TextSize.md))
      .foregroundStyle(Palette.muted)
      .multilineTextAlignment(.center)
  }

  @ViewBuilder private var art: some View {
    switch step {
    case 0:
      Mascot(size: 130)
    case 1:
      HStack(spacing: 8) { ForEach(0..<3, id: \.self) { _ in TomatoStamp(.plan, size: 34) } }
    case 2:
      Mascot(size: 130)
    default:
      HStack(spacing: 8) {
        ForEach(0..<4, id: \.self) { i in TomatoStamp(i < 3 ? .filled : .plan, size: 34) }
      }
    }
  }
}

private struct WaveIf: ViewModifier {
  let on: Bool
  func body(content: Content) -> some View {
    if on { content.wave() } else { content }
  }
}
