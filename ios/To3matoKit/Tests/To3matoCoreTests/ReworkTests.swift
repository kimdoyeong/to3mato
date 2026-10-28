import XCTest

@testable import To3matoCore

// tests/rework.test.mjs와 같은 입력·기대값

/// JS에서 `now`를 생략한 호출. `Date.now()`를 쓴다.
private func applyNow(_ state: AppState, _ type: String, _ payload: [String: JSON] = [:]) throws -> AppState {
  try apply(state, type, payload, epochMilliseconds())
}

/// JS의 `assert.throws(fn, /message/)`
private func assertThrows<T>(
  _ expression: @autoclosure () throws -> T, _ message: String, file: StaticString = #filePath, line: UInt = #line
) {
  XCTAssertThrowsError(try expression(), file: file, line: line) {
    let text = ($0 as? DomainError)?.message ?? "\($0)"
    XCTAssertTrue(text.contains(message), "\(text)", file: file, line: line)
  }
}

/// structuredClone 후 중첩 키 하나를 바꾼 JSON
private func setting(_ json: JSON, _ path: [String], _ value: JSON) -> JSON {
  guard let key = path.first, var object = json.object else { return value }
  object[key] = setting(object[key] ?? .null, Array(path.dropFirst()), value)
  return .object(object)
}

final class ReworkTests: XCTestCase {
  let focusEnd: Double = 1000 + 1500 * 1000

  func finishedFocus(_ id: String = "t1", file: StaticString = #filePath, line: UInt = #line) throws -> AppState {
    let started = try apply(Domain.createInitialState(), "timer:play", ["id": .string(id)], 1000)
    var state = started
    XCTAssertTrue(Domain.advanceTimer(&state, focusEnd), file: file, line: line)
    return state
  }

  func testFinishedFocusWaitsInCheckin() throws {
    var s = try finishedFocus()
    XCTAssertEqual(
      s.timer, TimerState(taskId: "t1", duration: 1500, elapsed: 1500, startedAt: focusEnd, running: false, phase: .checkin))
    XCTAssertEqual(s.records.count, 1)
    XCTAssertEqual(s.tasks[0].done, false)
    let view = Domain.timerMenuState(s, now: focusEnd + 60000)
    XCTAssertEqual(view.status, "진척 확인")
    XCTAssertEqual(view.clock, "00:00")
    XCTAssertEqual(view.paused, true)
    XCTAssertEqual(view.phase, "checkin")
    XCTAssertEqual(view.primary, "휴식 시작")
    XCTAssertEqual(view.command, Command("checkin:skip"))
    XCTAssertEqual(view.end, "집중 종료")
    XCTAssertEqual(view.endEnabled, true)
    // Nothing happens on its own and the state round-trips.
    XCTAssertEqual(Domain.advanceTimer(&s, focusEnd + 10 * 60 * 1000), false)
    XCTAssertEqual(try Domain.normalizeState(s.json), s)
  }

  func testCheckinSaveAdjustsRemainingAndStartsRest() throws {
    let s = try finishedFocus()
    let saved = try apply(s, "checkin:save", ["remaining": 1], focusEnd + 5000)
    XCTAssertEqual(saved.tasks[0].remaining, 1)
    XCTAssertEqual(saved.tasks[0].estimate, 2)
    XCTAssertEqual(saved.tasks[0].done, false)
    XCTAssertEqual(
      saved.timer, TimerState(taskId: nil, duration: 300, elapsed: 0, startedAt: focusEnd + 5000, running: true, phase: .rest))
    XCTAssertEqual(saved.tickets.count, 0)
    let invalid: [JSON?] = [-1, 1.5, 49, "x", nil]
    for remaining in invalid {
      var payload: [String: JSON] = [:]
      payload["remaining"] = remaining
      XCTAssertThrowsError(try applyNow(s, "checkin:save", payload), "\(String(describing: remaining))")
    }
  }

