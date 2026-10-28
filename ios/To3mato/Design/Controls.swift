import SwiftUI

// 종이 카드 안의 버튼은 Mac과 같은 손글씨 버튼 스타일을 쓴다.

/// `.primary`: 빨간 알약 버튼
struct PrimaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    configuration.label
      .font(.hand(TextSize.lg))
      .foregroundStyle(.white)
      .padding(.horizontal, 26)
      .padding(.top, 11)
      .padding(.bottom, 10)
      .background {
        ZStack {
          Capsule().fill(enabled ? Palette.redDeep : Color(hex: 0xcfa89c))
            .offset(y: pressed ? 1 : 4)
          Capsule().fill(pressed ? Palette.redHover : Palette.red)
        }
      }
      .offset(y: pressed ? 3 : 0)
      .opacity(enabled ? 1 : 0.6)
  }
}

/// `.btn-line`: 흰 바탕 연필 테두리
struct LineButtonStyle: ButtonStyle {
  var pressed = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    let on = pressed || configuration.isPressed
    configuration.label
      .font(.hand(15))
      .foregroundStyle(on ? Palette.redDeep : Palette.muted)
      .padding(.horizontal, 12)
      .padding(.vertical, 5)
      .background {
        WobbleShape(radii: Wobble.s).fill(on ? Palette.peach : .white)
        WobbleShape(radii: Wobble.s).strokeBorder(on ? Palette.coral : Palette.lineStrong, lineWidth: 2)
      }
      .opacity(enabled ? 1 : 0.5)
  }
}

/// `.btn-text`, `.text-button`
struct TextButtonStyle: ButtonStyle {
  var size: CGFloat = TextSize.base
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.hand(size))
      .foregroundStyle(configuration.isPressed ? Palette.red : Palette.muted)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(configuration.isPressed ? Palette.peach : .clear, in: RoundedRectangle(cornerRadius: 14))
      .opacity(enabled ? 1 : 0.5)
  }
}

/// `.btn-dash`: 점선 테두리 추가 버튼
struct DashButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    configuration.label
      .font(.hand(TextSize.base))
      .foregroundStyle(pressed ? Palette.red : Palette.muted)
      .padding(.horizontal, 14)
      .padding(.vertical, 9)
      .background {
        WobbleShape(radii: Wobble.s).fill(pressed ? Palette.peach : .clear)
        WobbleShape(radii: Wobble.s)
          .strokeBorder(
            pressed ? Palette.coral : Palette.lineStrong, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
      }
      .opacity(enabled ? 1 : 0.5)
  }
}

/// `.secondary`: 설정 카드의 보조 버튼
struct SecondaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.hand(TextSize.base))
      .foregroundStyle(Palette.ink)
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .background {
        WobbleShape(radii: Wobble.s).fill(configuration.isPressed ? Palette.peach : Palette.paper)
        WobbleShape(radii: Wobble.s).strokeBorder(Palette.lineStrong, lineWidth: 2)
      }
      .opacity(enabled ? 1 : 0.5)
  }
}

/// `.step`: 스테퍼의 − + 버튼
struct StepButton: View {
  let symbol: String
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Text(symbol)
        .font(.system(size: 18))
        .frame(width: 28, height: 28)
    }
    .buttonStyle(StepButtonStyle())
    .accessibilityLabel(label)
  }
}

struct StepButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(configuration.isPressed ? Palette.red : Palette.muted)
      .background {
        WobbleShape(radii: Wobble.blob).fill(.white)
        WobbleShape(radii: Wobble.blob)
          .strokeBorder(configuration.isPressed ? Palette.red : Palette.lineStrong, lineWidth: 2)
      }
      .opacity(enabled ? 1 : 0.4)
      .contentShape(Rectangle().inset(by: -8))
  }
}

/// 이름 + − 숫자 + 스테퍼
struct CountStepper: View {
  let label: String
  @Binding var value: Int
  var range: ClosedRange<Int>
  var decreaseLabel: String
  var increaseLabel: String

