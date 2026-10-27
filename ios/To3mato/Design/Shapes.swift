import SwiftUI

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xff) / 255,
      green: Double((hex >> 8) & 0xff) / 255,
      blue: Double(hex & 0xff) / 255
    )
  }

  init(hexString: String) {
    self.init(hex: UInt32(hexString.trimmingCharacters(in: ["#"]), radix: 16) ?? 0)
  }
}

/// CSS `border-radius: h1 h2 h3 h4 / v1 v2 v3 v4`. 순서는 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래.
struct WobbleRadii {
  let h: [CGFloat]
  let v: [CGFloat]
  /// `--blob`처럼 퍼센트 값이면 너비와 높이에 곱한다.
  let relative: Bool
}

/// 손으로 그린 듯 살짝 삐뚤한 모서리. 종이에만 쓴다.
struct WobbleShape: InsettableShape {
  var radii: WobbleRadii
  var inset: CGFloat = 0

  func path(in rect: CGRect) -> Path {
    let r = rect.insetBy(dx: inset, dy: inset)
    guard r.width > 0, r.height > 0 else { return Path() }
    let rx = radii.h.map { radii.relative ? $0 * r.width : $0 }
    let ry = radii.v.map { radii.relative ? $0 * r.height : $0 }
    // CSS와 같이 반지름 합이 변보다 길면 전체를 같은 비율로 줄인다.
    let f = min(
      1,
      r.width / max(rx[0] + rx[1], 0.01),
      r.width / max(rx[3] + rx[2], 0.01),
      r.height / max(ry[0] + ry[3], 0.01),
      r.height / max(ry[1] + ry[2], 0.01)
    )
    let x = rx.map { $0 * f }
    let y = ry.map { $0 * f }
    let k: CGFloat = 0.5523
    var p = Path()
    p.move(to: CGPoint(x: r.minX + x[0], y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX - x[1], y: r.minY))
    p.addCurve(
      to: CGPoint(x: r.maxX, y: r.minY + y[1]),
      control1: CGPoint(x: r.maxX - x[1] * (1 - k), y: r.minY),
      control2: CGPoint(x: r.maxX, y: r.minY + y[1] * (1 - k)))
    p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - y[2]))
    p.addCurve(
      to: CGPoint(x: r.maxX - x[2], y: r.maxY),
      control1: CGPoint(x: r.maxX, y: r.maxY - y[2] * (1 - k)),
      control2: CGPoint(x: r.maxX - x[2] * (1 - k), y: r.maxY))
    p.addLine(to: CGPoint(x: r.minX + x[3], y: r.maxY))
    p.addCurve(
      to: CGPoint(x: r.minX, y: r.maxY - y[3]),
      control1: CGPoint(x: r.minX + x[3] * (1 - k), y: r.maxY),
      control2: CGPoint(x: r.minX, y: r.maxY - y[3] * (1 - k)))
    p.addLine(to: CGPoint(x: r.minX, y: r.minY + y[0]))
    p.addCurve(
      to: CGPoint(x: r.minX + x[0], y: r.minY),
      control1: CGPoint(x: r.minX, y: r.minY + y[0] * (1 - k)),
      control2: CGPoint(x: r.minX + x[0] * (1 - k), y: r.minY))
    p.closeSubpath()
    return p
  }

  func inset(by amount: CGFloat) -> WobbleShape {
    var shape = self
    shape.inset += amount
    return shape
  }
}

/// SVG 좌표로 그린 경로를 rect 크기에 맞춰 늘린다.
struct ScaledPath: Shape {
  let viewBox: CGSize
  let build: (inout Path) -> Void

  func path(in rect: CGRect) -> Path {
    var p = Path()
    build(&p)
    return p.applying(
      CGAffineTransform(translationX: rect.minX, y: rect.minY)
        .scaledBy(x: rect.width / viewBox.width, y: rect.height / viewBox.height))
  }
}

func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

/// 제목 아래 물결 밑줄. `.wave`
struct WaveLine: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    let mid = rect.midY
    var x = rect.minX
    p.move(to: pt(x, mid))
    while x < rect.maxX {
      p.addQuadCurve(to: pt(x + 8, mid), control: pt(x + 4, mid - 4))
      p.addQuadCurve(to: pt(x + 16, mid), control: pt(x + 12, mid + 4))
      x += 16
    }
    return p
  }
}
