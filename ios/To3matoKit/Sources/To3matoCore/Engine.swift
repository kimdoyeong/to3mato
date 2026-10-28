import Foundation

// Mac의 src/lib/sync/engine.mjs. 저장소 쓰기는 확정 문서, 화면 상태, 미전송 작업을 한 번에 기록한다.

public protocol SyncRepository: AnyObject, Sendable {
  func read() -> Envelope
  func write(_ envelope: Envelope) throws
}

public protocol SyncSubscription: Sendable {
  func cancel()
}

public protocol SyncTransport: Sendable {
  func pull(epoch: String?, cursor: String, deviceId: String, timeZone: String) async throws -> JSON
  func push(operation: JSON, epoch: String?) async throws -> JSON
  func subscribe(
    onChange: @escaping @Sendable () -> Void, onConnection: @escaping @Sendable (Bool) -> Void
  ) async -> SyncSubscription
}

/// 전송 계층이 인증 만료를 알릴 때 던진다.
public struct SyncAuthRequired: Error {
  public init() {}
}

public struct SyncStatus: Equatable, Sendable {
  public var enabled: Bool
  /// off, online, offline, auth-required
  public var connection: String
  public var pending: Int
  public var conflicts: [JSON]
  public var error: String
  public var owner: String?
  public var deviceId: String
  public var timeZone: String
}

public enum ChangeSource: Sendable { case local, remote }

/// 서버 시간으로 보정한 시계. 표시 사이에는 단조 시계를 쓴다.
public final class SyncClock: @unchecked Sendable {
  private let lock = NSLock()
  private let wall: () -> Double
  private let monotonic: () -> Double
  private var base: Double
  private var start: Double
  private var correction: Double = 0

  public init(
    wall: @escaping () -> Double = { epochMilliseconds() },
    monotonic: @escaping () -> Double = { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }
  ) {
    self.wall = wall
    self.monotonic = monotonic
    base = wall()
    start = monotonic()
  }

  public func now() -> Double {
    lock.withLock { base + (monotonic() - start) }
  }

  public func sample(_ serverNow: Double?, sentAt: Double) {
    guard let serverNow, serverNow.isFinite else { return }
    lock.withLock {
      let received = base + monotonic() - start
      base = serverNow + max(0, received - sentAt) / 2
      correction = base - wall()
      start = monotonic()
    }
  }

  public func resume() {
    lock.withLock {
      base = wall() + correction
      start = monotonic()
    }
  }
}

