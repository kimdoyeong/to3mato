import XCTest

@testable import To3matoCore

// tests/domain.test.mjs와 같은 입력·기대값

func apply(_ state: AppState, _ type: String, _ payload: [String: JSON] = [:], _ now: Double = 0) throws -> AppState {
  try Domain.applyCommand(state, Command(type, payload), now: now)
}

final class DomainTests: XCTestCase {
  let initial = Domain.createInitialState()
  let legacyRecord: [String: JSON] = ["taskId": "t1", "seconds": 750, "pomodoros": 0.5, "duration": 1500, "at": 42]

  func testProjectDeletionDetachesTasksAndPreservesRecordsAndTimer() throws {
    var state = try apply(initial, "timer:play", ["id": "t1"], 0)
    state = try apply(state, "timer:end", [:], 600_000)
    state = try apply(state, "timer:play", ["id": "t1"], 600_000)
    let before = state
    let deleted = try apply(state, "project:delete", ["id": "p1"], 601_000)
    XCTAssertEqual(state, before)
    XCTAssertEqual(deleted.projects, before.projects.filter { $0.id != "p1" })
    XCTAssertEqual(
      deleted.tasks,
      before.tasks.map {
        var task = $0
        if task.project == "p1" { task.project = "" }
        return task
      })
    XCTAssertEqual(deleted.records, before.records)
    XCTAssertEqual(deleted.timer, before.timer)
    XCTAssertEqual(try Domain.normalizeState(deleted.json), deleted)
    XCTAssertThrowsError(try apply(deleted, "project:delete", ["id": "p1"], 601_000)) {
      XCTAssertEqual(($0 as? DomainError)?.message, "프로젝트를 찾을 수 없습니다.")
    }
  }

  func testNewEstimatesStopAtTwoWhileLegacyEstimatesAreRetained() throws {
    var state = initial
    let task: [String: JSON] = ["title": "새 작업", "date": "", "project": ""]
    let saved = try apply(state, "task:save", task.merging(["estimate": 2]) { $1 }).tasks.last!
    XCTAssertEqual(saved.estimate, 2)
    XCTAssertEqual(saved.remaining, 2)
    XCTAssertEqual(saved.followUpOf, "")
    for estimate: JSON in [0, 1.5, 3, 7, 48] {
      XCTAssertThrowsError(try apply(state, "task:save", task.merging(["estimate": estimate]) { $1 }))
      XCTAssertThrowsError(
        try apply(state, "task:batch", ["project": "p1", "tasks": [.object(task.merging(["estimate": estimate]) { $1 })]]))
    }
    state.tasks[0].estimate = 48
    state.tasks[0].remaining = 48
    let loaded = try Domain.normalizeState(state.json)
    func payload(_ task: TaskItem, _ extra: [String: JSON]) -> [String: JSON] {
      task.json.object!.merging(extra) { $1 }
    }
    let updated = try apply(loaded, "task:save", payload(loaded.tasks[0], ["title": "기존 작업 수정"]))
    XCTAssertEqual(updated.tasks[0].estimate, 48)
    XCTAssertEqual(updated.tasks[0].remaining, 48)
    XCTAssertThrowsError(try apply(updated, "task:save", payload(updated.tasks[0], ["estimate": 7])))
    var reducedPayload = payload(updated.tasks[0], ["estimate": 2])
    reducedPayload["remaining"] = nil
    let reduced = try apply(updated, "task:save", reducedPayload)
    XCTAssertEqual(reduced.tasks[0].estimate, 2)
    // The remaining estimate follows a changed estimate unless given.
    XCTAssertEqual(reduced.tasks[0].remaining, 2)
    XCTAssertThrowsError(try apply(reduced, "task:save", payload(reduced.tasks[0], ["estimate": 48])))
    let kept = try apply(reduced, "task:save", payload(reduced.tasks[0], ["remaining": 1]))
    XCTAssertEqual(kept.tasks[0].remaining, 1)
    XCTAssertThrowsError(try apply(kept, "task:save", payload(kept.tasks[0], ["remaining": -1])))
  }

  func testHalfPomodoroRoundingBoundaries() {
    for (seconds, value) in [(0.0, 0.0), (374, 0), (375, 0.5), (750, 0.5), (1124, 0.5), (1125, 1), (1500, 1)] {
      XCTAssertEqual(Domain.roundedPomodoros(seconds, 1500), value, "\(seconds)")
    }
  }

