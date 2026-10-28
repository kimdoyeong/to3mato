import SwiftUI

// 조작 층: 내용은 종이, 조작은 유리.
// iOS 26은 Liquid Glass, iOS 18~25는 같은 자리를 .ultraThinMaterial로 그린다.
// 투명도 줄이기가 켜지면 Mac의 왼쪽 탭 띠 색(--paper-tab) 불투명 종이로 바꾼다.

struct GlassSurface<S: Shape>: ViewModifier {
  let shape: S
  /// 유리 아래에 까는 종이 색. 색은 유리가 아니라 유리 아래의 종이가 바꾼다.
  var paper: Color?
  var interactive = false
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func body(content: Content) -> some View {
    if reduceTransparency {
      content.background(paper ?? Palette.paperTab, in: shape)
    } else if #available(iOS 26.0, *) {
      content
        .glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        .background((paper ?? .clear).opacity(0.85), in: shape)
    } else {
      content
        .background(.ultraThinMaterial, in: shape)
        .background((paper ?? .clear).opacity(0.85), in: shape)
    }
  }
}

extension View {
  func glassSurface<S: Shape>(_ shape: S, paper: Color? = nil, interactive: Bool = false) -> some View {
    modifier(GlassSurface(shape: shape, paper: paper, interactive: interactive))
  }

  /// 유리 조작부를 한 컨테이너로 묶는다. iOS 26 미만에서는 그대로 둔다.
  @ViewBuilder func glassGroup(spacing: CGFloat = 12) -> some View {
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: spacing) { self }
    } else {
      self
    }
  }
}

/// 유리 위의 원형 아이콘 버튼. `prominent`는 하단 타이머 바의 재생·일시정지 하나만 쓴다(--red).
struct GlassIconButton: View {
  let systemImage: String
  let label: String
  var prominent = false
  var size: CGFloat = 44
  let action: () -> Void
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  var body: some View {
    Group {
      if #available(iOS 26.0, *), !reduceTransparency {
        if prominent {
          Button(action: action) { icon }
            .buttonStyle(.glassProminent)
            .tint(Palette.red)
        } else {
          Button(action: action) { icon }
            .buttonStyle(.glass)
        }
      } else {
        Button(action: action) {
          icon
            .foregroundStyle(prominent ? .white : Palette.ink)
            .background(prominent ? AnyShapeStyle(Palette.red) : AnyShapeStyle(.thinMaterial), in: Circle())
        }
        .buttonStyle(.plain)
      }
    }
    .buttonBorderShape(.circle)
    .accessibilityLabel(label)
  }

  private var icon: some View {
    Image(systemName: systemImage)
      .font(.system(size: size * 0.38, weight: .semibold))
      .frame(width: size, height: size)
  }
}
