import Foundation

// 기기 저장. 파일 하나를 통째로 원자적으로 바꿔 써서 확정 문서, 미전송 작업, 화면 상태가 함께 기록된다.

enum AtomicFile {
  static func read(_ url: URL) throws -> JSON? {
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try JSON.parse(Data(contentsOf: url))
  }

  static func write(_ value: JSON, to url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var options: Data.WritingOptions = [.atomic]
    #if os(iOS)
      options.insert(.completeFileProtectionUntilFirstUserAuthentication)
    #endif
    try value.data().write(to: url, options: options)
  }
}

/// 연동하지 않은 기기 데이터. Mac의 JSON 내보내기와 같은 모양으로 저장한다.
public final class LocalStore: @unchecked Sendable {
  public let url: URL
  private let lock = NSLock()

  public init(url: URL) { self.url = url }

  /// 파일이 없으면 첫 실행 데이터를 돌려준다.
  public func load() throws -> AppState {
    try lock.withLock {
      guard let raw = try AtomicFile.read(url) else { return Domain.createInitialState() }
      return try Domain.normalizeState(raw)
    }
  }

  public func save(_ state: AppState) throws {
    try lock.withLock { try AtomicFile.write(state.json, to: url) }
  }

  public var exists: Bool { FileManager.default.fileExists(atPath: url.path) }
}

/// 계정별 동기화 저장소. 계정마다 다른 폴더를 쓴다.
public final class FileEnvelopeRepository: SyncRepository, @unchecked Sendable {
  public let directory: URL
  public let owner: String
  private let lock = NSLock()
  private var value: Envelope

  public static func directory(root: URL, owner: String) throws -> URL {
    guard owner.range(of: "^[a-zA-Z0-9-]{1,80}$", options: .regularExpression) != nil else {
      throw DomainError("잘못된 계정입니다.")
    }
    return root.appendingPathComponent("accounts", isDirectory: true).appendingPathComponent(owner, isDirectory: true)
  }

  public static func exists(root: URL, owner: String) -> Bool {
    guard let directory = try? directory(root: root, owner: owner) else { return false }
    return FileManager.default.fileExists(atPath: directory.appendingPathComponent("envelope.json").path)
  }

  public init(root: URL, owner: String, seed: AppState = SyncProtocol.emptyState()) throws {
    self.owner = owner
    directory = try Self.directory(root: root, owner: owner)
    let file = directory.appendingPathComponent("envelope.json")
    if let raw = try AtomicFile.read(file) {
      value = try Envelope(json: raw)
    } else {
      value = try Envelope(state: seed, owner: owner)
      try AtomicFile.write(value.json, to: file)
    }
  }

  private var file: URL { directory.appendingPathComponent("envelope.json") }

  public func read() -> Envelope { lock.withLock { value } }

  public func write(_ next: Envelope) throws {
    guard next.owner == owner else { throw DomainError("계정 저장소가 일치하지 않습니다.") }
    try lock.withLock {
      try AtomicFile.write(next.json, to: file)
      value = next
    }
  }

  /// 처음 연동하기 전 복구 지점
  public func backup() throws {
    let target = directory.appendingPathComponent("backup-\(Int(epochMilliseconds())).json")
    try AtomicFile.write(read().json, to: target)
  }
}

/// 시험과 미리보기용
public final class MemoryRepository: SyncRepository, @unchecked Sendable {
  private let lock = NSLock()
  private var value: Envelope
  public init(_ value: Envelope) { self.value = value }
  public func read() -> Envelope { lock.withLock { value } }
  public func write(_ next: Envelope) throws { lock.withLock { value = next } }
}