  func testSwitchingStoresAAndStartsBFromZero() throws {
    var s = try apply(initial, "timer:play", ["id": "t1"], 1000)
    s = try apply(s, "timer:play", ["id": "t2"], 751_000)
    XCTAssertEqual(s.records[0].seconds, 750)
    XCTAssertEqual(s.records[0].pomodoros, 0.5)
    XCTAssertEqual(s.timer?.taskId, "t2")
    XCTAssertEqual(Domain.elapsedSeconds(s.timer!, 751_000), 0)
  }

  func testPauseExcludesWallClockTimeWhilePaused() throws {
    var s = try apply(initial, "timer:play", ["id": "t1"], 1000)
    s = try apply(s, "timer:toggle", [:], 101_000)
    s = try apply(s, "timer:toggle", [:], 601_000)
    XCTAssertEqual(Domain.elapsedSeconds(s.timer!, 651_000), 150)
  }

  func testCompletionRecordsOnceAndWaitsForCheckin() throws {
    var s = try apply(initial, "timer:play", ["id": "t1"], 0)
    XCTAssertTrue(Domain.advanceTimer(&s, 1_600_000))
    XCTAssertEqual(s.records.count, 1)
    XCTAssertEqual(s.records[0].seconds, 1500)
    XCTAssertEqual(s.timer?.phase, .checkin)
    XCTAssertEqual(s.timer?.running, false)
    XCTAssertEqual(s.timer?.taskId, "t1")
    XCTAssertFalse(s.tasks[0].done)
    XCTAssertFalse(Domain.advanceTimer(&s, 1_650_000))
    s = try apply(s, "checkin:skip", [:], 1_600_000)
    XCTAssertEqual(s.timer?.phase, .rest)
    XCTAssertEqual(s.timer?.running, true)
    XCTAssertFalse(Domain.advanceTimer(&s, 1_700_000))
    XCTAssertEqual(Domain.elapsedSeconds(s.timer!, 1_700_000), 100)
    XCTAssertTrue(Domain.advanceTimer(&s, 1_900_000))
    XCTAssertNil(s.timer)
    XCTAssertFalse(Domain.advanceTimer(&s, 1_901_000))
    XCTAssertEqual(s.records.count, 1)
  }

  func testChangingSettingsLeavesCurrentDurationUnchanged() throws {
    var s = try apply(initial, "timer:play", ["id": "t1"], 0)
    s = try apply(s, "settings:save", ["focus": 900], 1000)
    XCTAssertEqual(s.timer?.duration, 1500)
    s = try apply(s, "timer:play", ["id": "t2"], 2000)
    XCTAssertEqual(s.timer?.duration, 900)
  }

  func testCompletingOrDeletingActiveTaskPreservesActualTime() throws {
    for type in ["task:toggle", "task:delete"] {
      var s = try apply(initial, "timer:play", ["id": "t1"], 0)
      s = try apply(s, type, ["id": "t1"], 600_000)
      XCTAssertNil(s.timer)
      XCTAssertEqual(s.records[0].seconds, 600)
      XCTAssertEqual(s.records[0].pomodoros, 0.5)
    }
  }

  func testDateSections() {
    func task(_ id: String, _ date: String, done: Bool = false) -> TaskItem {
      TaskItem(id: id, title: id, estimate: 1, remaining: 1, date: date, done: done)
    }
    let tasks = [task("u", ""), task("t", "2026-12-31"), task("n", "2027-01-01"), task("f", "2027-03-12"),
                 task("p", "2026-12-01", done: true)]
    let s = Domain.todoSections(tasks, today: "2026-12-31")
    XCTAssertEqual(s.map(\.label), ["오늘", "내일", "2027년 3월 12일", "미지정"])
    XCTAssertEqual(s.flatMap(\.tasks).count, tasks.count - 1)
    let open = Domain.todoSections(tasks + [task("q", "2026-12-01")], today: "2026-12-31")
    XCTAssertEqual(open.map(\.label), ["오늘", "내일", "2027년 3월 12일", "12월 1일", "미지정"])
  }

  func testMovingDatesRetainsHistory() throws {
    var s = initial
    s.records.append(FocusRecord(id: "r", taskId: "t1", seconds: 1500, pomodoros: 1, duration: 1500, at: 1))
    s = try apply(s, "task:move", ["id": "t1", "date": ""])
    XCTAssertEqual(s.tasks[0].date, "")
    XCTAssertEqual(s.records.count, 1)
  }

