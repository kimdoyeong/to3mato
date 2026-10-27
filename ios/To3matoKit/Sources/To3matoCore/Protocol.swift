import Foundation

// Mac의 src/lib/sync/protocol.mjs. 서버(sync_private.command)와 같은 결과를 내야 한다.

public enum SyncProtocol {
  public static let version = 1
  public static let collections = ["projects", "tasks", "records", "tickets", "templates"]
  public static let extras = ["rituals", "assets", "clips", "deliveries"]
  public static let sharedCommands: Set<String> = [
    "timer:play", "timer:toggle", "timer:pause", "timer:end", "timer:advance", "timer:adopt", "checkin:save",
    "checkin:done", "checkin:followup", "checkin:skip", "task:toggle", "task:delete", "project:delete",
    "task:reorder",
  ]

  public static func emptyState() -> AppState {
    var state = Domain.createInitialState()
    state.projects = []
    state.tasks = []
    state.records = []
    state.tickets = []
    state.templates = []
    return state
  }
}

/// 공유 타이머의 세션과 확정 revision
public struct TimerMeta: Equatable, Sendable {
  public var sessionId: String?
  public var revision: String
  public var controller: String?

  public init(sessionId: String? = nil, revision: String = "", controller: String? = nil) {
    self.sessionId = sessionId
    self.revision = revision
    self.controller = controller
  }

  public var json: JSON {
    ["sessionId": .optional(sessionId), "revision": .string(revision), "controller": .optional(controller)]
  }
}

/// 계정의 동기화 문서: 확정 상태, 부가 항목, 타이머 세션, 삭제 표식, 시간대
public struct SyncDocument: Equatable, Sendable {
  public var state: AppState
  public var extras: [String: [JSON]]
  public var timer: TimerMeta
  public var tombstones: [String: JSON]
  public var timeZone: String

  public init(state: AppState = SyncProtocol.emptyState(), timeZone: String = TimeZone.current.identifier) throws {
    var normalized = try Domain.normalizeState(state.json)
    normalized.settings.trayDisplay = nil
    self.state = normalized
    self.extras = Dictionary(uniqueKeysWithValues: SyncProtocol.extras.map { ($0, []) })
    self.timer = TimerMeta()
    self.tombstones = [:]
    self.timeZone = timeZone
  }

  public var json: JSON {
    ["version": .number(Double(SyncProtocol.version)), "state": state.json,
     "extras": .object(extras.mapValues(JSON.array)), "timer": timer.json, "tombstones": .object(tombstones),
     "timeZone": .string(timeZone)]
  }

  /// Mac의 validateDocument()
  public init(validating raw: JSON) throws {
    guard let o = raw.object, o["version"] == .number(Double(SyncProtocol.version)), let extras = o["extras"]?.object,
      let timer = o["timer"]?.object, let revision = timer["revision"]?.string, let tombstones = o["tombstones"]?.object,
      let timeZone = o["timeZone"]?.string
    else { throw DomainError("지원하지 않는 동기화 데이터입니다.") }
    guard TimeZone(identifier: timeZone) != nil else { throw DomainError("지원하지 않는 동기화 데이터입니다.") }
    var state = try Domain.normalizeState(o["state"] ?? .null)
    state.settings.trayDisplay = nil
    var rows: [String: [JSON]] = [:]
    for key in SyncProtocol.extras {
      guard let list = extras[key]?.array, list.allSatisfy({ $0["id"]?.string != nil }) else {
        throw DomainError("잘못된 동기화 데이터입니다.")
      }
      guard Set(list.compactMap { $0["id"]?.string }).count == list.count else {
        throw DomainError("동기화 항목 ID가 중복됩니다.")
      }
      rows[key] = list
    }
    self.state = state
    self.extras = rows
    self.timer = TimerMeta(sessionId: timer["sessionId"]?.string, revision: revision, controller: timer["controller"]?.string)
    self.tombstones = tombstones
    self.timeZone = timeZone
  }
}

/// 서버로 보내는 작업. 재전송 때 서버가 같은 JSON인지 비교하므로 처음 만든 모양 그대로 보관한다.
public struct SyncOperation: Equatable, Sendable {
  public var json: [String: JSON]