  func testCheckinDoneCompletesTaskAndIssuesTicket() throws {
    let s = try finishedFocus()
    let done = try apply(s, "checkin:done", ["clipId": "t1:123"], focusEnd + 1)
    XCTAssertEqual(done.tasks[0].done, true)
    XCTAssertEqual(done.timer?.phase, .rest)
    XCTAssertEqual(done.tickets.count, 1)
    var ticket = done.tickets[0]
    XCTAssertNotNil(ticket.id.range(of: "^[0-9a-f-]{36}$", options: .regularExpression))
    ticket.id = "x"
    var expected = Ticket(
      id: "x", taskId: "t1", title: "프로젝트 아이디어 정리", projectId: "p1", completedAt: focusEnd + 1, estimate: 2, used: 1)
    expected.clipId = "t1:123"
    expected.note = ""
    expected.highlight = false
    expected.sticker = ""
    expected.voided = false
    XCTAssertEqual(ticket, expected)
    XCTAssertEqual(Domain.usedPomodoros(done, "t1"), 1)
  }

  func testCheckinFollowupCarriesRestIntoNewTask() throws {
    let s = try finishedFocus()
    let next = try apply(s, "checkin:followup", [:], focusEnd)
    let original = next.tasks[0], followUp = next.tasks[1]
    XCTAssertEqual(original.id, "t1")
    XCTAssertEqual(original.remaining, 0)
    XCTAssertEqual(original.done, false)
    XCTAssertEqual(followUp.title, original.title)
    XCTAssertEqual(followUp.estimate, 1)
    XCTAssertEqual(followUp.remaining, 1)
    XCTAssertEqual(followUp.followUpOf, "t1")
    XCTAssertEqual(followUp.date, original.date)
    XCTAssertEqual(followUp.project, original.project)
    XCTAssertEqual(followUp.done, false)
    XCTAssertEqual(next.tasks.count, s.tasks.count + 1)
    XCTAssertEqual(next.timer?.phase, .rest)
    let titled = try apply(s, "checkin:followup", ["title": "본문 마무리"], focusEnd)
    XCTAssertEqual(titled.tasks[1].title, "본문 마무리")
    XCTAssertEqual(try Domain.normalizeState(titled.json), titled)
  }

  func testCheckinCommandsRefusedOutsideCheckinAndOthersLeaveItIntact() throws {
    let idle = Domain.createInitialState()
    let focusing = try apply(idle, "timer:play", ["id": "t1"], 1000)
    let resting = try applyNow(try finishedFocus(), "checkin:skip")
    for state in [idle, focusing, resting] {
      for type in ["checkin:save", "checkin:done", "checkin:followup", "checkin:skip"] {
        assertThrows(try apply(state, type, ["remaining": 1], 2000), "진척 확인 중이 아닙니다")
      }
    }
    let s = try finishedFocus()
    // Pause and toggle do nothing; settings keep the check-in.
    for command in [Command("timer:toggle"), Command("timer:pause"), Command("settings:save", ["focus": 900])] {
      XCTAssertEqual(try Domain.applyCommand(s, command, now: focusEnd + 10).timer, s.timer, command.type)
    }
    // Starting any task, even the same one, begins a fresh focus without a record.
    for id in ["t1", "t2"] {
      let played = try apply(s, "timer:play", ["id": .string(id)], focusEnd + 10)
      XCTAssertEqual(played.records.count, 1)
      XCTAssertEqual(played.timer?.phase, .focus)
      XCTAssertEqual(played.timer?.taskId, id)
      XCTAssertEqual(played.timer?.elapsed, 0)
    }
    let ended = try apply(s, "timer:end", [:], focusEnd + 10)
    XCTAssertNil(ended.timer)
    XCTAssertEqual(ended.records.count, 1)
    // Completing or deleting the task from the list settles the check-in too.
    XCTAssertNil(try applyNow(s, "task:toggle", ["id": "t1"]).timer)
    XCTAssertNil(try applyNow(s, "task:delete", ["id": "t1"]).timer)
  }

