import SwiftUI

/// 바탕: 점무늬 종이 `--bg` + `--bg-dots`
struct DotBackground: View {
  var body: some View {
    Canvas { context, size in
      let step: CGFloat = 26
      var y: CGFloat = 0
      while y < size.height + step {
        var x: CGFloat = 0
        while x < size.width + step {
          context.fill(
            Path(ellipseIn: CGRect(x: x - 1.3, y: y - 1.3, width: 2.6, height: 2.6)),
            with: .color(Palette.bgDots))
          x += step
        }
        y += step
      }
    }
    .background(Palette.bg)
    .ignoresSafeArea()
  }
}

enum PaperTone {
  case paper, peach, butter, done, current

  var fill: Color {
    switch self {
    case .paper: Palette.paper
    case .peach: Palette.peachPanel
    case .butter: Palette.butter
    case .done: Palette.done
    case .current: Palette.peachCurrent
    }
  }

  var border: Color {
    switch self {
    case .paper, .done: Palette.line
    case .peach: Palette.peachDeep
    case .butter: Palette.butterDeep
    case .current: Palette.coral
    }
  }

  var shadow: (Color, CGFloat) {
    switch self {
    case .paper: (Palette.line, 3)
    case .peach: (Palette.peachDeep, 5)
    case .butter: (Palette.butterDeep, 4)
    case .done: (.clear, 0)
    case .current: (Palette.peachDeep, 3)
    }
  }
}

enum TapeSpot { case center, left, right }

enum TapeColor {
  case yellow, pink, green

  var color: Color {
    switch self {
    case .yellow: Palette.butterDeep.opacity(0.72)
    case .pink: Palette.peachDeep.opacity(0.72)
    case .green: Palette.tapeGreen.opacity(0.72)
    }
  }
}

/// 테이프: 종이와 티켓을 붙이는 조각
struct Tape: View {
  var spot: TapeSpot = .center
  var color: TapeColor = .yellow

  var body: some View {
    Rectangle()
      .fill(color.color)
      .frame(width: 62, height: 18)
      .rotationEffect(.degrees(spot == .left ? -7 : spot == .right ? 6 : -3))
      .accessibilityHidden(true)
  }
}

/// 종이 카드: 삐뚤한 모서리와 아래쪽 그림자 한 겹
struct PaperModifier: ViewModifier {
  var tone: PaperTone = .paper
  var radii: WobbleRadii = Wobble.a
  var tilt: Double = 0
  var tape: TapeSpot?
  var tapeColor: TapeColor = .yellow
  var flat = false

  func body(content: Content) -> some View {
    let shape = WobbleShape(radii: radii)
    let (shadow, drop) = flat ? (Color.clear, 0) : tone.shadow
    content
      .background {
        ZStack {
          shape.fill(shadow).offset(y: drop)
          shape.fill(tone.fill)
          shape.strokeBorder(tone.border, lineWidth: 2)
        }
      }
      .overlay(alignment: tapeAlignment) {
        if tape != nil {
          Tape(spot: tape ?? .center, color: tapeColor)
            .padding(.horizontal, 28)
            .offset(y: -9)
        }
      }
      .rotationEffect(.degrees(tilt))
  }

  private var tapeAlignment: Alignment {
    switch tape {
    case .left: .topLeading
    case .right: .topTrailing
    default: .top
    }
  }
}

extension View {
  func paper(
    _ tone: PaperTone = .paper, radii: WobbleRadii = Wobble.a, tilt: Double = 0,
    tape: TapeSpot? = nil, tapeColor: TapeColor = .yellow, flat: Bool = false
  ) -> some View {
    modifier(
      PaperModifier(
        tone: tone, radii: radii, tilt: tilt, tape: tape, tapeColor: tapeColor, flat: flat))
  }

  /// 형광펜: 제목 아래 물결 밑줄
  func wave() -> some View {
    padding(.bottom, 6)
      .background(alignment: .bottom) {
        WaveLine()
          .stroke(Palette.highlight, style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
          .frame(height: 6)
          .clipped()
      }
  }

  /// 형광펜: 글자 뒤 노란 띠
  func highlighter() -> some View {
    background(alignment: .bottom) {
      LinearGradient(
        colors: [Palette.butter, Palette.butterDeep], startPoint: .top, endPoint: .bottom
      )
      .frame(height: 9)
      .padding(.bottom, 1)
    }
  }
}

/// 섹션 제목 + 숫자 배지
struct SectionTitle: View {
  let title: String
  var count: Int?
  var size: CGFloat = TextSize.xl

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      DisplayText(title, size: size)
      if let count { Badge(count) }
    }
    .wave()
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }
}

struct Badge: View {
  let value: Int
  init(_ value: Int) { self.value = value }

  var body: some View {
    Text("\(value)")
      .font(.hand(TextSize.xs))
      .foregroundStyle(Palette.redDeep)
      .padding(.horizontal, 8)
      .padding(.vertical, 1)
      .frame(minWidth: 24)
      .background(Palette.peach, in: Capsule())
  }
}

/// 프로젝트 칩
struct Chip: View {
  let text: String
  var dot: Color?

  var body: some View {
    HStack(spacing: 6) {
      if let dot {
        Circle().fill(dot).frame(width: 8, height: 8)
      }
      Text(text).lineLimit(1)
    }
    .font(.hand(TextSize.xs))
    .foregroundStyle(Palette.inkChip)
    .padding(.leading, 8)
    .padding(.trailing, 10)
    .padding(.vertical, 1)
    .background(Palette.butter, in: WobbleShape(radii: Wobble.s))
  }
}

/// 날짜 스티커
struct StickerDate: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.hand(TextSize.sm))
      .foregroundStyle(Palette.muted)
      .padding(.horizontal, 12)
      .padding(.vertical, 3)
      .background {
        WobbleShape(radii: Wobble.s).fill(Palette.paper)
        WobbleShape(radii: Wobble.s).strokeBorder(Palette.line, lineWidth: 2)
      }
      .rotationEffect(.degrees(1.2))
  }
}

/// 상태 꼬리표: 집중 중은 복숭아, 그 외는 초록
struct LiveTag: View {
  let text: String
  var running = false

  var body: some View {
    Text(text)
      .font(.hand(TextSize.sm))
      .foregroundStyle(running ? Palette.redDeep : Palette.green)
      .padding(.horizontal, 14)
      .padding(.vertical, 4)
      .background(
        running ? Palette.peach : Palette.greenLight, in: WobbleShape(radii: Wobble.s))
  }
}

/// 빈 목록 안내
struct EmptyNote: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.hand(TextSize.base))
      .foregroundStyle(Palette.muted)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 22)
      .background {
        WobbleShape(radii: Wobble.a)
          .strokeBorder(Palette.lineStrong, style: StrokeStyle(lineWidth: 2, dash: [6, 5]))
          .background(WobbleShape(radii: Wobble.a).fill(Palette.paperSoft))
      }
  }
}

/// iPad에서는 iPhone 레이아웃을 가운데 폭으로 유지한다. 스크롤은 화면 전체에서 된다.
struct ReadableWidth: ViewModifier {
  static let maxWidth: CGFloat = 680
  @State private var width: CGFloat = 0

  func body(content: Content) -> some View {
    content
      .contentMargins(.horizontal, max(0, (width - Self.maxWidth) / 2), for: .scrollContent)
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
  }
}

extension View {
  func readableWidth() -> some View { modifier(ReadableWidth()) }
}
