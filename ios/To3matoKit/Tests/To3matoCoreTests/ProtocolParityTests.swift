import Foundation
import XCTest

@testable import To3matoCore

// 같은 문서와 작업을 Swift와 Mac의 protocol.mjs(node)에 넣고 결과가 같은지 비교한다.
// node가 없는 환경에서는 건너뛴다.

enum Reference {
  static let script = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("Parity/reference.mjs")

  static func run(_ jobs: [JSON]) throws -> [JSON] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", script.path]
    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = (environment["PATH"] ?? "") + ":/opt/homebrew/bin:/usr/local/bin"
    process.environment = environment
    let input = Pipe()
    let output = Pipe()
    process.standardInput = input
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { throw XCTSkip("node를 실행할 수 없습니다.") }
    input.fileHandleForWriting.write(try JSON.array(jobs).data())
    try input.fileHandleForWriting.close()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw XCTSkip("node 참조 계산에 실패했습니다.") }
    return try JSON.parse(data).array ?? []
  }
}

/// JS와 같은 형식의 결정적 UUID
final class Counter {
  var value = 0
  func install(from start: Int = 0) {
    value = start
    IDs.make = { [unowned self] in
      self.value += 1
      return String(format: "00000000-0000-4000-8000-%012d", self.value)
    }
  }
}

final class ProtocolParityTests: XCTestCase {
  let counter = Counter()
  let day = "2026-10-27"
  let t0: Double = 1_800_000_000_000

  override func setUp() {
    counter.install()
    CalendarTime.zone = TimeZone(identifier: "Asia/Seoul")
  }

  override func tearDown() {
    IDs.make = { UUID().uuidString.lowercased() }
    CalendarTime.zone = nil
  }

  func envelope() throws -> Envelope {
    var envelope = try Envelope(state: Domain.createInitialState(date: day), owner: "u", deviceId: "11111111-1111-4111-8111-111111111111")
    envelope.confirmed.timeZone = "Asia/Seoul"
    return envelope
  }

  /// 명령마다 작업을 만들고 서버가 받아들인 것처럼 확정 문서를 진행한다.
  func scenario(_ steps: [(Command, Double)]) throws -> (start: SyncDocument, operations: [(SyncOperation, Double)], documents: [SyncDocument], prepared: [(JSON, Int)]) {
    var env = try envelope()
    let start = env.confirmed
    var operations: [(SyncOperation, Double)] = []
    var documents: [SyncDocument] = []
    var prepared: [(JSON, Int)] = []
    for (command, at) in steps {
      let idStart = counter.value
      let envelopeJSON = env.json
      let operation = try SyncProtocol.prepareOperation(env, command, at: at)
      prepared.append(
        (
          [
            "step": "prepare", "envelope": envelopeJSON, "command": command.json, "at": .number(at),
            "offline": false, "idStart": .number(Double(idStart)),
          ], operations.count
        ))
      let serverNow = at + 37
      let result = try SyncProtocol.reduceOperation(env.confirmed, operation, serverNow: serverNow)
      XCTAssertFalse(result.conflict, command.type)
      env.confirmed = result.document
      operations.append((operation, serverNow))
      documents.append(result.document)
    }
    return (start, operations, documents, prepared)
  }

  func assertParity(_ steps: [(Command, Double)], file: StaticString = #filePath, line: UInt = #line) throws {
    let run = try scenario(steps)
    var jobs: [JSON] = run.prepared.map(\.0)
    jobs.append([
      "step": "reduce", "document": run.start.json,
      "operations": .array(run.operations.map { ["operation": .object($0.0.json), "serverNow": .number($0.1), "optimistic": false] }),
    ])
    let output = try Reference.run(jobs)
    XCTAssertEqual(output.count, jobs.count, file: file, line: line)
    for (index, (_, operationIndex)) in run.prepared.enumerated() {
      let swift = JSON.object(run.operations[operationIndex].0.json)
      XCTAssertEqual(output[index]["operation"], swift, "prepare \(steps[operationIndex].0.type): \(output[index])", file: file, line: line)
    }
    let results = output.last?["results"]?.array ?? []
    XCTAssertEqual(results.count, run.documents.count, "\(output.last ?? .null)", file: file, line: line)
    for (index, document) in run.documents.enumerated() where index < results.count {
      XCTAssertEqual(results[index]["conflict"], false, file: file, line: line)
      XCTAssertEqual(
        results[index]["document"], document.json, "after \(steps[index].0.type)", file: file, line: line)
    }
  }

  func testTimerLifecycleMatchesMac() throws {
    try assertParity([
      (Command("timer:play", ["id": "t1"]), t0),
      (Command("timer:toggle"), t0 + 100_000),
      (Command("timer:toggle"), t0 + 400_000),
      (Command("timer:advance"), t0 + 2_000_000),
      (Command("checkin:save", ["remaining": 1]), t0 + 2_010_000),
      (Command("timer:end"), t0 + 2_100_000),
      (Command("timer:play", ["id": "t2"]), t0 + 2_200_000),
      (Command("timer:play", ["id": "t3"]), t0 + 2_900_000),
      (Command("task:toggle", ["id": "t3"]), t0 + 3_000_000),
    ])
  }

