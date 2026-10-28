import Foundation
import SwiftUI
import To3matoCloud
import To3matoCore

// 할 일, 프로젝트, 기록, 티켓, 템플릿, 타이머, 설정 타입은 To3matoCore에 있다.
// 여기에는 화면에서만 쓰는 값과 변환을 둔다.

typealias TodoSection = Domain.TodoSection

extension Project {
  var tint: Color { Color(hexString: color) }
}

extension FocusRecord {
  var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

enum TicketSticker: String, CaseIterable {
  case none = "", star, heart, leaf
}

extension Ticket {
  var completedDate: Date { Date(timeIntervalSince1970: completedAt / 1000) }
  var stickerKind: TicketSticker { TicketSticker(rawValue: sticker) ?? .none }
}

extension TimerState {
  func elapsedSeconds(at date: Date) -> Double { Domain.elapsedSeconds(self, epochMilliseconds(date)) }
}

struct ProjectSummary {
  var tickets: Int
  var left: Int
  var used: Double
  var remaining: Int
  var progress: Double
  var recent: [Ticket]
}

struct TicketWeek: Identifiable {
  var id: String
  var label: String
  var tickets: [Ticket]
}

/// 집중 로그의 3초 영상. 촬영과 전송은 다음 단계에서 붙인다.
struct Clip: Identifiable, Hashable {
  var id: String
  var taskTitle: String
  var at: Date
}

/// 월요일에 배달되는 영상 편지
struct Delivery: Identifiable, Hashable {
  var id: String
  var start: Date
  var end: Date
  var clipCount: Int
  var duration: Double
  var seen: Bool
}

/// 계정과 연동 상태. Mac의 AccountStatus와 같은 항목이다.
struct AccountState: Equatable {
  var configured = false
  var user: AccountUser?
  var enabled = false
  var connection = "off"
  var pending = 0
  var conflicts: [JSON] = []
  var error = ""
  var linkSent = false
  var busy = false
}

/// 프로젝트 표지 이미지. 기기 안에 저장하고 프로젝트에는 파일 이름만 둔다.
enum ProjectImages {
  static var directory: URL {
    AppPaths.root.appendingPathComponent("project-images", isDirectory: true)
  }

  static func image(named name: String) -> UIImage? {
    guard !name.isEmpty else { return nil }
    return UIImage(contentsOfFile: directory.appendingPathComponent(name).path)
  }

  /// JPEG로 줄여 저장하고 파일 이름을 돌려준다.
  static func store(_ data: Data) throws -> String {
    guard let image = UIImage(data: data) else { throw DomainError("입력 내용을 확인하세요.") }
    let scale = min(1, 1600 / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    guard let jpeg = resized.jpegData(compressionQuality: 0.85) else { throw DomainError("입력 내용을 확인하세요.") }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let name = "cover-\(IDs.make()).jpg"
    try jpeg.write(to: directory.appendingPathComponent(name), options: .atomic)
    return name
  }
}

enum AppPaths {
  static var root: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("To3mato", isDirectory: true)
  }

  static var localState: URL { root.appendingPathComponent("local-state.json") }
  static var binding: URL { root.appendingPathComponent("account-binding.json") }
}