  func testNormalizeStateKeepsValidCheckinStopsItAndRejectsStaleOnes() throws {
    let s = try finishedFocus()
    let running = setting(s.json, ["timer", "running"], true)
    XCTAssertEqual(try Domain.normalizeState(running).timer?.running, false)
    var done = s
    done.tasks[0].done = true
    assertThrows(try Domain.normalizeState(done.json), "실행 중인 작업을 찾을 수 없습니다")
    let missing = setting(s.json, ["timer", "taskId"], "nope")
    assertThrows(try Domain.normalizeState(missing), "실행 중인 작업을 찾을 수 없습니다")
    let other = setting(s.json, ["timer", "phase"], "other")
    assertThrows(try Domain.normalizeState(other), "타이머 상태가 올바르지 않습니다")
  }

  func testCompletingIssuesTicketUndoVoidsRedoIssuesNew() throws {
    var s = try apply(Domain.createInitialState(), "timer:play", ["id": "t3"], 1000)
    s = try apply(s, "task:toggle", ["id": "t3"], 751_000)
    XCTAssertNil(s.timer)
    XCTAssertEqual(s.tickets.count, 1)
    XCTAssertEqual(s.tickets[0].used, 0.5)
    XCTAssertEqual(s.tickets[0].estimate, 1)
    XCTAssertEqual(s.tickets[0].completedAt, 751_000)
    s = try apply(s, "task:toggle", ["id": "t3"], 760_000)
    XCTAssertEqual(s.tasks[2].done, false)
    XCTAssertEqual(s.tickets[0].voided, true)
    s = try apply(s, "task:toggle", ["id": "t3"], 770_000)
    XCTAssertEqual(s.tickets.count, 2)
    XCTAssertEqual(s.tickets[1].voided, false)
    // Deleting the task keeps its tickets.
    s = try applyNow(s, "task:delete", ["id": "t3"])
    XCTAssertEqual(s.tickets.count, 2)
    XCTAssertEqual(try Domain.normalizeState(s.json), s)
  }

  func testTicketUpdateChangesDecorationOnly() throws {
    var s = try applyNow(Domain.createInitialState(), "task:toggle", ["id": "t3"])
    let id = JSON.string(s.tickets[0].id)
    s = try applyNow(s, "ticket:update", ["id": id, "note": " 메모 ", "highlight": true, "sticker": "heart"])
    XCTAssertEqual(s.tickets[0].note, "메모")
    XCTAssertEqual(s.tickets[0].highlight, true)
    XCTAssertEqual(s.tickets[0].sticker, "heart")
    XCTAssertEqual(s.tickets[0].title, "도서 읽기")
    s = try applyNow(s, "ticket:update", ["id": id, "sticker": ""])
    XCTAssertEqual(s.tickets[0].sticker, "")
    assertThrows(try applyNow(s, "ticket:update", ["id": id, "sticker": "x"]), "입력 내용을 확인하세요")
    assertThrows(
      try applyNow(s, "ticket:update", ["id": id, "note": .string(String(repeating: "a", count: 201))]),
      "입력 내용을 확인하세요")
    assertThrows(try applyNow(s, "ticket:update", ["id": "nope"]), "티켓을 찾을 수 없습니다")
  }

