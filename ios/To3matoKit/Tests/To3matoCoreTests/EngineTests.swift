import Foundation
import XCTest

@testable import To3matoCore

// tests/sync-recovery.test.mjs의 엔진 시나리오. 서버는 FakeServer가 흉내 낸다.

final class FakeTransport: SyncTransport, @unchecked Sendable {
  let server: FakeServer
  var lost = false
  var invalid = false
  var offline = false

  init(_ server: FakeServer) { self.server = server }

  func pull(epoch: String?, cursor: String, deviceId: String, timeZone: String) async throws -> JSON {
    if offline { throw URLError(.notConnectedToInternet) }
    var response = server.pull(epoch: epoch, cursor: cursor).object!
    if invalid { response["version"] = 99 }
    return .object(response)
  }

  func push(operation: JSON, epoch: String?) async throws -> JSON {
    if offline { throw URLError(.notConnectedToInternet) }
    let response = try server.push(operation, epoch: epoch ?? "")
    if lost {
      lost = false
      throw URLError(.networkConnectionLost)
    }
    return response
  }

  struct Nothing: SyncSubscription { func cancel() {} }

  func subscribe(onChange: @escaping @Sendable () -> Void, onConnection: @escaping @Sendable (Bool) -> Void) async
    -> SyncSubscription
  { Nothing() }
}

final class EngineTests: XCTestCase {
  let device = "11111111-1111-4111-8111-111111111111"

  override func setUp() { CalendarTime.zone = TimeZone(identifier: "Asia/Seoul") }
  override func tearDown() { CalendarTime.zone = nil }

  func makeEngine(_ server: FakeServer, time: @escaping () -> Double = { epochMilliseconds() }) throws
    -> (SyncEngine, MemoryRepository, FakeTransport)
  {
    var envelope = try Envelope(state: SyncProtocol.emptyState(), owner: "user-a", deviceId: device)
    envelope.confirmed.timeZone = "Asia/Seoul"
    let repository = MemoryRepository(envelope)
    let transport = FakeTransport(server)
    let engine = SyncEngine(
      repository: repository, transport: transport, clock: SyncClock(wall: time, monotonic: time), intervalMs: 3_600_000)
    return (engine, repository, transport)
  }

  func testOverlappingOfflineSessionsKeepLocalRecordsInConflictArchive() async throws {
    let server = FakeServer()
    final class Time: @unchecked Sendable { var value = epochMilliseconds() - 120_000 }
    let time = Time()
    server.now = time.value
    let (engine, repository, _) = try makeEngine(server, time: { time.value })
    try await engine.enable()
    await engine.syncNow()
    try await engine.dispatch(Command("task:save", ["title": "local focus", "estimate": 1, "date": "", "project": ""]))
    await engine.syncNow()
    let id = await engine.state().tasks[0].id
    try await engine.disable()
    try await engine.dispatch(Command("timer:play", ["id": .string(id)]))
    time.value += 30000
    try await engine.dispatch(Command("timer:end"))
    let seconds = await engine.state().records.first?.seconds
    XCTAssertEqual(seconds, 30)
    // 다른 기기가 그사이 같은 할 일로 타이머를 시작했다.
    var other = try Envelope(state: SyncProtocol.emptyState(), owner: "user-a", deviceId: device)
    other.confirmed = server.document
    server.now = time.value + 1000
    _ = try server.push(
      .object(
        try SyncProtocol.prepareOperation(other, Command("timer:play", ["id": .string(id)]), at: time.value + 1000, offline: true)
          .json), epoch: server.epoch)
    try await engine.enable()
    await engine.syncNow()
    let state = await engine.state()
    let status = await engine.status()
    XCTAssertEqual(state.records.count, 0)
    XCTAssertEqual(status.pending, 0)
    let conflicts = repository.read().conflicts
    XCTAssertEqual(conflicts.count, 2)
    let end = conflicts.first { $0["operation"]?["command"]?["type"] == "timer:end" }
    XCTAssertEqual(end?["document"]?["state"]?["records"]?.array?.first?["seconds"], 30)
    XCTAssertEqual(repository.read().localEvidence, [:])
  }

