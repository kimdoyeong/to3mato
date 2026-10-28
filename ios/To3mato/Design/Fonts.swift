import CoreText
import SwiftUI

/// 종이 위 글자는 Mac과 같은 손글씨 글꼴을 쓴다. 유리 위 글자는 시스템 글꼴을 쓴다.
enum AppFont {
  static let body = "PoorStory-Regular"
  static let display = "GamjaFlower-Regular"

  static func register() {
    for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [] {
      CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
  }
}

extension Font {
  /// `--font-body`, `--font-num`: 푸어스토리
  static func hand(_ size: CGFloat = TextSize.base, relativeTo style: Font.TextStyle = .body) -> Font {
    .custom(AppFont.body, size: size, relativeTo: style)
  }

  /// `--font-display`: 감자꽃
  static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title2) -> Font {
    .custom(AppFont.display, size: size, relativeTo: style)
  }
}

/// `--font-display`의 `Poor Story Digits` 규칙: 감자꽃의 0과 1이 o, l처럼 보여 숫자만 푸어스토리로 쓴다.
struct DisplayText: View {
  let text: String
  var size: CGFloat = TextSize.title

  init(_ text: String, size: CGFloat = TextSize.title) {
    self.text = text
    self.size = size
  }

  var body: some View {
    Text(attributed)
      .tracking(-0.04 * size)
      .foregroundStyle(Palette.ink)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var attributed: AttributedString {
    var result = AttributedString()
    var run = ""
    var digits = false
    func flush() {
      guard !run.isEmpty else { return }
      var piece = AttributedString(run)
      piece.font = digits ? .hand(size) : .display(size)
      result += piece
      run = ""
    }
    for character in text {
      let isDigit = character.isASCII && character.isNumber
      if isDigit != digits { flush() }
      digits = isDigit
      run.append(character)
    }
    flush()
    return result
  }
}