  public init(json: [String: JSON]) { self.json = json }

  public var id: String { json["id"]?.string ?? "" }
  public var kind: String { json["kind"]?.string ?? "" }
  public var at: Double { json["at"]?.number ?? 0 }
  public var offline: Bool { json["offline"] == .bool(true) }
  public var deviceId: String { json["deviceId"]?.string ?? "" }
  public var expectedTimer: String? { json["expectedTimer"]?.string }
  public var sessionId: String? { json["sessionId"]?.string }
  public var patches: [JSON] { json["patches"]?.array ?? [] }
  public var command: Command? { json["command"].flatMap { try? Command(json: $0) } }
}

/// 기기 저장소의 한 계정 데이터: 확정 문서, cursor, 미전송 작업, 충돌
public struct Envelope: Equatable, Sendable {
  public var owner: String?
  public var deviceId: String
  public var enabled = false
  public var initialized = false
  public var epoch: String?
  public var cursor = "0"
  public var confirmed: SyncDocument
  public var pending: [SyncOperation] = []
  public var conflicts: [JSON] = []
  public var localSettings: [String: JSON]
  public var backup: JSON?
  public var localEvidence: [String: JSON]?

  public init(state: AppState, owner: String? = nil, deviceId: String = IDs.make()) throws {
    self.owner = owner
    self.deviceId = deviceId
    self.confirmed = try SyncDocument(state: state)
    self.localSettings = ["trayDisplay": .string(state.settings.trayDisplay ?? "clock")]
  }

  public var json: JSON {
    var object: [String: JSON] = [
      "version": .number(Double(SyncProtocol.version)), "owner": .optional(owner), "deviceId": .string(deviceId),
      "enabled": .bool(enabled), "initialized": .bool(initialized), "epoch": .optional(epoch),
      "cursor": .string(cursor), "confirmed": confirmed.json, "pending": .array(pending.map { .object($0.json) }),
      "conflicts": .array(conflicts), "localSettings": .object(localSettings), "backup": backup ?? .null,
    ]
    if let localEvidence { object["localEvidence"] = .object(localEvidence) }
    return .object(object)
  }

  public init(json raw: JSON) throws {
    guard let o = raw.object, o["version"] == .number(Double(SyncProtocol.version)),
      let deviceId = o["deviceId"]?.string, let cursor = o["cursor"]?.string, let confirmed = o["confirmed"]
    else { throw DomainError("지원하지 않는 동기화 데이터입니다.") }
    self.owner = o["owner"]?.string
    self.deviceId = deviceId
    self.enabled = o["enabled"] == .bool(true)
    self.initialized = o["initialized"] == .bool(true)
    self.epoch = o["epoch"]?.string
    self.cursor = cursor
    self.confirmed = try SyncDocument(validating: confirmed)
    self.pending = (o["pending"]?.array ?? []).compactMap { $0.object.map(SyncOperation.init(json:)) }
    self.conflicts = o["conflicts"]?.array ?? []
    self.localSettings = o["localSettings"]?.object ?? [:]
    self.backup = JSON.absent(o["backup"]) ? nil : o["backup"]
    self.localEvidence = o["localEvidence"]?.object
  }
}

// MARK: 행 비교와 적용

extension SyncProtocol {
  static func rows(_ state: AppState, _ key: String) -> [JSON] {
    switch key {
    case "projects": state.projects.map(\.json)
    case "tasks": state.tasks.map(\.json)
    case "records": state.records.map(\.json)
    case "tickets": state.tickets.map(\.json)
    case "templates": state.templates.map(\.json)
    default: []
    }
  }

