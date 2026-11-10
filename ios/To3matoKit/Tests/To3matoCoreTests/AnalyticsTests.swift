import Foundation
import XCTest

@testable import To3matoCore

// tests/analytics.test.mjs와 같은 동작. 이벤트 목록은 Mac의 analytics.mjs(node)와 결과를 비교한다.

final class AnalyticsServer: AnalyticsTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var stored: [URLRequest] = []
  /// nil이면 연결 실패
  let status: Int?
  var onSend: (@Sendable () -> Void)?

  init(_ status: Int? = 200) { self.status = status }

  var requests: [URLRequest] { lock.withLock { stored } }
  var bodies: [JSON] { requests.map { (try? JSON.parse($0.httpBody ?? Data())) ?? .null } }

  func events(_ index: Int) -> [String] {
    (bodies[index]["batch"]?.array ?? []).compactMap { $0["event"]?.string }
  }

  func send(_ request: URLRequest) async throws -> Int {
    lock.withLock { stored.append(request) }
    onSend?()
    guard let status else { throw URLError(.notConnectedToInternet) }
    return status
  }
}

final class AnalyticsTests: XCTestCase {
  let at = ISO8601DateFormatter().date(from: "2026-11-10T00:00:00Z")!

  func directory() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("to3mato-analytics-\(UUID().uuidString)")
    addTeardownBlock { try? FileManager.default.removeItem(at: url) }
    return url
  }

  func file(_ directory: URL) -> URL { directory.appendingPathComponent("analytics.json") }

  func stored(_ directory: URL) throws -> JSON { try JSON.parse(Data(contentsOf: file(directory))) }

  func make(_ directory: URL, _ server: AnalyticsServer, key: String = "phc_test", active: Bool = true) -> Analytics {
    let at = at
    return Analytics(
      directory: directory, key: key, host: "https://example.test", active: active, transport: server,
      shared: ["app_version": "1.2.3"], now: { at })
  }

  func testOnlyAReleaseBuildWithAKeyOutsideTestsSendsEvents() {
    XCTAssertTrue(AnalyticsConfig.active(key: "phc_test", debug: false, testing: false))
    XCTAssertFalse(AnalyticsConfig.active(key: "", debug: false, testing: false))
    XCTAssertFalse(AnalyticsConfig.active(key: "phc_test", debug: true, testing: false))
    XCTAssertFalse(AnalyticsConfig.active(key: "phc_test", debug: false, testing: true))
    XCTAssertTrue(AnalyticsConfig.testing)
    XCTAssertFalse(AnalyticsConfig.active(key: "phc_test", debug: false))
  }

  func testWithoutAKeyOrWhenInactiveNothingIsWrittenOrSent() async throws {
    for (key, active) in [("", true), ("phc_test", false)] {
      let dir = directory(), server = AnalyticsServer()
      let analytics = make(dir, server, key: key, active: active)
      XCTAssertEqual(analytics.status(), Analytics.Status(available: false, enabled: false))
      analytics.track("app_opened")
      await analytics.flush()
      XCTAssertEqual(try analytics.setEnabled(true), Analytics.Status(available: false, enabled: false))
      XCTAssertEqual(server.requests.count, 0)
      XCTAssertFalse(FileManager.default.fileExists(atPath: file(dir).path))
    }
  }

  func testEventsGoOutAsAnAnonymousBatchUnderOneInstallID() async throws {
    let dir = directory(), server = AnalyticsServer()
    let analytics = make(dir, server)
    XCTAssertEqual(analytics.status(), Analytics.Status(available: true, enabled: true))
    analytics.track("app_opened", ["first_launch": true])
    analytics.track("task_created")
    await analytics.flush()
    XCTAssertEqual(server.requests.count, 1)
    let request = server.requests[0]
    XCTAssertEqual(request.url?.absoluteString, "https://example.test/batch/")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
    let body = server.bodies[0]
    XCTAssertEqual(Set(body.object?.keys.map { $0 } ?? []), ["api_key", "batch"])
    XCTAssertEqual(body["api_key"], "phc_test")
    XCTAssertEqual(server.events(0), ["app_opened", "task_created"])
    let id = try XCTUnwrap(try stored(dir)["id"]?.string)
    XCTAssertNotNil(id.range(of: "^[0-9a-f-]{36}$", options: .regularExpression))
    let batch = body["batch"]?.array ?? []
    for item in batch {
      XCTAssertEqual(Set(item.object?.keys.map { $0 } ?? []), ["event", "distinct_id", "timestamp", "properties"])
      XCTAssertEqual(item["distinct_id"], .string(id))
      XCTAssertEqual(item["timestamp"], "2026-11-10T00:00:00.000Z")
      XCTAssertEqual(item["properties"]?["$process_person_profile"], false)
      XCTAssertEqual(item["properties"]?["app_version"], "1.2.3")
    }
    XCTAssertEqual(batch[0]["properties"]?["first_launch"], true)
    // 같은 설치는 다음 실행에서도 같은 ID를 쓴다.
    let again = make(dir, server)
    again.track("app_opened")
    await again.flush()
    XCTAssertEqual(server.bodies[1]["batch"]?.array?.first?["distinct_id"], .string(id))
  }

  func testTurningItOffDropsQueuedEventsAndSurvivesARestart() async throws {
    let dir = directory(), server = AnalyticsServer()
    let analytics = make(dir, server)
    analytics.track("task_created")
    XCTAssertEqual(try stored(dir)["pending"]?.array?.count, 1)
    XCTAssertEqual(try analytics.setEnabled(false), Analytics.Status(available: true, enabled: false))
    analytics.track("task_created")
    await analytics.flush()
    XCTAssertEqual(server.requests.count, 0)
    XCTAssertEqual(try stored(dir)["pending"], [])
    XCTAssertEqual(try stored(dir)["enabled"], false)
    let next = make(dir, server)
    XCTAssertFalse(next.status().enabled)
    next.track("app_opened")
    await next.flush()
    XCTAssertEqual(server.requests.count, 0)
    XCTAssertTrue(try next.setEnabled(true).enabled)
    next.track("app_opened")
    await next.flush()
    XCTAssertEqual(server.requests.count, 1)
  }

  func testADamagedStateFileStaysOffUntilItIsTurnedOnAgain() throws {
    for content in ["{", #"{"version":1,"id":"a"}"#] {
      let dir = directory()
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try Data(content.utf8).write(to: file(dir))
      let analytics = make(dir, AnalyticsServer())
      XCTAssertEqual(analytics.status(), Analytics.Status(available: true, enabled: false))
      XCTAssertEqual(try stored(dir)["enabled"], false)
    }
  }

  func testUnsentEventsWaitForTheNextLaunchAndAreSentOnce() async throws {
    let dir = directory(), offline = AnalyticsServer(nil)
    let first = make(dir, offline)
    first.track("task_created")
    await first.flush()
    first.track("task_completed")
    XCTAssertEqual(offline.requests.count, 1)
    XCTAssertEqual(try stored(dir)["pending"]?.array?.count, 2)

    let online = AnalyticsServer()
    // 보내는 동안 파일에는 남아 있지 않다. 전송 중 종료되어도 두 번 보내지 않는다.
    let path = file(dir)
    let during = Captured()
    online.onSend = { during.value = try? JSON.parse(Data(contentsOf: path)) }
    let second = make(dir, online)
    await second.flush()
    XCTAssertEqual(online.events(0), ["task_created", "task_completed"])
    XCTAssertEqual(during.value?["pending"], [])
    XCTAssertEqual(try stored(dir)["pending"], [])
    let third = make(dir, online)
    await second.flush()
    await third.flush()
    XCTAssertEqual(online.requests.count, 1)
  }

  func testARejectedBatchIsDroppedAndAServerFailureIsRetried() async throws {
    for (status, expected) in [(400, 1), (401, 1), (503, 2), (429, 2)] {
      let dir = directory(), server = AnalyticsServer(status)
      let analytics = make(dir, server)
      analytics.track("task_created")
      await analytics.flush()
      await analytics.flush()
      XCTAssertEqual(server.requests.count, expected, "\(status)")
      XCTAssertEqual(try stored(dir)["pending"]?.array?.count, expected - 1, "\(status)")
    }
  }

  func testAFullQueueSendsWithoutWaitingForTheTimer() async throws {
    let server = AnalyticsServer()
    let analytics = make(directory(), server)
    for _ in 0..<20 { analytics.track("task_created") }
    for _ in 0..<200 where server.requests.isEmpty { try await Task.sleep(nanoseconds: 10_000_000) }
    XCTAssertEqual(server.requests.count, 1)
    XCTAssertEqual(server.bodies[0]["batch"]?.array?.count, 20)
  }

  func testTheQueueKeepsTheNewestEvents() async throws {
    let dir = directory(), server = AnalyticsServer(nil)
    let analytics = make(dir, server)
    for index in 0..<(Analytics.queueLimit + 5) { analytics.track("task_created", ["estimate": .number(Double(index))]) }
    // 실패한 전송이 끝나면 묶음이 대기열 앞으로 돌아온다.
    var pending: [JSON] = []
    for _ in 0..<300 where pending.count != Analytics.queueLimit {
      try await Task.sleep(nanoseconds: 10_000_000)
      pending = try stored(dir)["pending"]?.array ?? []
    }
    XCTAssertEqual(pending.count, Analytics.queueLimit)
    XCTAssertEqual(pending.last?["properties"]?["estimate"], .number(Double(Analytics.queueLimit + 4)))
  }

  // MARK: 이벤트 목록

  func testConfigurationMatchesTheMacCatalog() throws {
    let reference = try Reference.run([["step": "config"]], script: "analytics.mjs")[0]
    XCTAssertEqual(reference["key"], .string(AnalyticsConfig.key))
    XCTAssertEqual(reference["host"], .string(AnalyticsConfig.host))
    XCTAssertEqual(reference["screens"], .array(AnalyticsEvents.screens.map(JSON.string)))
  }

  func testTheScreenListIsAnAllowlist() {
    XCTAssertEqual(AnalyticsEvents.screen("calendar"), AnalyticsEvent("screen_viewed", ["screen": "calendar"]))
    XCTAssertNil(AnalyticsEvents.screen("비밀"))
  }

  func testCommandEventsCarryNoUserTextAndMatchTheMacCatalog() async throws {
    let secret = "비밀 제목"
    var state = Domain.createInitialState(date: "2026-11-10")
    var clock: Double = 1_000
    var jobs: [JSON] = []
    var events: [AnalyticsEvent?] = []
    func map(_ command: Command, _ before: AppState) {
      jobs.append(["step": "command", "command": command.json, "before": before.json])
      events.append(AnalyticsEvents.command(command, before: before))
    }
    func run(_ type: String, _ payload: [String: JSON] = [:], after seconds: Double = 1) throws {
      clock += seconds * 1000
      let command = Command(type, payload), before = state
      state = try Domain.applyCommand(state, command, now: clock)
      map(command, before)
    }

    try run("project:save", ["name": .string(secret), "outcome": .string(secret)])
    let project = try XCTUnwrap(state.projects.last?.id)
    try run("task:save", ["title": .string(secret), "estimate": 2, "date": "", "project": .string(project)])
    XCTAssertEqual(
      events.last, AnalyticsEvent("task_created", ["has_date": false, "has_project": true, "estimate": 2]))
    let id = try XCTUnwrap(state.tasks.last?.id)
    try run("task:save", ["id": .string(id), "title": .string(secret + "2"), "estimate": 1, "date": "2026-11-10", "project": ""])
    XCTAssertEqual(events.last, AnalyticsEvent("task_updated"))
    let row: JSON = ["title": .string(secret), "estimate": 1, "date": ""]
    try run("task:batch", ["project": "", "tasks": [row, row]])
    XCTAssertEqual(events.last, AnalyticsEvent("task_batch_created", ["count": 2, "has_project": false]))
    try run("task:move", ["id": .string(id), "date": "2026-11-11"])
    try run("task:move", ["id": .string(id), "date": ""])
    XCTAssertEqual(events.last, AnalyticsEvent("task_moved", ["has_date": false]))
    try run("task:reorder", ["id": .string(id), "before": ""])
    let step: JSON = ["title": .string(secret), "estimate": 1]
    try run("template:save", ["name": .string(secret), "steps": [step, step]])
    XCTAssertEqual(events.last, AnalyticsEvent("template_created", ["steps": 2]))
    let template = try XCTUnwrap(state.templates.last?.id)
    try run("template:save", ["id": .string(template), "name": .string(secret), "steps": [step]])
    try run("template:apply", ["id": .string(template), "date": "", "project": .string(project)])
    XCTAssertEqual(events.last, AnalyticsEvent("template_applied", ["has_date": false, "has_project": true]))
    try run("template:delete", ["id": .string(template)])

    try run("timer:play", ["id": .string(id)])
    try run("timer:toggle")
    XCTAssertEqual(events.last, AnalyticsEvent("timer_paused", ["phase": "focus"]))
    try run("timer:toggle")
    XCTAssertEqual(events.last, AnalyticsEvent("timer_resumed", ["phase": "focus"]))
    try run("timer:pause")
    XCTAssertEqual(events.last, AnalyticsEvent("timer_paused"))
    try run("timer:pause")
    XCTAssertEqual(events.last, .some(nil))
    try run("timer:toggle")
    // 집중 시간이 끝난 뒤의 명령은 진척 확인에서 처리된다.
    try run("checkin:save", ["remaining": 1], after: 1501)
    XCTAssertEqual(events.last, AnalyticsEvent("checkin_saved", ["remaining": 1]))
    try run("timer:toggle")
    XCTAssertEqual(events.last, AnalyticsEvent("timer_paused", ["phase": "rest"]))
    try run("timer:end")
    try run("timer:play", ["id": .string(id)])
    try run("checkin:followup", ["title": .string(secret)], after: 1501)
    try run("timer:end")
    try run("timer:play", ["id": .string(id)])
    var checkin = state
    checkin.timer?.phase = .checkin
    map(Command("timer:toggle"), checkin)
    XCTAssertEqual(events.last, .some(nil))
    try run("checkin:skip", after: 1501)
    try run("timer:end")
    try run("timer:play", ["id": .string(id)])
    try run("checkin:done", ["clipId": .string(secret)], after: 1501)
    XCTAssertEqual(events.last, AnalyticsEvent("checkin_done", ["clip": true]))
    try run("timer:end")

    let ticket = try XCTUnwrap(state.tickets.last?.id)
    try run("ticket:update", ["id": .string(ticket), "note": .string(secret), "highlight": true, "sticker": "star"])
    XCTAssertEqual(
      events.last, AnalyticsEvent("ticket_updated", ["note": true, "highlight": true, "sticker": true, "clip": false]))
    try run("task:toggle", ["id": .string(id)])
    XCTAssertEqual(events.last, AnalyticsEvent("task_reopened"))
    try run("task:toggle", ["id": .string(id)])
    XCTAssertEqual(events.last, AnalyticsEvent("task_completed"))
    try run("settings:save", ["focus": 1500, "rest": 300])
    XCTAssertEqual(events.last, AnalyticsEvent("settings_changed", ["fields": "focus,rest"]))
    try run("settings:save", ["remindDays": [1, 2], "planAt": "09:00", "dailyCapacity": 6])
    XCTAssertEqual(events.last, AnalyticsEvent("settings_changed", ["fields": "dailyCapacity,planAt,remindDays"]))
    try run("project:save", ["id": .string(project), "name": .string(secret)])
    try run("task:delete", ["id": .string(id)])
    try run("project:delete", ["id": .string(project)])
    let applied = events.compactMap { $0 }
    XCTAssertEqual(applied.count, events.count - 2)

    // 일어난 일이 없으면 보고하지 않는다.
    XCTAssertNil(state.timer)
    for type in ["timer:toggle", "timer:end", "timer:advance", "unknown"] { map(Command(type), state) }
    XCTAssertEqual(events.suffix(4), [nil, nil, nil, nil])

    // 전송 본문까지 확인한다.
    let server = AnalyticsServer()
    let analytics = make(directory(), server)
    for event in applied { analytics.track(event) }
    func delivered() -> Int { server.bodies.reduce(0) { $0 + ($1["batch"]?.array?.count ?? 0) } }
    for _ in 0..<200 where delivered() < applied.count {
      await analytics.flush()
      try await Task.sleep(nanoseconds: 10_000_000)
    }
    let sent = server.requests.map { String(decoding: $0.httpBody ?? Data(), as: UTF8.self) }.joined()
    XCTAssertEqual(delivered(), applied.count)
    for text in ["비밀", id, project, template, ticket] {
      XCTAssertFalse(sent.contains(text), text)
    }
    XCTAssertTrue(sent.contains("task_created"))

    let reference = try Reference.run(jobs, script: "analytics.mjs")
    XCTAssertEqual(reference.count, events.count)
    for (index, event) in events.enumerated() {
      XCTAssertEqual(reference[index]["event"], event?.json ?? .null, "\(jobs[index]["command"] ?? .null)")
    }
  }

  func testNewFocusRecordsAreReportedBulkChangesAreNot() throws {
    func state(_ records: [(String, Double)]) -> AppState {
      var state = AppState()
      state.records = records.map {
        FocusRecord(id: $0.0, taskId: "task", seconds: $0.1, pomodoros: $0.1 >= 1500 ? 1 : 0.5, duration: 1500, at: 0)
      }
      return state
    }
    let before = state([("a", 1500)])
    let cases = [
      (before, state([("a", 1500), ("b", 1500)])), (before, state([("a", 1500), ("c", 600)])), (before, before),
      (state([]), state(["a", "b", "c"].map { ($0, 1500) })), (state([]), state(["a", "b", "c", "d"].map { ($0, 1500) })),
      (before, state([("b", 1500)])),
    ]
    let events = cases.map { AnalyticsEvents.records($0.0, $0.1) }
    XCTAssertEqual(
      events[0], [AnalyticsEvent("focus_recorded", ["pomodoros": 1, "minutes": 25, "completed": true])])
    XCTAssertEqual(
      events[1], [AnalyticsEvent("focus_recorded", ["pomodoros": 0, "minutes": 25, "completed": false])])
    XCTAssertEqual(events[2], [])
    XCTAssertEqual(events[3].count, 3)
    XCTAssertEqual(events[4], [])
    XCTAssertEqual(events[5], [])
    let reference = try Reference.run(
      cases.map { ["step": "records", "previous": $0.0.json, "next": $0.1.json] }, script: "analytics.mjs")
    for (index, list) in events.enumerated() {
      XCTAssertEqual(reference[index]["events"], .array(list.map(\.json)), "\(index)")
    }
  }
}

final class Captured: @unchecked Sendable {
  var value: JSON?
}