  func testCheckinPathsMatchMac() throws {
    try assertParity([
      (Command("timer:play", ["id": "t1"]), t0),
      (Command("timer:advance"), t0 + 1_600_000),
      (Command("checkin:followup"), t0 + 1_610_000),
      (Command("timer:end"), t0 + 1_700_000),
      (Command("timer:play", ["id": "t2"]), t0 + 1_800_000),
      (Command("checkin:done"), t0 + 3_400_000),
      (Command("checkin:skip"), t0 + 3_400_000),
    ].filter { $0.0.type != "checkin:skip" })
  }

  func testPatchCommandsMatchMac() throws {
    try assertParity([
      (Command("task:save", ["title": "새 할 일", "estimate": 1, "date": "2026-10-28", "project": "p2"]), t0),
      (Command("task:save", ["id": "t1", "title": "고친 제목", "estimate": 1, "date": "", "project": "p1"]), t0 + 1000),
      (Command("task:move", ["id": "t2", "date": "2026-10-29"]), t0 + 2000),
      (Command("project:save", ["name": "새 프로젝트", "outcome": "결과"]), t0 + 3000),
      (Command("settings:save", ["focus": 900, "dailyCapacity": 6, "remindDays": [0, 6]]), t0 + 4000),
      (Command("template:save", ["name": "루틴", "steps": [["title": "단계 %n%", "estimate": 2]]]), t0 + 5000),
      (Command("task:reorder", ["id": "t4", "before": "t1"]), t0 + 6000),
      (Command("project:delete", ["id": "p3"]), t0 + 7000),
      (Command("task:delete", ["id": "t5"]), t0 + 8000),
      (Command("task:batch", ["project": "p1", "tasks": [["title": "a", "estimate": 1, "date": ""], ["title": "b", "estimate": 2, "date": "2026-10-30"]]]), t0 + 9000),
    ])
  }

  func testDeletingRunningTaskByPatchSettlesSession() throws {
    try assertParity([
      (Command("timer:play", ["id": "t2"]), t0),
      (Command("task:delete", ["id": "t2"]), t0 + 600_000),
    ])
  }

  func testStaleTimerCommandConflictsLikeMac() throws {
    var env = try envelope()
    let play = try SyncProtocol.prepareOperation(env, Command("timer:play", ["id": "t1"]), at: t0)
    let stale = try SyncProtocol.prepareOperation(env, Command("timer:play", ["id": "t2"]), at: t0 + 10)
    env.confirmed = try SyncProtocol.reduceOperation(env.confirmed, play, serverNow: t0).document
    let swift = try SyncProtocol.reduceOperation(env.confirmed, stale, serverNow: t0 + 20)
    XCTAssertTrue(swift.conflict)
    let output = try Reference.run([
      ["step": "reduce", "document": env.confirmed.json,
       "operations": [["operation": .object(stale.json), "serverNow": .number(t0 + 20), "optimistic": false]]]
    ])
    XCTAssertEqual(output.first?["results"]?.array?.first?["conflict"], true)
    XCTAssertEqual(output.first?["results"]?.array?.first?["document"], swift.document.json)
  }

  func testServerChangesApplyLikeMac() throws {
    let run = try scenario([
      (Command("timer:play", ["id": "t1"]), t0),
      (Command("task:save", ["title": "새 할 일", "estimate": 1, "date": "", "project": ""]), t0 + 1000),
      (Command("task:reorder", ["id": "t3", "before": "t1"]), t0 + 2000),
      (Command("task:delete", ["id": "t4"]), t0 + 3000),
    ])
    var previous = run.start
    var changes: [JSON] = []
    for (index, document) in run.documents.enumerated() {
      changes.append(["cursor": .string(String(index + 1)), "delta": FakeServer.delta(previous, document)])
      previous = document
    }
    let swift = try SyncProtocol.applyServerChanges(run.start, changes, cursor: "0")
    XCTAssertEqual(swift, run.documents.last)
    let output = try Reference.run([["step": "changes", "document": run.start.json, "changes": .array(changes), "cursor": "0"]])
    XCTAssertEqual(output.first?["document"], swift.json)
    XCTAssertThrowsError(try SyncProtocol.applyServerChanges(run.start, Array(changes.dropFirst()), cursor: "0"))
  }

  func testEnvelopeRoundTripsThroughJSON() throws {
    var env = try envelope()
    env.pending.append(try SyncProtocol.prepareOperation(env, Command("timer:play", ["id": "t1"]), at: t0))
    env.conflicts = [["id": "x", "reason": "timer"]]
    env.epoch = "e"
    let back = try Envelope(json: try JSON.parse(env.json.data()))
    XCTAssertEqual(back, env)
    XCTAssertEqual(SyncProtocol.projectedState(back).timer?.taskId, "t1")
  }
}