  public static func diffRows(_ before: [JSON], _ after: [JSON], entity: String) -> [JSON] {
    var old: [String: [String: JSON]] = [:]
    for row in before { if let id = row["id"]?.string, let o = row.object { old[id] = o } }
    let ids = Set(after.compactMap { $0["id"]?.string })
    var patches: [JSON] = before.compactMap { row in
      guard let id = row["id"]?.string, !ids.contains(id) else { return nil }
      return ["entity": .string(entity), "id": .string(id), "delete": true]
    }
    for row in after {
      guard let id = row["id"]?.string, let object = row.object else { continue }
      let previous = old[id]
      let fields = object.filter { key, value in key != "id" && previous?[key] != value }
      if previous == nil || !fields.isEmpty {
        patches.append(["entity": .string(entity), "id": .string(id), "fields": .object(fields), "create": .bool(previous == nil)])
      }
    }
    return patches
  }

  public static func patchesBetween(_ before: AppState, _ after: AppState) -> [JSON] {
    var patches = collections.flatMap { diffRows(rows(before, $0), rows(after, $0), entity: $0) }
    let old = before.settings.json.object ?? [:]
    let fields = (after.settings.json.object ?? [:]).filter { key, value in key != "trayDisplay" && old[key] != value }
    if !fields.isEmpty { patches.append(["entity": "settings", "id": "settings", "fields": .object(fields)]) }
    return patches
  }

  /// 문서를 JSON으로 바꿔 수정한 뒤 다시 검증한다.
  struct Draft {
    var o: [String: JSON]

    init(_ doc: SyncDocument) { o = doc.json.object ?? [:] }

    func rows(_ entity: String) -> [JSON] {
      let root = SyncProtocol.collections.contains(entity) ? "state" : "extras"
      return o[root]?[entity]?.array ?? []
    }

    mutating func setRows(_ entity: String, _ rows: [JSON]) {
      let root = SyncProtocol.collections.contains(entity) ? "state" : "extras"
      var container = o[root]?.object ?? [:]
      container[entity] = .array(rows)
      o[root] = .object(container)
    }

    var tombstones: [String: JSON] {
      get { o["tombstones"]?.object ?? [:] }
      set { o["tombstones"] = .object(newValue) }
    }

    func document() throws -> SyncDocument { try SyncDocument(validating: .object(o)) }
  }

  static func applyPatches(_ draft: inout Draft, _ patches: [JSON]) throws {
    for patch in patches {
      guard let entity = patch["entity"]?.string, let id = patch["id"]?.string else {
        throw DomainError("지원하지 않는 동기화 항목입니다.")
      }
      if entity == "settings" {
        var state = draft.o["state"]?.object ?? [:]
        var settings = state["settings"]?.object ?? [:]
        for (key, value) in patch["fields"]?.object ?? [:] { settings[key] = value }
        state["settings"] = .object(settings)
        draft.o["state"] = .object(state)
        continue
      }
      guard (collections + extras).contains(entity) else { throw DomainError("지원하지 않는 동기화 항목입니다.") }
      let key = "\(entity):\(id)"
      var rows = draft.rows(entity)
      if patch["delete"] == .bool(true) {
        rows.removeAll { $0["id"]?.string == id }
        draft.setRows(entity, rows)
        draft.tombstones[key] = true
        continue
      }
      if Domain.isTruthy(draft.tombstones[key]) { continue }
      let fields = patch["fields"]?.object ?? [:]
      if let index = rows.firstIndex(where: { $0["id"]?.string == id }) {
        var row = rows[index].object ?? [:]
        if entity == "deliveries", Domain.isTruthy(row["assetId"]), Domain.isTruthy(fields["assetId"]) {
          if Domain.isTruthy(fields["seen"]) { row["seen"] = true }
        } else {
          for (k, v) in fields { row[k] = v }
        }
        rows[index] = .object(row)
      } else if patch["create"] == .bool(true) {
        var row = fields
        row["id"] = .string(id)
        rows.append(.object(row))
      }
      draft.setRows(entity, rows)
    }
    // A stale field patch cannot reattach a task to a deleted project.
    let projects = Set(draft.rows("projects").compactMap { $0["id"]?.string })
    let tasks = draft.rows("tasks").map { row -> JSON in
      guard var o = row.object, let project = o["project"]?.string, !project.isEmpty, !projects.contains(project) else {
        return row
      }
      o["project"] = ""
      return .object(o)
    }
    draft.setRows("tasks", tasks)
  }