  func testInvalidCommandsDoNotMutate() {
    let s = initial
    XCTAssertThrowsError(try apply(s, "settings:save", ["focus": .number(.nan)]))
    XCTAssertThrowsError(try apply(s, "task:move", ["id": "t1", "date": "2026-02-31"]))
    XCTAssertEqual(s, initial)
  }

  func testImportRejectsMalformedAndDuplicateData() throws {
    XCTAssertThrowsError(try Domain.normalizeState(["version": 1, "tasks": [], "records": []]))
    var s = initial
    s.tasks.append(s.tasks[0])
    XCTAssertThrowsError(try Domain.normalizeState(s.json))
    XCTAssertEqual(try Domain.normalizeState(initial.json), initial)
  }

  func testResumingWithStaleClockNeverSubtractsFocusedTime() throws {
    var state = try apply(initial, "timer:play", ["id": "t1"], 1000)
    state = try apply(state, "timer:pause", [:], 301_000)
    state = try apply(state, "timer:toggle", [:], 601_000)
    XCTAssertEqual(Domain.elapsedSeconds(state.timer!, 600_750), 300)
    XCTAssertEqual(Domain.elapsedSeconds(state.timer!, 602_000), 301)
  }

  func testNewFocusRecordsReceiveUniqueIds() throws {
    var s = try apply(initial, "timer:play", ["id": "t1"], 0)
    s = try apply(s, "timer:play", ["id": "t2"], 600_000)
    s = try apply(s, "timer:end", [:], 1_200_000)
    XCTAssertEqual(s.records.count, 2)
    for record in s.records {
      XCTAssertNotNil(
        record.id.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression))
    }
    XCTAssertNotEqual(s.records[0].id, s.records[1].id)
    XCTAssertEqual(try Domain.normalizeState(s.json), s)
  }

  func stateWith(records: [JSON]) -> JSON {
    var object = initial.json.object!
    object["records"] = .array(records)
    return .object(object)
  }

  func testLegacyRecordsGetDeterministicIds() throws {
    let id = Domain.legacyRecordId(legacyRecord)
    XCTAssertNotNil(id.range(of: "^legacy-[0-9a-f]{16}$", options: .regularExpression))
    XCTAssertNotEqual(Domain.legacyRecordId(legacyRecord.merging(["at": 43]) { $1 }), id)
    XCTAssertNotNil(
      Domain.legacyRecordId(legacyRecord.merging(["taskId": .string(String(repeating: "x", count: 120))]) { $1 })
        .range(of: "^legacy-[0-9a-f]{16}$", options: .regularExpression))
    let first = try Domain.normalizeState(stateWith(records: [.object(legacyRecord)]))
    XCTAssertEqual(first.records[0].id, id)
    XCTAssertEqual(try Domain.normalizeState(stateWith(records: [.object(legacyRecord)])), first)
    XCTAssertEqual(try Domain.normalizeState(first.json), first)
  }

  /// Mac(node)에서 계산한 값과 같아야 기존 백업을 가져올 때 ID가 같다.
  func testLegacyRecordIdMatchesMac() {
    XCTAssertEqual(Domain.legacyRecordId(legacyRecord), "legacy-6b30d929985119fb")
  }

  func testIdenticalLegacyRecordsStayDistinct() throws {
    let base = Domain.legacyRecordId(legacyRecord)
    let r = JSON.object(legacyRecord)
    XCTAssertEqual(try Domain.normalizeState(stateWith(records: [r, r, r])).records.map(\.id), [base, "\(base)-2", "\(base)-3"])
    XCTAssertEqual(
      try Domain.normalizeState(stateWith(records: [r, .object(legacyRecord.merging(["id": .string(base)]) { $1 })]))
        .records.map(\.id),
      ["\(base)-2", base])
    XCTAssertThrowsError(
      try Domain.normalizeState(
        stateWith(records: [
          .object(legacyRecord.merging(["id": "r1"]) { $1 }), .object(legacyRecord.merging(["id": "r1", "at": 50]) { $1 }),
        ]))
    ) { XCTAssertEqual(($0 as? DomainError)?.message, "집중 기록 ID가 중복됩니다.") }
    XCTAssertThrowsError(try Domain.normalizeState(stateWith(records: [.object(legacyRecord.merging(["id": ""]) { $1 })])))
  }

  func testRowValidatorsAcceptValidRows() throws {
    let (project, position) = try Domain.validateProjectRow(
      ["id": "p1", "name": " 독서 ", "icon": "leaf", "color": "#ABCDEF", "position": 2, "extra": true])
    XCTAssertEqual(project, Project(id: "p1", name: "독서", icon: "leaf", color: "#ABCDEF"))
    XCTAssertEqual(position, 2)
    XCTAssertEqual(
      try Domain.validateProjectRow(["id": "p1", "name": "a", "icon": "x", "color": "red", "position": 0]).0,
      Project(id: "p1", name: "a"))
    let (task, _) = try Domain.validateTaskRow(
      ["id": "t9", "title": "할 일", "estimate": 3, "project": "missing-project", "date": "2026-10-20", "done": true,
       "position": 0, "owner": "x"])
    XCTAssertEqual(
      task,
      TaskItem(id: "t9", title: "할 일", estimate: 3, remaining: 3, project: "missing-project", date: "2026-10-20", done: true))
    XCTAssertFalse(
      try Domain.validateTaskRow(["id": "t", "title": "a", "estimate": 1, "date": "", "done": "yes", "position": 0]).0.done)
    XCTAssertEqual(
      try Domain.validateRecordRow(.object(legacyRecord.merging(["id": "r1", "position": 5, "note": 1]) { $1 })),
      FocusRecord(id: "r1", taskId: "t1", seconds: 750, pomodoros: 0.5, duration: 1500, at: 42))
    let settings = try Domain.validateSettings(["focus": 1500, "rest": 300, "x": 1])
    XCTAssertEqual(settings, Settings())
  }

  func testRowValidatorsRejectOutOfRangeValues() {
    let task: [String: JSON] = ["id": "t", "title": "a", "estimate": 1, "date": "", "position": 0]
    let record = legacyRecord.merging(["id": "r"]) { $1 }
    let project: [String: JSON] = ["id": "p", "name": "n", "position": 0]
    func with(_ base: [String: JSON], _ key: String, _ value: JSON?) -> JSON {
      var copy = base
      copy[key] = value
      return .object(copy)
    }
    let long = JSON.string(String(repeating: "x", count: 121))
    for invalid: JSON in [
      .null, with(task, "id", ""), with(task, "id", long), with(task, "title", long), with(task, "estimate", 0),
      with(task, "estimate", 49), with(task, "estimate", 1.5), with(task, "date", "2026-02-31"),
      with(task, "project", 7), with(task, "position", -1), with(task, "position", 0.5),
      with(task, "position", 100_001),
    ] {
      XCTAssertThrowsError(try Domain.validateTaskRow(invalid), "\(invalid)")
    }
    for invalid: JSON in [
      .null, with(record, "id", nil), with(record, "taskId", ""), with(record, "seconds", -1),
      with(record, "seconds", 86401), with(record, "pomodoros", 1.5), with(record, "duration", 0),
      with(record, "at", .number(.nan)), with(record, "at", "1"),
    ] {
      XCTAssertThrowsError(try Domain.validateRecordRow(invalid), "\(invalid)")
    }
    for invalid: JSON in [.null, with(project, "name", .string(String(repeating: "x", count: 81))), with(project, "position", nil)] {
      XCTAssertThrowsError(try Domain.validateProjectRow(invalid))
    }
    for invalid: JSON in [.null, ["focus": 0, "rest": 300], ["focus": 1500]] {
      XCTAssertThrowsError(try Domain.validateSettings(invalid))
    }
  }

  func testTrayDisplayDefaultsAndChangesWithoutDisturbingTimer() throws {
    for value: JSON? in [nil, .null, "unknown", 123] {
      var raw: [String: JSON] = ["focus": 1500, "rest": 300]
      raw["trayDisplay"] = value
      XCTAssertEqual(try Domain.validateSettings(.object(raw)).trayDisplay, "clock")
    }
    var state = try apply(initial, "timer:play", ["id": "t1"], 1000)
    let timer = state.timer
    for tray in ["clock", "bar", "ring", "hourglass"] {
      state = try apply(state, "settings:save", ["trayDisplay": .string(tray)], 1000)
      XCTAssertEqual(state.settings.trayDisplay, tray)
      XCTAssertEqual(state.timer, timer)
    }
    state = try apply(state, "settings:save", ["focus": 900], 1000)
    XCTAssertEqual(state.settings.trayDisplay, "hourglass")
  }

  func testJSONRoundTripKeepsNumbersAndBooleansApart() throws {
    let value: JSON = ["a": 1, "b": true, "c": 0.5, "d": [1, "x", false], "e": nil]
    XCTAssertEqual(try JSON.parse(value.data()), value)
    XCTAssertEqual(String(decoding: try JSON.number(1500).data(), as: UTF8.self), "1500")
  }
}