  var body: some View {
    HStack(spacing: 8) {
      Text(label).font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
      StepButton(symbol: "−", label: decreaseLabel) { value -= 1 }
        .disabled(value <= range.lowerBound)
      Text("\(value)")
        .font(.hand(TextSize.lg))
        .foregroundStyle(Palette.ink)
        .frame(minWidth: 22)
        .contentTransition(.numericText())
      StepButton(symbol: "+", label: increaseLabel) { value += 1 }
        .disabled(value >= range.upperBound)
    }
  }
}

/// `.seg`: 예상 포모도로 1 | 2
struct EstimatePicker: View {
  let value: Int
  var locked = false
  var label = "예상 포모도로"
  var onChange: (Int) -> Void = { _ in }

  var body: some View {
    HStack(spacing: 0) {
      if value > AppModel.maxTaskEstimate {
        segment(value, on: true)
      } else {
        ForEach(1...AppModel.maxTaskEstimate, id: \.self) { option in
          Button {
            onChange(option)
          } label: {
            segment(option, on: option == value)
          }
          .buttonStyle(.plain)
          .disabled(locked)
          .accessibilityAddTraits(option == value ? .isSelected : [])
        }
      }
    }
    .background(.white, in: WobbleShape(radii: Wobble.seg))
    .clipShape(WobbleShape(radii: Wobble.seg))
    .overlay(WobbleShape(radii: Wobble.seg).strokeBorder(Palette.lineStrong, lineWidth: 2))
    .opacity(locked ? 0.5 : 1)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }

  private func segment(_ n: Int, on: Bool) -> some View {
    Text("\(n)")
      .font(.hand(15))
      .foregroundStyle(on ? Palette.redDeep : Palette.muted)
      .frame(width: 30, height: 28)
      .background(on ? Palette.peach : .clear)
  }
}

/// `.play`: 할 일 행의 재생 버튼
struct PlayButton: View {
  var active = false
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: active ? "pause.fill" : "play.fill")
        .font(.system(size: 15))
        .foregroundStyle(active ? .white : Palette.green)
        .frame(width: 40, height: 40)
        .background {
          WobbleShape(radii: Wobble.blob).fill(active ? Palette.red : .white)
          WobbleShape(radii: Wobble.blob).strokeBorder(active ? Palette.red : Palette.lineStrong, lineWidth: 2)
        }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

/// `.end-button`: 흰 동그라미 종료 버튼
struct EndButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    let pressed = configuration.isPressed
    configuration.label
      .font(.system(size: 16))
      .foregroundStyle(Palette.muted)
      .frame(width: 50, height: 50)
      .background {
        Circle().fill(Palette.peachDeep).offset(y: pressed ? 1 : 3)
        Circle().fill(.white)
        Circle().strokeBorder(Palette.peachDeep, lineWidth: 2)
      }
      .offset(y: pressed ? 2 : 0)
      .opacity(enabled ? 1 : 0.5)
  }
}

/// `.check`: 동그라미 체크
struct CheckBox: View {
  let checked: Bool
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      ZStack {
        WobbleShape(radii: Wobble.blob).fill(checked ? Palette.leaf : .white)
        WobbleShape(radii: Wobble.blob).strokeBorder(checked ? Palette.leaf : Palette.lineCheck, lineWidth: 2.5)
        if checked {
          Image(systemName: "checkmark").font(.system(size: 13, weight: .heavy)).foregroundStyle(.white)
        }
      }
      .frame(width: 29, height: 29)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

/// 폼 입력 칸: 종이 바탕 + 연필 테두리
struct FieldBox: ViewModifier {
  func body(content: Content) -> some View {
    content
      .font(.hand(TextSize.md))
      .foregroundStyle(Palette.ink)
      .padding(.horizontal, 14)
      .padding(.vertical, 11)
      .background {
        WobbleShape(radii: Wobble.s).fill(.white)
        WobbleShape(radii: Wobble.s).strokeBorder(Palette.lineStrong, lineWidth: 2)
      }
  }
}

/// 이름이 위에 붙는 입력 항목
struct LabeledField<Content: View>: View {
  let label: String
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label).font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
      content
    }
  }
}

extension View {
  func fieldBox() -> some View { modifier(FieldBox()) }
}

/// 오류 문구
struct FormError: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.hand(TextSize.sm))
      .foregroundStyle(Palette.redDeep)
      .accessibilityAddTraits(.isStaticText)
  }
}