  static func deterministicIds(_ before: AppState, _ next: inout AppState, operationId: String, sessionId: String?) {
    func rename(_ key: String, _ old: Set<String>, _ id: String, _ index: inout Int) -> String {
      guard !old.contains(id) else { return id }
      defer { index += 1 }
      return key == "records" ? "focus:\(sessionId ?? operationId)" : "\(key):\(operationId):\(index)"
    }
    var index = 0
    var old = Set(before.projects.map(\.id))
    for i in next.projects.indices { next.projects[i].id = rename("projects", old, next.projects[i].id, &index) }
    index = 0
    old = Set(before.tasks.map(\.id))
    for i in next.tasks.indices { next.tasks[i].id = rename("tasks", old, next.tasks[i].id, &index) }
    index = 0
    old = Set(before.records.map(\.id))
    for i in next.records.indices { next.records[i].id = rename("records", old, next.records[i].id, &index) }
    index = 0
    old = Set(before.tickets.map(\.id))
    for i in next.tickets.indices { next.tickets[i].id = rename("tickets", old, next.tickets[i].id, &index) }
    index = 0
    old = Set(before.templates.map(\.id))
    for i in next.templates.indices { next.templates[i].id = rename("templates", old, next.templates[i].id, &index) }
  }

  static func deadline(_ timer: TimerState) -> Double {
    timer.startedAt + (timer.duration - timer.elapsed) * 1000
  }

  // MARK: 작업 적용