  func testDurableOutboxSurvivesLostAcknowledgementsBadDataAndEpochRecovery() async throws {
    let server = FakeServer()
    let (engine, repository, transport) = try makeEngine(server)
    try await engine.enable()
    await engine.syncNow()
    transport.lost = true
    try await engine.dispatch(Command("task:save", ["title": "persisted", "estimate": 1, "date": "", "project": ""]))
    await engine.syncNow()
    XCTAssertEqual(repository.read().pending.count, 1)
    await engine.syncNow()
    XCTAssertEqual(repository.read().pending.count, 0)
    var tasks = await engine.state().tasks
    XCTAssertEqual(tasks.count, 1)
    try await engine.disable()
    try await engine.dispatch(Command("project:save", ["name": "offline"]))
    let pending = repository.read().pending
    XCTAssertEqual(pending.count, 1)
    XCTAssertEqual(server.document.state.projects.count, 0)
    let cursor = repository.read().cursor
    transport.invalid = true
    try await engine.enable()
    await engine.syncNow()
    XCTAssertEqual(repository.read().cursor, cursor)
    XCTAssertEqual(repository.read().pending, pending)
    transport.invalid = false
    server.epoch = "epoch-2"
    await engine.syncNow()
    let projects = await engine.state().projects
    tasks = await engine.state().tasks
    let status = await engine.status()
    XCTAssertEqual(projects.first?.name, "offline")
    XCTAssertEqual(status.pending, 0)
    XCTAssertEqual(tasks.first?.title, "persisted")
  }

  func testTwoDevicesConvergeOnSharedTimer() async throws {
    let server = FakeServer()
    let (a, _, _) = try makeEngine(server)
    var envelope = try Envelope(state: SyncProtocol.emptyState(), owner: "user-a", deviceId: "22222222-2222-4222-8222-222222222222")
    envelope.confirmed.timeZone = "Asia/Seoul"
    let b = SyncEngine(repository: MemoryRepository(envelope), transport: FakeTransport(server), intervalMs: 3_600_000)
    try await a.enable()
    try await b.enable()
    await a.syncNow()
    try await a.dispatch(Command("task:save", ["title": "공유", "estimate": 1, "date": "", "project": ""]))
    await a.syncNow()
    await b.syncNow()
    let id = await b.state().tasks.first!.id
    try await b.dispatch(Command("timer:play", ["id": .string(id)]))
    await b.syncNow()
    await a.syncNow()
    let running = await a.state().timer
    XCTAssertEqual(running?.taskId, id)
    XCTAssertEqual(running?.running, true)
    try await a.dispatch(Command("timer:pause"))
    await a.syncNow()
    await b.syncNow()
    let paused = await b.state().timer
    XCTAssertEqual(paused?.running, false)
    XCTAssertEqual(server.document.timer.controller, device)
  }

  func testClockStaysStableAcrossWallClockChanges() {
    final class Box: @unchecked Sendable { var wall = 10000.0, mono = 0.0 }
    let box = Box()
    let clock = SyncClock(wall: { box.wall }, monotonic: { box.mono })
    box.wall += 1_000_000
    box.mono = 500
    XCTAssertEqual(clock.now(), 10500)
    clock.sample(20000, sentAt: 10400)
    XCTAssertEqual(clock.now(), 20050)
    box.wall += 30000
    clock.resume()
    XCTAssertEqual(clock.now(), 50050)
    let instant = ISO8601DateFormatter().date(from: "2026-03-09T03:30:00Z")!
    XCTAssertEqual(CalendarTime.dateInZone(instant, TimeZone(identifier: "America/New_York")), "2026-03-08")
  }

  func testFileRepositoryIsolatesAccountsAndPersistsOutbox() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let a = try FileEnvelopeRepository(root: root, owner: "user-a")
    var next = a.read()
    next.pending.append(
      SyncOperation(json: [
        "id": "op", "version": 1, "deviceId": .string(next.deviceId), "at": 1, "kind": "patch",
        "patches": [["entity": "projects", "id": "p", "create": true,
                     "fields": ["name": "private", "icon": "folder", "color": "#84956c", "outcome": "", "image": ""]]],
      ]))
    try a.write(next)
    let reopened = try FileEnvelopeRepository(root: root, owner: "user-a")
    XCTAssertEqual(reopened.read().pending.count, 1)
    XCTAssertEqual(SyncProtocol.projectedState(reopened.read()).projects.first?.name, "private")
    let b = try FileEnvelopeRepository(root: root, owner: "user-b")
    XCTAssertEqual(SyncProtocol.projectedState(b.read()).projects, [])
    XCTAssertThrowsError(try b.write(a.read())) { XCTAssertEqual(($0 as? DomainError)?.message, "계정 저장소가 일치하지 않습니다.") }
    XCTAssertThrowsError(try FileEnvelopeRepository(root: root, owner: "../escape"))
  }
}