  func testTicketAndTemplateRowsValidate() throws {
    let ticket: [String: JSON] = [
      "id": "k1", "taskId": "t1", "title": "제목", "projectId": "p1", "completedAt": 5, "estimate": 2, "used": 1.5,
      "clipId": "", "note": "", "highlight": false, "sticker": "", "voided": false,
    ]
    func with(_ base: [String: JSON], _ extra: [String: JSON]) -> JSON { .object(base.merging(extra) { $1 }) }
    var expectedTicket = Ticket(
      id: "k1", taskId: "t1", title: "제목", projectId: "p1", completedAt: 5, estimate: 2, used: 1.5)
    expectedTicket.clipId = ""
    expectedTicket.note = ""
    expectedTicket.highlight = false
    expectedTicket.sticker = ""
    expectedTicket.voided = false
    XCTAssertEqual(
      try Domain.validateTicketRow(with(ticket, ["sticker": "x", "highlight": "yes", "extra": 1])), expectedTicket)
    XCTAssertThrowsError(try Domain.validateTicketRow(with(ticket, ["used": -1])))
    XCTAssertThrowsError(try Domain.validateTicketRow(with(ticket, ["estimate": 0])))
    XCTAssertThrowsError(try Domain.validateTicketRow(with(ticket, ["note": .string(String(repeating: "a", count: 201))])))
    XCTAssertThrowsError(try Domain.validateTicketRow(with(ticket, ["title": ""])))
    let steps: [JSON] = [["title": "읽기", "estimate": 1], ["title": "문제 풀기", "estimate": 2]]
    let template: [String: JSON] = ["id": "m1", "name": "학습", "steps": .array(steps), "position": 0]
    let validated = try Domain.validateTemplateRow(
      with(template, ["steps": .array(steps.map { setting($0, ["extra"], 1) })]))
    XCTAssertEqual(
      validated.0,
      TaskTemplate(
        id: "m1", name: "학습",
        steps: [TemplateStep(title: "읽기", estimate: 1), TemplateStep(title: "문제 풀기", estimate: 2)]))
    XCTAssertEqual(validated.position, 0)
    XCTAssertThrowsError(try Domain.validateTemplateRow(with(template, ["steps": []])))
    assertThrows(
      try Domain.validateTemplateRow(with(template, ["steps": .array(Array(repeating: steps[0], count: 21))])),
      "템플릿 단계는 1~20개여야 합니다")
    XCTAssertThrowsError(try Domain.validateTemplateRow(with(template, ["steps": [["title": "긴 단계", "estimate": 3]]])))
    XCTAssertThrowsError(
      try Domain.validateTemplateRow(with(template, ["name": .string(String(repeating: "a", count: 81))])))
  }

  func testTemplatesSaveApplyOneRoundAndDelete() throws {
    var s = try applyNow(
      Domain.createInitialState(), "template:save",
      [
        "name": "학습 1회차",
        "steps": [
          ["title": "%n%강 읽기", "estimate": 1],
          ["title": "%n%강 문제 풀기", "estimate": 2],
          ["title": "%n%강 답 맞추기", "estimate": 1],
        ],
      ])
    XCTAssertEqual(s.templates.count, 1)
    let id = JSON.string(s.templates[0].id)
    let before = s.tasks.count
    s = try applyNow(s, "template:apply", ["id": id, "date": "2026-10-27", "project": "p2"])
    let added = s.tasks[before...]
    XCTAssertEqual(
      added.map {
        [JSON.string($0.title), .number(Double($0.estimate)), .number(Double($0.remaining)), .string($0.date),
         .string($0.project), .bool($0.done)]
      },
      [
        ["1강 읽기", 1, 1, "2026-10-27", "p2", false],
        ["1강 문제 풀기", 2, 2, "2026-10-27", "p2", false],
        ["1강 답 맞추기", 1, 1, "2026-10-27", "p2", false],
      ])
    // Project-less application into the unscheduled list works too.
    let loose = try applyNow(s, "template:apply", ["id": id])
    XCTAssertEqual(loose.tasks.suffix(3).map { [$0.date, $0.project] }, [["", ""], ["", ""], ["", ""]])
    assertThrows(
      try applyNow(s, "template:apply", ["id": id, "date": "", "project": "missing"]), "프로젝트를 찾을 수 없습니다")
    s = try applyNow(s, "template:save", ["id": id, "name": "학습", "steps": [["title": "읽기", "estimate": 1]]])
    XCTAssertEqual(s.templates[0].name, "학습")
    XCTAssertEqual(s.templates[0].steps.count, 1)
    assertThrows(
      try applyNow(s, "template:save", ["id": "nope", "name": "x", "steps": [["title": "a", "estimate": 1]]]),
      "템플릿을 찾을 수 없습니다")
    s = try applyNow(s, "template:delete", ["id": id])
    XCTAssertEqual(s.templates, [])
    assertThrows(try applyNow(s, "template:apply", ["id": id]), "템플릿을 찾을 수 없습니다")
    XCTAssertEqual(try Domain.normalizeState(s.json), s)
  }