  public static func reduceOperation(
    _ input: SyncDocument, _ operation: SyncOperation, serverNow: Double? = nil, optimistic: Bool = false
  ) throws -> (document: SyncDocument, conflict: Bool) {
    let serverNow = serverNow ?? operation.at
    var doc = input
    var draft: Draft
    if operation.kind == "patch" {
      if let timer = doc.state.timer,
        operation.patches.contains(where: {
          $0["entity"] == "tasks" && $0["id"]?.string == timer.taskId
            && ($0["delete"] == .bool(true) || $0["fields"]?["done"] == .bool(true))
        })
      {
        let end = timer.running ? min(serverNow, deadline(timer)) : serverNow
        if let record = Domain.settleTimer(&doc.state, end), let index = doc.state.records.firstIndex(of: record) {
          doc.state.records[index].id = "focus:\(doc.timer.sessionId ?? "null")"
        }
        doc.timer = TimerMeta(sessionId: nil, revision: operation.id, controller: operation.deviceId)
      }
      draft = Draft(doc)
      try applyPatches(&draft, operation.patches)
    } else if operation.kind == "command" {
      guard let command = operation.command, sharedCommands.contains(command.type) else {
        throw DomainError("지원하지 않는 동기화 명령입니다.")
      }
      let guarded =
        command.type.hasPrefix("timer:") || command.type.hasPrefix("checkin:")
        || (["task:delete", "task:toggle"].contains(command.type)
          && doc.state.timer?.taskId != nil && .string(doc.state.timer!.taskId!) == command.payload["id"])
      if !optimistic, guarded,
        operation.expectedTimer != doc.timer.revision || operation.sessionId != doc.timer.sessionId
      {
        let settled =
          ["timer:end", "timer:advance"].contains(command.type)
          && doc.state.records.contains { $0.id == "focus:\(operation.sessionId ?? "null")" }
        return (doc, !settled)
      }
      var at = operation.offline ? min(operation.at, serverNow) : serverNow
      if let timer = doc.state.timer { at = max(at, timer.startedAt) }
      let before = doc.state
      var next: AppState
      if command.type == "timer:adopt" {
        next = before
        if let timer = next.timer, timer.running, Domain.elapsedSeconds(timer, at) >= timer.duration {
          Domain.advanceTimer(&next, deadline(timer))
        }
        Domain.settleTimer(&next, at)
        var raw = next.json.object ?? [:]
        raw["timer"] = command.payload["timer"] ?? .null
        guard var desired = try Domain.normalizeState(.object(raw)).timer else {
          throw DomainError("타이머 상태가 올바르지 않습니다.")
        }
        desired.elapsed = Domain.elapsedSeconds(desired, at)
        desired.startedAt = at
        next.timer = desired
      } else if command.type == "timer:advance" {
        next = before
        if let timer = next.timer, timer.running, Domain.elapsedSeconds(timer, at) >= timer.duration {
          at = deadline(timer)
          Domain.advanceTimer(&next, at)
        }
      } else {
        // Mirror the existing completion-before-command behavior, using the actual deadline.
        var prepared = before
        if let timer = prepared.timer, timer.running, Domain.elapsedSeconds(timer, at) >= timer.duration {
          Domain.advanceTimer(&prepared, deadline(timer))
        }
        next = try Domain.applyCommand(prepared, command, now: at, advance: false)
      }
      deterministicIds(before, &next, operationId: operation.id, sessionId: doc.timer.sessionId)
      doc.state = next
      for entity in collections {
        let remaining = Set(rows(next, entity).compactMap { $0["id"]?.string })
        for row in rows(before, entity) {
          if let id = row["id"]?.string, !remaining.contains(id) { doc.tombstones["\(entity):\(id)"] = true }
        }
      }
      if before.timer != next.timer {
        let newSession =
          next.timer != nil
          && (command.type == "timer:adopt" || before.timer == nil || before.timer?.taskId != next.timer?.taskId
            || (before.timer?.phase != next.timer?.phase && next.timer?.phase != .checkin))
        doc.timer = TimerMeta(
          sessionId: next.timer == nil ? nil : newSession ? operation.id : doc.timer.sessionId ?? operation.id,
          revision: operation.id,
          controller: command.type == "timer:advance" ? doc.timer.controller : operation.deviceId)
      }
      draft = Draft(doc)
    } else {
      throw DomainError("지원하지 않는 동기화 명령입니다.")
    }
    // 더 이상 참조하지 않는 파일 asset은 삭제 표식을 남긴다.
    func references(_ d: Draft) -> Set<String> {
      var ids = d.rows("projects").compactMap { $0["image"]?.string }
      ids += d.rows("clips").flatMap { [$0["assetId"]?.string, $0["thumbnailId"]?.string].compactMap { $0 } }
      ids += d.rows("deliveries").compactMap { $0["assetId"]?.string }
      return Set(ids.filter { !$0.isEmpty })
    }
    let oldRefs = references(Draft(input))
    let newRefs = references(draft)
    for id in oldRefs where !newRefs.contains(id) {
      draft.setRows("assets", draft.rows("assets").filter { $0["id"]?.string != id })
      draft.tombstones["assets:\(id)"] = true
    }
    return (try draft.document(), false)
  }

  public static func projectedDocument(_ envelope: Envelope) -> SyncDocument {
    var doc = envelope.confirmed
    for operation in envelope.pending {
      // Preserved for conflict resolution after server acknowledgement.
      if let next = try? reduceOperation(doc, operation, serverNow: operation.at, optimistic: true).document {
        doc = next
      }
    }
    return doc
  }

  public static func projectedState(_ envelope: Envelope) -> AppState {
    var state = projectedDocument(envelope).state
    state.settings.trayDisplay = envelope.localSettings["trayDisplay"]?.string ?? "clock"
    return state
  }

  static func base(_ envelope: Envelope, _ doc: SyncDocument, at: Double, offline: Bool) -> [String: JSON] {
    ["id": .string(IDs.make()), "deviceId": .string(envelope.deviceId), "version": .number(Double(version)),
     "at": .number(at), "offline": .bool(offline), "expectedTimer": .string(doc.timer.revision),
     "sessionId": .optional(doc.timer.sessionId), "baseCursor": .string(envelope.cursor)]
  }

  public static func prepareOperation(_ envelope: Envelope, _ command: Command, at: Double, offline: Bool = false) throws
    -> SyncOperation
  {
    let doc = projectedDocument(envelope)
    var json = base(envelope, doc, at: at, offline: offline)
    if sharedCommands.contains(command.type) {
      json["kind"] = "command"
      json["command"] = command.json
      let operation = SyncOperation(json: json)
      _ = try reduceOperation(doc, operation, serverNow: at, optimistic: true)  // validate before committing the queue
      return operation
    }
    let next = try Domain.applyCommand(try Domain.normalizeState(doc.state.json), command, now: at, advance: false)
    json["kind"] = "patch"
    json["patches"] = .array(patchesBetween(doc.state, next))
    return SyncOperation(json: json)
  }