public actor SyncEngine {
  private let repository: SyncRepository
  private let transport: SyncTransport
  private let clock: SyncClock
  private let onChange: @Sendable (AppState, SyncDocument, ChangeSource) -> Void
  private let onStatus: @Sendable (SyncStatus) -> Void
  private let intervalMs: Double

  private var work: Task<Void, Never>?
  private var rerun = false
  private var channel: SyncSubscription?
  private var stopped = false
  private var generation = 0
  private var retry: Task<Void, Never>?
  private var interval: Task<Void, Never>?
  private var connection = "off"
  private var error = ""
  private var failures = 0

  public init(
    repository: SyncRepository, transport: SyncTransport, clock: SyncClock = SyncClock(),
    intervalMs: Double = 30000,
    onChange: @escaping @Sendable (AppState, SyncDocument, ChangeSource) -> Void = { _, _, _ in },
    onStatus: @escaping @Sendable (SyncStatus) -> Void = { _ in }
  ) {
    self.repository = repository
    self.transport = transport
    self.clock = clock
    self.intervalMs = intervalMs
    self.onChange = onChange
    self.onStatus = onStatus
  }

  public func start() {
    interval?.cancel()
    let nanoseconds = UInt64(intervalMs * 1_000_000)
    interval = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: nanoseconds)
        guard !Task.isCancelled else { return }
        await self?.request()
      }
    }
  }

  public func status() -> SyncStatus {
    let value = repository.read()
    return SyncStatus(
      enabled: value.enabled, connection: connection, pending: value.pending.count, conflicts: value.conflicts,
      error: error, owner: value.owner, deviceId: value.deviceId, timeZone: value.confirmed.timeZone)
  }

  public func state() -> AppState { SyncProtocol.projectedState(repository.read()) }
  public func document() -> SyncDocument { SyncProtocol.projectedDocument(repository.read()) }
  public nonisolated func now() -> Double { clock.now() }

  private func report() { onStatus(status()) }

  private func save(_ value: Envelope, _ source: ChangeSource = .local) throws {
    try repository.write(value)
    onChange(SyncProtocol.projectedState(value), SyncProtocol.projectedDocument(value), source)
    report()
  }

  private func active(_ run: Int) -> Bool {
    run == generation && !stopped && repository.read().enabled
  }

  /// 대기 중인 작업을 서버와 맞춘다. 실행 중이면 끝난 뒤 한 번 더 돈다.
  @discardableResult
  public func request() -> Task<Void, Never> {
    if stopped || !repository.read().enabled { return Task {} }
    rerun = true
    if let work { return work }
    let run = generation
    let task = Task { [weak self] in
      guard let self else { return }
      await self.loop(run)
      await self.finish(run)
    }
    work = task
    return task
  }

  public func syncNow() async {
    await request().value
  }

  private func finish(_ run: Int) {
    work = nil
    if rerun, run != generation, !stopped, repository.read().enabled { request() }
  }

  private func loop(_ run: Int) async {
    repeat {
      rerun = false
      guard active(run) else { break }
      do {
        if channel == nil {
          channel = await transport.subscribe(
            onChange: { [weak self] in Task { await self?.request() } },
            onConnection: { [weak self] connected in Task { await self?.connected(connected, run) } })
        }
        let before = clock.now()
        let local = repository.read()
        let response = try await transport.pull(
          epoch: local.epoch, cursor: local.cursor, deviceId: local.deviceId, timeZone: local.confirmed.timeZone)
        guard active(run) else { break }
        clock.sample(response["serverNow"]?.number, sentAt: before)
        try applyPull(response)
        while let operation = repository.read().pending.first, active(run) {
          let sent = clock.now()
          let result = try await transport.push(operation: .object(operation.json), epoch: repository.read().epoch)
          guard active(run) else { break }
          clock.sample(result["serverNow"]?.number, sentAt: sent)
          try applyPush(result, operation)
        }
        guard active(run) else { break }
        connection = "online"
        error = ""
        failures = 0
        report()
      } catch {
        guard run == generation, !stopped else { break }
        connection = error is SyncAuthRequired ? "auth-required" : "offline"
        self.error = connection == "auth-required" ? "다시 로그인하세요." : "동기화하지 못했습니다. 연결 상태를 확인하세요."
        report()
        retry?.cancel()
        failures += 1
        let delay = min(60000, 1000 * pow(2, Double(min(failures, 6))))
        retry = Task { [weak self] in
          try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000))
          guard !Task.isCancelled else { return }
          await self?.request()
        }
        break
      }
    } while rerun
  }

  private func connected(_ value: Bool, _ run: Int) {
    guard run == generation else { return }
    connection = value ? "online" : "offline"
    report()
    if value { request() }
  }

  private static func validCursor(_ value: JSON?) -> String? {
    guard let cursor = value?.string, !cursor.isEmpty, cursor.allSatisfy(\.isASCII), cursor.allSatisfy(\.isNumber)
    else { return nil }
    return cursor
  }

  private func applyPull(_ response: JSON) throws {
    var next = repository.read()
    guard response["version"] == .number(Double(SyncProtocol.version)), let cursor = Self.validCursor(response["cursor"]),
      let epoch = response["epoch"]?.string
    else { throw DomainError("지원하지 않는 동기화 데이터입니다.") }
    let remote: SyncDocument
    if let document = response["document"], !document.isNull {
      remote = try SyncDocument(validating: document)
    } else {
      remote = try SyncProtocol.applyServerChanges(next.confirmed, response["changes"]?.array ?? [], cursor: next.cursor)
    }
    if response["hasMore"] == .bool(true) { rerun = true }
    if next.epoch == epoch, let new = Int64(cursor), let old = Int64(next.cursor), new < old {
      throw DomainError("동기화 위치를 확인할 수 없습니다.")
    }
    if !next.initialized {
      let localDoc = SyncProtocol.projectedDocument(next)
      if next.backup == nil { next.backup = localDoc.json }
      next.confirmed = remote
      next.pending = [try SyncProtocol.importOperation(next, localDoc.state.json, at: clock.now())]
      next.localEvidence = [:]
      for entity in SyncProtocol.extras {
        for row in localDoc.extras[entity] ?? [] {
          guard let id = row["id"]?.string else { continue }
          next.pending.append(
            try SyncProtocol.extraOperation(next, entity: entity, id: id, fields: row.object ?? [:], at: clock.now()))
        }
      }
      if let timer = localDoc.state.timer {
        if remote.state.timer == nil {
          next.pending.append(
            try SyncProtocol.prepareOperation(
              next, Command("timer:adopt", ["timer": timer.json]), at: clock.now(), offline: true))
        } else {
          next.conflicts.append([
            "id": .string("initial:\(next.deviceId)"), "reason": "initial-timer", "document": localDoc.json,
            "at": .number(clock.now()),
          ])
        }
      }
      next.initialized = true
    } else {
      next.confirmed = remote
    }
    next.epoch = epoch
    next.cursor = cursor
    try save(next, .remote)
  }

  private func applyPush(_ result: JSON, _ operation: SyncOperation) throws {
    var next = repository.read()
    guard result["version"] == .number(Double(SyncProtocol.version)), let cursor = Self.validCursor(result["cursor"]),
      result["epoch"]?.string == next.epoch
    else { throw DomainError("동기화 상태가 변경되었습니다. 다시 연결하세요.") }
    let confirmed = try SyncDocument(validating: result["document"] ?? .null)
    let snapshot = next.localEvidence?[operation.id] ?? SyncProtocol.projectedDocument(next).json
    next.pending.removeAll { $0.id == operation.id }
    if result["conflict"] == .bool(true) {
      next.conflicts.append([
        "id": .string(operation.id), "operation": .object(operation.json), "document": snapshot,
        "reason": .string(result["reason"]?.string ?? "timer"), "at": .number(clock.now()),
      ])
      // Preserve descendants; never replay stale offline timer commands against a new session.
      let descendants = next.pending.filter {
        $0.kind == "command" && ($0.command?.type.hasPrefix("timer:") == true || $0.command?.type.hasPrefix("checkin:") == true)
      }
      for item in descendants {
        next.conflicts.append([
          "id": .string(item.id), "operation": .object(item.json),
          "document": next.localEvidence?[item.id] ?? snapshot, "reason": "dependent-timer", "at": .number(clock.now()),
        ])
      }
      let ids = Set(descendants.map(\.id))
      next.pending.removeAll { ids.contains($0.id) }
      for id in ids { next.localEvidence?[id] = nil }
    }
    next.localEvidence?[operation.id] = nil
    if let new = Int64(cursor), let old = Int64(next.cursor), new >= old {
      next.confirmed = confirmed
      next.cursor = cursor
    }
    try save(next, .remote)
  }

  // MARK: 명령

  public func enable() throws {
    stopped = false
    var next = repository.read()
    next.enabled = true
    try save(next)
    request()
  }

  public func disable() throws {
    generation += 1
    retry?.cancel()
    channel?.cancel()
    channel = nil
    var next = repository.read()
    next.enabled = false
    try save(next)
    connection = "off"
    report()
  }

  @discardableResult
  public func dispatch(_ command: Command) throws -> AppState {
    var next = repository.read()
    if command.type == "settings:save", let tray = command.payload["trayDisplay"], Domain.isTruthy(tray) {
      next.localSettings["trayDisplay"] = tray
    }
    let operation = try SyncProtocol.prepareOperation(next, command, at: clock.now(), offline: connection != "online")
    if operation.kind != "patch" || !operation.patches.isEmpty { next.pending.append(operation) }
    // Keep the local result before a later pull rebases the optimistic view.
    // Conflicted offline sessions must remain exportable with their original records.
    if operation.kind == "command" {
      let evidence = SyncProtocol.projectedDocument(next).json
      next.localEvidence = (next.localEvidence ?? [:]).merging([operation.id: evidence]) { $1 }
    }
    try save(next)
    request()
    return SyncProtocol.projectedState(repository.read())
  }

  @discardableResult
  public func importData(_ raw: JSON) throws -> AppState {
    var next = repository.read()
    next.pending.append(try SyncProtocol.importOperation(next, raw, at: clock.now()))
    try save(next)
    request()
    return SyncProtocol.projectedState(repository.read())
  }

  public func extra(entity: String, id: String, fields: [String: JSON], deleted: Bool = false) throws {
    var next = repository.read()
    next.pending.append(
      try SyncProtocol.extraOperation(next, entity: entity, id: id, fields: fields, deleted: deleted, at: clock.now()))
    try save(next)
    request()
  }

  /// keep: 별도 보관, discard: 버림, timer: 그 타이머를 공유 타이머로 적용
  public func resolve(_ id: String, action: String) throws {
    guard ["keep", "discard", "timer"].contains(action) else { throw DomainError("잘못된 요청입니다.") }
    var next = repository.read()
    guard let index = next.conflicts.firstIndex(where: { $0["id"]?.string == id }) else { return }
    var conflict = next.conflicts[index].object ?? [:]
    if action == "timer" {
      guard let timer = conflict["document"]?["state"]?["timer"], !timer.isNull else {
        throw DomainError("타이머를 찾을 수 없습니다.")
      }
      next.pending.append(
        try SyncProtocol.prepareOperation(
          next, Command("timer:adopt", ["timer": timer]), at: clock.now(), offline: connection != "online"))
      conflict["archived"] = true
      next.conflicts[index] = .object(conflict)
    } else if action == "keep" {
      conflict["archived"] = true
      next.conflicts[index] = .object(conflict)
    } else {
      next.conflicts.remove(at: index)
    }
    try save(next)
    request()
  }

  public func destroy() {
    stopped = true
    generation += 1
    interval?.cancel()
    retry?.cancel()
    channel?.cancel()
    channel = nil
  }
}