  func testProjectsKeepOutcomeAndCoverImage() throws {
    var s = try applyNow(
      Domain.createInitialState(), "project:save", ["name": "새 프로젝트", "outcome": " 보고서 1부 ", "image": "x.png"])
    let project = s.projects.last!
    XCTAssertEqual(project.outcome, "보고서 1부")
    XCTAssertEqual(project.image, "x.png")
    s = try applyNow(s, "project:save", ["id": .string(project.id), "name": "이름만 수정"])
    XCTAssertEqual(s.projects.last!.outcome, "보고서 1부")
    s = try applyNow(s, "project:save", ["id": .string(project.id), "name": "이름", "outcome": "", "image": "../evil"])
    XCTAssertEqual(s.projects.last!.outcome, "")
    XCTAssertEqual(s.projects.last!.image, "")
    XCTAssertThrowsError(
      try applyNow(s, "project:save", ["name": "x", "outcome": .string(String(repeating: "a", count: 121))]))
  }

  func testSettingsMergeGivenKeysAndValidate() throws {
    let s = Domain.createInitialState()
    let next = try applyNow(s, "settings:save", ["dailyCapacity": 6, "planAt": "09:00", "remindDays": [5, 1, 1]])
    var expected = s.settings
    expected.dailyCapacity = 6
    expected.planAt = "09:00"
    expected.remindDays = [1, 5]
    XCTAssertEqual(next.settings, expected)
    let cleared = try applyNow(next, "settings:save", ["planAt": "", "reviewAt": "18:30"])
    XCTAssertEqual(cleared.settings.planAt, "")
    XCTAssertEqual(cleared.settings.reviewAt, "18:30")
    XCTAssertEqual(cleared.settings.dailyCapacity, 6)
    for payload: [String: JSON] in [
      ["dailyCapacity": 0],
      ["dailyCapacity": 17],
      ["dailyCapacity": 1.5],
      ["planAt": "24:00"],
      ["reviewAt": "9:00"],
      ["remindDays": [7]],
      ["remindDays": "mon"],
    ] {
      XCTAssertThrowsError(try applyNow(s, "settings:save", payload), "\(payload)")
    }
    XCTAssertEqual(try Domain.validateSettings(["focus": 1500, "rest": 300]), s.settings)
  }

  func testTaskReorderMovesBeforeAnotherOrToEnd() throws {
    let s = Domain.createInitialState()
    func ids(_ state: AppState) -> [String] { state.tasks.map(\.id) }
    XCTAssertEqual(ids(try applyNow(s, "task:reorder", ["id": "t3", "before": "t1"])), ["t3", "t1", "t2", "t4", "t5"])
    XCTAssertEqual(ids(try applyNow(s, "task:reorder", ["id": "t1", "before": ""])), ["t2", "t3", "t4", "t5", "t1"])
    XCTAssertEqual(ids(try applyNow(s, "task:reorder", ["id": "t1", "before": "t1"])), ids(s))
    XCTAssertThrowsError(try applyNow(s, "task:reorder", ["id": "nope", "before": "t1"]))
    XCTAssertThrowsError(try applyNow(s, "task:reorder", ["id": "t1", "before": "nope"]))
  }
}