  public static func importOperation(_ envelope: Envelope, _ raw: JSON, at: Double) throws -> SyncOperation {
    let incoming = try Domain.normalizeState(raw)
    let doc = projectedDocument(envelope)
    var merged = doc.state
    func merge<Row: Identifiable>(_ current: [Row], _ rows: [Row]) -> [Row] where Row.ID == String {
      var result = current
      for row in rows {
        if let index = result.firstIndex(where: { $0.id == row.id }) { result[index] = row } else { result.append(row) }
      }
      return result
    }
    merged.projects = merge(merged.projects, incoming.projects)
    merged.tasks = merge(merged.tasks, incoming.tasks)
    merged.records = merge(merged.records, incoming.records)
    merged.tickets = merge(merged.tickets, incoming.tickets)
    merged.templates = merge(merged.templates, incoming.templates)
    merged.settings = incoming.settings
    // Imports never replace the active shared timer or delete omitted rows.
    return SyncOperation(json: [
      "id": .string(IDs.make()), "deviceId": .string(envelope.deviceId), "version": .number(Double(version)),
      "at": .number(at), "kind": "patch", "patches": .array(patchesBetween(doc.state, merged)),
      "baseCursor": .string(envelope.cursor),
    ])
  }

  public static func extraOperation(
    _ envelope: Envelope, entity: String, id: String, fields: [String: JSON], deleted: Bool = false, at: Double
  ) throws -> SyncOperation {
    guard extras.contains(entity), !id.isEmpty, Check.jsLength(id) <= 160 else {
      throw DomainError("잘못된 동기화 항목입니다.")
    }
    var data = fields
    data["id"] = nil
    return SyncOperation(json: [
      "id": .string(IDs.make()), "deviceId": .string(envelope.deviceId), "version": .number(Double(version)),
      "at": .number(at), "kind": "patch", "baseCursor": .string(envelope.cursor),
      "patches": [["entity": .string(entity), "id": .string(id), "fields": .object(data), "create": true, "delete": .bool(deleted)]],
    ])
  }

  public static func applyServerChanges(_ input: SyncDocument, _ changes: [JSON], cursor: String) throws -> SyncDocument {
    var doc = input
    guard var previous = Int64(cursor) else { throw DomainError("동기화 변경이 누락되었습니다.") }
    for change in changes {
      guard let value = change["cursor"]?.string, let current = Int64(value), current == previous + 1,
        let delta = change["delta"]?.object
      else { throw DomainError("동기화 변경이 누락되었습니다.") }
      var draft = Draft(doc)
      try applyPatches(&draft, delta["patches"]?.array ?? [])
      for (entity, order) in delta["orders"]?.object ?? [:] {
        guard (collections + extras).contains(entity), let ids = order.array?.compactMap(\.string),
          ids.count == order.array?.count
        else { throw DomainError("잘못된 동기화 데이터입니다.") }
        var map: [String: JSON] = [:]
        for row in draft.rows(entity) { if let id = row["id"]?.string { map[id] = row } }
        guard ids.count == map.count, Set(ids).count == ids.count, ids.allSatisfy({ map[$0] != nil }) else {
          throw DomainError("잘못된 동기화 순서입니다.")
        }
        draft.setRows(entity, ids.map { map[$0]! })
      }
      draft.o["timer"] = delta["timer"] ?? .null
      var state = draft.o["state"]?.object ?? [:]
      state["timer"] = delta["timerState"] ?? .null
      draft.o["state"] = .object(state)
      draft.o["timeZone"] = delta["timeZone"] ?? .null
      draft.o["tombstones"] = delta["tombstones"] ?? .null
      doc = try draft.document()
      previous = current
    }
    return doc
  }
}
