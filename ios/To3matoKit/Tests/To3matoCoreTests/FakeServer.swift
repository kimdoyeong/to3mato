import Foundation

@testable import To3matoCore

/// supabase/migrations의 sync_pull·sync_push 규칙을 메모리에서 흉내 낸다. 엔진 시험용이다.
final class FakeServer: @unchecked Sendable {
  var epoch = "epoch-1"
  var revision: Int64 = 0
  var document: SyncDocument
  var changes: [(Int64, JSON)] = []
  var processed: [String: (operation: JSON, conflict: Bool, reason: String?)] = [:]
  var now: Double = 1_800_000_000_000
  var broadcast: () -> Void = {}

  init(timeZone: String = "Asia/Seoul") {
    document = try! SyncDocument(state: SyncProtocol.emptyState(), timeZone: timeZone)
  }

  /// sync_private.delta
  static func delta(_ old: SyncDocument, _ new: SyncDocument) -> JSON {
    let oldDraft = SyncProtocol.Draft(old)
    let newDraft = SyncProtocol.Draft(new)
    var patches: [JSON] = []
    var orders: [String: JSON] = [:]
    for k in SyncProtocol.collections + SyncProtocol.extras {
      let before = oldDraft.rows(k)
      let after = newDraft.rows(k)
      for r in after {
        let previous = before.first { $0["id"] == r["id"] }
        if previous != r {
          var fields = r.object ?? [:]
          fields["id"] = nil
          patches.append(["entity": .string(k), "id": r["id"] ?? .null, "fields": .object(fields), "create": true])
        }
      }
      for r in before where !after.contains(where: { $0["id"] == r["id"] }) {
        patches.append(["entity": .string(k), "id": r["id"] ?? .null, "delete": true])
      }
      if before != after { orders[k] = .array(after.map { $0["id"] ?? .null }) }
    }
    if old.state.settings != new.state.settings {
      patches.append(["entity": "settings", "id": "settings", "fields": new.state.settings.json])
    }
    return [
      "patches": .array(patches), "orders": .object(orders), "timer": new.timer.json,
      "timerState": new.state.timer?.json ?? .null, "timeZone": .string(new.timeZone),
      "tombstones": .object(new.tombstones),
    ]
  }

  func pull(epoch requested: String?, cursor: String) -> JSON {
    var result: [String: JSON] = [
      "version": 1, "epoch": .string(epoch), "cursor": .string(String(revision)), "serverNow": .number(now),
    ]
    let value = Int64(cursor) ?? 0
    if requested != epoch || value == 0 || value > revision {
      result["document"] = document.json
      return .object(result)
    }
    let slice = changes.filter { $0.0 > value }.prefix(100)
    let last = slice.last?.0 ?? value
    result["changes"] = .array(slice.map { ["cursor": .string(String($0.0)), "delta": $0.1] })
    result["cursor"] = .string(String(last))
    result["hasMore"] = .bool(last < revision)
    return .object(result)
  }

  func push(_ operation: JSON, epoch requested: String) throws -> JSON {
    guard requested == epoch else { throw DomainError("sync epoch changed") }
    let id = operation["id"]?.string ?? ""
    var conflict = false
    var reason: String?
    if let previous = processed[id] {
      guard previous.operation == operation else { throw DomainError("operation id reused") }
      conflict = previous.conflict
      reason = previous.reason
    } else {
      do {
        let result = try SyncProtocol.reduceOperation(
          document, SyncOperation(json: operation.object ?? [:]), serverNow: now)
        conflict = result.conflict
        reason = conflict ? "timer" : nil
        if !conflict {
          revision += 1
          changes.append((revision, Self.delta(document, result.document)))
          document = result.document
          broadcast()
        }
      } catch {
        conflict = true
        reason = "data"
      }
      processed[id] = (operation, conflict, reason)
    }
    return [
      "version": 1, "epoch": .string(epoch), "cursor": .string(String(revision)), "document": document.json,
      "conflict": .bool(conflict), "reason": .optional(reason), "serverNow": .number(now),
    ]
  }
}
