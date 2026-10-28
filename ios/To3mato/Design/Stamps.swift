import SwiftUI

/// 도장: 연필 윤곽(empty) → 옅게 칠한 계획(plan) → 빨간 도장(filled). 절반(half), 초과(over)
enum TomatoVariant { case empty, plan, filled, half, over }

struct TomatoStamp: View {
  var variant: TomatoVariant = .empty
  var size: CGFloat = 18

  init(_ variant: TomatoVariant = .empty, size: CGFloat = 18) {
    self.variant = variant
    self.size = size
  }

  init(filled: Bool, size: CGFloat = 18) {
    self.init(filled ? .filled : .empty, size: size)
  }

  var body: some View {
    let (body, stroke, calyx) = colors
    ZStack {
      Self.body.fill(body)
      Self.body.stroke(
        stroke,
        style: StrokeStyle(
          lineWidth: 1.4 * size / 24, dash: variant == .over ? [3 * size / 24, 2 * size / 24] : []))
      Self.calyx.fill(calyx)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private var colors: (Color, Color, Color) {
    switch variant {
    case .empty: (Palette.paper, Palette.strokeSoft, Palette.leafPale)
    case .plan: (Palette.peach, Color(hex: 0xeba48f), Palette.leafLight)
    case .filled: (Palette.tomato, Palette.red, Palette.leaf)
    case .half: (Palette.tomatoHalf, Palette.red, Palette.leaf)
    case .over: (.white, Palette.red, Palette.red)
    }
  }

  static let body = ScaledPath(viewBox: CGSize(width: 24, height: 24)) { p in
    p.move(to: pt(12, 7))
    p.addCurve(to: pt(2.5, 13.5), control1: pt(7, 4.5), control2: pt(2, 8))
    p.addCurve(to: pt(12, 22), control1: pt(3, 18.5), control2: pt(7, 22))
    p.addCurve(to: pt(21.5, 13.5), control1: pt(17, 22), control2: pt(21, 18.5))
    p.addCurve(to: pt(12, 7), control1: pt(22, 8), control2: pt(17, 4.5))
    p.closeSubpath()
  }

  static let calyx = ScaledPath(viewBox: CGSize(width: 24, height: 24)) { p in
    p.addLines([
      pt(12, 8.5), pt(7.6, 8.1), pt(9.6, 6.1), pt(6.8, 4.9), pt(9.8, 4.5), pt(10.2, 2.3),
      pt(12, 4), pt(13.8, 2.3), pt(14.2, 4.5), pt(17.2, 4.9), pt(14.4, 6.1), pt(16.4, 8.1),
    ])
    p.closeSubpath()
  }
}

/// 예상 대비 기록: 토마토 도장 + `n / m`
struct Pomodoros: View {
  let estimate: Int
  var actual: Double = 0

  var body: some View {
    HStack(spacing: 2) {
      ForEach(0..<min(6, estimate), id: \.self) { i in
        TomatoStamp(filled: i < Int(actual.rounded(.down)), size: 15)
      }
      Text("\(actual.pomodoroText) / \(estimate)")
        .font(.hand(TextSize.xs))
        .foregroundStyle(Palette.muted)
        .padding(.leading, 4)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("예상 \(estimate)포모도로 / 기록 \(actual.pomodoroText)포모도로")
  }
}

/// 숫자 + 빨간 도장 하나
struct PomoCount: View {
  let value: String
  var filled = true
  var size: CGFloat = TextSize.sm

  var body: some View {
    HStack(spacing: 3) {
      Text(value).font(.hand(size))
      TomatoStamp(filled: filled, size: size + 1)
    }
  }
}

extension Double {
  /// 0.5 단위 포모도로를 Mac과 같이 `1`, `1.5`로 쓴다.
  var pomodoroText: String {
    rounded() == self ? String(Int(self)) : String(format: "%.1f", self)
  }
}

/// 손으로 두른 동그라미 번호
struct Circ: View {
  enum State { case idle, on, ok }
  enum Content { case number(Int), check }

  let content: Content
  var state: State = .idle

  var body: some View {
    ZStack {
      Self.outline.fill(fill)
      Self.outline.stroke(stroke, lineWidth: 1.6)
      switch content {
      case .number(let n):
        Text("\(n)").font(.hand(TextSize.sm))
      case .check:
        Image(systemName: "checkmark").font(.system(size: 12, weight: .heavy))
      }
    }
    .foregroundStyle(color)
    .frame(width: 30, height: 30)
  }

  private var fill: Color {
    switch state {
    case .idle: .white
    case .on: Palette.peach
    case .ok: Palette.greenLight
    }
  }

  private var stroke: Color {
    switch state {
    case .idle: Palette.strokeSoft
    case .on: Palette.red
    case .ok: Palette.leaf
    }
  }

  private var color: Color {
    switch state {
    case .idle: Palette.muted
    case .on: Palette.red
    case .ok: Palette.green
    }
  }

  static let outline = ScaledPath(viewBox: CGSize(width: 30, height: 30)) { p in
    p.move(to: pt(15.5, 3.5))
    p.addCurve(to: pt(26.5, 15), control1: pt(22, 2.5), control2: pt(27, 7.5))
    p.addCurve(to: pt(15, 26.5), control1: pt(26, 22.5), control2: pt(22, 27))
    p.addCurve(to: pt(3.5, 15), control1: pt(8, 26), control2: pt(3, 22.5))
    p.addCurve(to: pt(15.5, 3.5), control1: pt(4, 7.5), control2: pt(9, 4.5))
    p.closeSubpath()
  }
}

/// 손그림 선: 진행 막대
struct HandBar: View {
  var value: Double
  var color: Color = Palette.tomato
  var track: Color = .white

  var body: some View {
    ZStack {
      Self.line.stroke(track, style: StrokeStyle(lineWidth: 6, lineCap: .round))
      Self.line
        .trim(from: 0, to: max(0, min(1, value)))
        .stroke(color, style: StrokeStyle(lineWidth: 5, lineCap: .round))
    }
    .frame(height: 14)
  }

  static let line = ScaledPath(viewBox: CGSize(width: 240, height: 14)) { p in
    p.move(to: pt(3, 8))
    p.addCurve(to: pt(120, 7), control1: pt(43, 5), control2: pt(81, 11))
    p.addCurve(to: pt(237, 6), control1: pt(159, 3), control2: pt(198, 9))
  }
}

/// 마스코트: 토마토 얼굴. 휴식 중에는 눈을 감는다.
struct Mascot: View {
  var resting = false
  var size: CGFloat = 120

  var body: some View {
    ZStack {
      Self.body.fill(Palette.tomato)
      Self.leaf.fill(Palette.leaf)
      if resting {
        Self.closedEyes.stroke(Palette.ink, style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
      } else {
        Self.eyes.fill(Palette.ink)
      }
      Self.mouth.stroke(Palette.ink, style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
    }
    .frame(width: size, height: size * 48 / 52)
    .accessibilityHidden(true)
  }

  private static let box = CGSize(width: 52, height: 48)

  static let body = ScaledPath(viewBox: box) { p in
    p.move(to: pt(26, 14))
    p.addCurve(to: pt(2.5, 26), control1: pt(18, 8), control2: pt(3, 11))
    p.addCurve(to: pt(26, 46), control1: pt(2, 38), control2: pt(12, 46))
    p.addCurve(to: pt(49.5, 26), control1: pt(40, 46), control2: pt(50, 38))
    p.addCurve(to: pt(26, 14), control1: pt(49, 11), control2: pt(34, 8))
    p.closeSubpath()
  }

  static let leaf = ScaledPath(viewBox: box) { p in
    p.addLines([
      pt(26, 15), pt(18, 16), pt(22, 11), pt(15, 8), pt(23, 7), pt(21, 1), pt(26, 5),
      pt(31, 1), pt(29, 7), pt(37, 8), pt(30, 11), pt(34, 16),
    ])
    p.closeSubpath()
  }

  static let eyes = ScaledPath(viewBox: box) { p in
    p.addEllipse(in: CGRect(x: 16.3, y: 25.8, width: 4.4, height: 4.4))
    p.addEllipse(in: CGRect(x: 31.3, y: 25.8, width: 4.4, height: 4.4))
  }

  static let closedEyes = ScaledPath(viewBox: box) { p in
    p.move(to: pt(16, 28))
    p.addQuadCurve(to: pt(21, 28), control: pt(18.5, 30))
    p.move(to: pt(31, 28))
    p.addQuadCurve(to: pt(36, 28), control: pt(33.5, 30))
  }

  static let mouth = ScaledPath(viewBox: box) { p in
    p.move(to: pt(23, 33))
    p.addQuadCurve(to: pt(29, 33), control: pt(26, 36.5))
  }
}

/// Mac의 선 아이콘을 가장 가까운 SF Symbols로 옮긴다.
enum AppIcon {
  static func symbol(_ name: String) -> String {
    switch name {
    case "todo": "checklist"
    case "folder": "folder"
    case "calendar": "calendar"
    case "camera": "camera"
    case "settings": "slider.horizontal.3"
    case "book": "book"
    case "leaf": "leaf"
    case "cup": "cup.and.saucer"
    case "star": "star.fill"
    case "heart": "heart"
    default: "folder"
    }
  }
}
