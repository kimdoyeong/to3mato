// 자동 생성 파일: node scripts/generate-ios-tokens.mjs
// 원본은 src/styles/tokens.css다. 이 파일을 직접 고치지 않는다.
import SwiftUI

enum Palette {
  static let bg = Color(hex: 0xfff3e3)
  static let bgDots = Color(hex: 0xf8dcc0)
  static let paper = Color(hex: 0xfffdf8)
  static let paperWarm = Color(hex: 0xfff9f0)
  static let paperSoft = Color(hex: 0xfff9ef)
  static let paperTab = Color(hex: 0xffe9d2)
  static let ink = Color(hex: 0x4a3128)
  static let muted = Color(hex: 0x7f685a)
  static let inkSoft = Color(hex: 0xa8927f)
  static let inkHint = Color(hex: 0xb49a87)
  static let inkChip = Color(hex: 0x6f5535)
  static let line = Color(hex: 0xf1dcc7)
  static let lineStrong = Color(hex: 0xe8c9ad)
  static let lineCheck = Color(hex: 0xe2c6ae)
  static let strokeSoft = Color(hex: 0xc9b3a2)
  static let red = Color(hex: 0xd9452f)
  static let redHover = Color(hex: 0xc13a26)
  static let redDeep = Color(hex: 0xa62f1e)
  static let tomato = Color(hex: 0xef5b43)
  static let tomatoLight = Color(hex: 0xf8765f)
  static let tomatoHalf = Color(hex: 0xf8a593)
  static let coral = Color(hex: 0xf08b72)
  static let coralLight = Color(hex: 0xf4b69d)
  static let peach = Color(hex: 0xffe6d6)
  static let peachDeep = Color(hex: 0xf9c9ae)
  static let peachPanel = Color(hex: 0xffeadb)
  static let peachCurrent = Color(hex: 0xfff1e7)
  static let peachHover = Color(hex: 0xfff6ea)
  static let butter = Color(hex: 0xfff0c7)
  static let butterDeep = Color(hex: 0xf6dc92)
  static let butterInk = Color(hex: 0x7a6240)
  static let green = Color(hex: 0x4f8a3a)
  static let greenLight = Color(hex: 0xe5f2d6)
  static let greenHover = Color(hex: 0xd6eac1)
  static let leaf = Color(hex: 0x69a84f)
  static let leafLight = Color(hex: 0xb5d79b)
  static let leafPale = Color(hex: 0xc9d9b3)
  static let tapeGreen = Color(hex: 0xc9e3b3)
  static let done = Color(hex: 0xfaf3e8)
  static let highlight = Color(hex: 0xf2a24b)
  static let kraft = Color(hex: 0xe9d8c6)
  static let kraftDeep = Color(hex: 0xd8c2aa)
  static let toastShadow = Color(hex: 0x2e1c15)
}

enum TextSize {
  static let xs: CGFloat = 13
  static let sm: CGFloat = 14
  static let base: CGFloat = 16
  static let md: CGFloat = 17
  static let lg: CGFloat = 19
  static let xl: CGFloat = 22
  static let title: CGFloat = 27
  static let h2: CGFloat = 30
  static let h2Lg: CGFloat = 32
  static let h1: CGFloat = 40
  static let clock: CGFloat = 96
}

enum Space {
  static let s1: CGFloat = 4
  static let s2: CGFloat = 8
  static let s3: CGFloat = 12
  static let s4: CGFloat = 16
  static let s5: CGFloat = 20
  static let s6: CGFloat = 24
  static let s7: CGFloat = 28
  static let s8: CGFloat = 36
}

enum Wobble {
  static let s = WobbleRadii(h: [14, 18, 13, 17], v: [17, 13, 18, 14], relative: false)
  static let a = WobbleRadii(h: [24, 30, 22, 28], v: [28, 22, 30, 24], relative: false)
  static let b = WobbleRadii(h: [30, 22, 28, 24], v: [22, 28, 24, 30], relative: false)
  static let l = WobbleRadii(h: [38, 44, 36, 42], v: [42, 36, 44, 38], relative: false)
  static let xl = WobbleRadii(h: [34, 40, 32, 38], v: [38, 32, 40, 34], relative: false)
  static let row = WobbleRadii(h: [20, 24, 18, 22], v: [22, 18, 24, 20], relative: false)
  static let mode = WobbleRadii(h: [16, 20, 15, 19], v: [19, 15, 20, 16], relative: false)
  static let seg = WobbleRadii(h: [12, 9, 11, 9], v: [9, 11, 9, 12], relative: false)
  static let tab = WobbleRadii(h: [3, 16, 18, 3], v: [3, 18, 16, 3], relative: false)
  static let blob = WobbleRadii(h: [0.5, 0.46, 0.52, 0.48], v: [0.48, 0.52, 0.46, 0.5], relative: true)
}

enum Tilt {
  static let a: Double = -0.5
  static let b: Double = 0.4
  static let c: Double = -0.25
}
