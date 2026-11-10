import Foundation

// 익명 사용 통계. Mac의 electron/analytics.mjs와 같은 전송 형식과 규칙을 쓴다.
// 설치 ID는 무작위 값이고 이 기기의 파일에만 둔다. 계정과 연결하지 않고 동기화하지 않는다.

public enum AnalyticsConfig {
  // 두 값은 src/lib/analytics.mjs의 POSTHOG_KEY, POSTHOG_HOST와 같아야 한다.
  // 키가 비어 있으면 아무것도 기록하거나 보내지 않는다.
  public static let key = "phc_vRtA3xJbYkjXQoMVQmZM8nFhEGbRjJnNBtuEpn2chJ5j"
  public static let host = "https://us.i.posthog.com"

  /// 시험 실행 중인지
  public static var testing: Bool {
    ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
      || NSClassFromString("XCTestCase") != nil
  }

  /// 키가 있는 릴리스 빌드에서만 보낸다. 디버그 빌드와 시험 실행에서는 보내지 않는다.
  public static func active(key: String = key, debug: Bool, testing: Bool = testing) -> Bool {
    !key.isEmpty && !debug && !testing
  }
}

public protocol AnalyticsTransport: Sendable {
  /// HTTP 상태 코드를 돌려준다. 연결 실패는 던진다.
  func send(_ request: URLRequest) async throws -> Int
}

public struct URLSessionAnalyticsTransport: AnalyticsTransport {
  private static let session = URLSession(configuration: .ephemeral)

  public init() {}

  public func send(_ request: URLRequest) async throws -> Int {
    let (_, response) = try await Self.session.data(for: request)
    return (response as? HTTPURLResponse)?.statusCode ?? 0
  }
}

public final class Analytics: @unchecked Sendable {
  public struct Status: Equatable, Sendable {
    public var available = false
    public var enabled = false

    public init(available: Bool = false, enabled: Bool = false) {
      self.available = available
      self.enabled = enabled
    }
  }

  static let flushInterval: UInt64 = 30
  static let flushSize = 20
  static let batchSize = 100
  static let queueLimit = 500

  private let lock = NSLock()
  private let file: URL
  private let key: String
  private let endpoint: URL?
  private let available: Bool
  private let transport: AnalyticsTransport
  private let shared: [String: JSON]
  private let now: @Sendable () -> Date
  private var id = ""
  private var enabled = false
  private var queue: [JSON] = []
  private var sending = false
  private var timer: Task<Void, Never>?

  /// `shared`는 모든 이벤트에 붙는 속성이다.
  public init(
    directory: URL, key: String, host: String, active: Bool, transport: AnalyticsTransport,
    shared: [String: JSON] = [:], now: @escaping @Sendable () -> Date = { .now }
  ) {
    file = directory.appendingPathComponent("analytics.json")
    self.key = key
    endpoint = URL(string: host).flatMap { $0.host == nil ? nil : URL(string: "/batch/", relativeTo: $0)?.absoluteURL }
    available = active && !key.isEmpty && endpoint != nil
    self.transport = transport
    self.shared = shared
    self.now = now
    guard available else { return }
    load()
    timer = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: Self.flushInterval * 1_000_000_000)
        guard !Task.isCancelled else { return }
        await self?.flush()
      }
    }
  }

  deinit { timer?.cancel() }

  private func load() {
    var missing = false
    do {
      if let stored = try AtomicFile.read(file) {
        guard let id = stored["id"]?.string, let enabled = stored["enabled"]?.bool else {
          throw CocoaError(.fileReadCorruptFile)
        }
        self.id = id
        self.enabled = enabled
        let pending = stored["pending"]?.array ?? []
        if enabled {
          queue = Array(pending.suffix(Self.queueLimit))
        } else if !pending.isEmpty {
          try? save()
        }
        return
      }
      missing = true
    } catch {}
    id = UUID().uuidString.lowercased()
    // 손상된 파일에는 전송 끄기가 들어 있었을 수 있다. 파일이 없을 때만 켠 상태로 시작한다.
    enabled = missing
    do { try save() } catch { enabled = false }
  }

  /// 앱은 알림 없이 종료될 수 있다. 보내지 않은 이벤트를 바뀔 때마다 파일에 함께 적는다.
  private func save() throws {
    try AtomicFile.write(
      ["version": 1, "id": .string(id), "enabled": .bool(enabled), "pending": .array(queue)], to: file)
  }

  public func status() -> Status {
    lock.withLock { Status(available: available, enabled: available && enabled) }
  }

  public func track(_ event: String, _ properties: [String: JSON] = [:]) {
    let full = lock.withLock { () -> Bool in
      guard available, enabled else { return false }
      var merged = shared.merging(properties) { _, value in value }
      // 사람 프로필을 만들지 않는다. PostHog에서 익명 이벤트로 남는다.
      merged["$process_person_profile"] = false
      queue.append([
        "event": .string(event), "distinct_id": .string(id),
        "timestamp": .string(Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(now())),
        "properties": .object(merged),
      ])
      if queue.count > Self.queueLimit { queue.removeFirst(queue.count - Self.queueLimit) }
      try? save()
      return queue.count >= Self.flushSize
    }
    if full { Task { await flush() } }
  }

  public func track(_ event: AnalyticsEvent) { track(event.event, event.properties) }

  /// 끄면 보내지 않은 이벤트를 버린다.
  @discardableResult
  public func setEnabled(_ value: Bool) throws -> Status {
    try lock.withLock {
      guard available else { return Status() }
      enabled = value
      if !value { queue = [] }
      try save()
      return Status(available: true, enabled: enabled)
    }
  }

  public func flush() async {
    let request = lock.withLock { () -> (URLRequest, [JSON])? in
      guard available, enabled, !sending, !queue.isEmpty, let endpoint else { return nil }
      let batch = Array(queue.prefix(Self.batchSize))
      guard let body = try? JSON.object(["api_key": .string(key), "batch": .array(batch)]).data() else { return nil }
      sending = true
      queue.removeFirst(batch.count)
      // 보내기 전에 파일에서 뺀다. 전송 중 종료되어도 다음 실행에서 두 번 보내지 않는다.
      try? save()
      var request = URLRequest(url: endpoint, timeoutInterval: 10)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = body
      return (request, batch)
    }
    guard let (request, batch) = request else { return }
    var retry = false
    do {
      // 거절된 요청은 다시 보내도 거절된다. 서버 오류와 연결 실패만 다시 보낸다.
      let status = try await transport.send(request)
      retry = status >= 500 || status == 429
    } catch {
      retry = true
    }
    lock.withLock {
      if retry, enabled {
        queue = Array((batch + queue).suffix(Self.queueLimit))
        try? save()
      }
      sending = false
    }
  }
}
