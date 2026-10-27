import Foundation

/// 동기화 문서와 명령 payload를 Mac·서버와 같은 JSON 모양으로 다룬다.
public enum JSON: Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSON])
  case object([String: JSON])

  public subscript(key: String) -> JSON? {
    if case .object(let object) = self { return object[key] }
    return nil
  }

  public var string: String? { if case .string(let v) = self { v } else { nil } }
  public var number: Double? { if case .number(let v) = self { v } else { nil } }
  public var bool: Bool? { if case .bool(let v) = self { v } else { nil } }
  public var array: [JSON]? { if case .array(let v) = self { v } else { nil } }
  public var object: [String: JSON]? { if case .object(let v) = self { v } else { nil } }
  public var isNull: Bool { self == .null }

  /// JS의 `value === undefined || value === null`
  public static func absent(_ value: JSON?) -> Bool { value == nil || value == .null }

  public static func optional(_ value: String?) -> JSON { value.map(JSON.string) ?? .null }
  public static func optional(_ value: Double?) -> JSON { value.map(JSON.number) ?? .null }

  public func data() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(self)
  }

  public static func parse(_ data: Data) throws -> JSON {
    try JSONDecoder().decode(JSON.self, from: data)
  }
}

extension JSON: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSON].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: JSON].self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let v): try container.encode(v)
    case .number(let v):
      // 정수 값은 Mac(JS)처럼 소수점 없이 보낸다.
      if v.rounded() == v, abs(v) < 9_007_199_254_740_992 {
        try container.encode(Int64(v))
      } else {
        try container.encode(v)
      }
    case .string(let v): try container.encode(v)
    case .array(let v): try container.encode(v)
    case .object(let v): try container.encode(v)
    }
  }
}

extension JSON: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral,
  ExpressibleByBooleanLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral
{
  public init(stringLiteral value: String) { self = .string(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(arrayLiteral elements: JSON...) { self = .array(elements) }
  public init(dictionaryLiteral elements: (String, JSON)...) {
    self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
  }
  public init(nilLiteral: ()) { self = .null }
}

/// 사용자에게 그대로 보여주는 처리 실패 문구. Mac의 `throw new Error(...)`와 같다.
public struct DomainError: LocalizedError, Equatable, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// 새 ID. Mac의 `crypto.randomUUID()`와 같이 소문자 UUID다. 시험에서 바꿀 수 있다.
public enum IDs {
  nonisolated(unsafe) public static var make: () -> String = { UUID().uuidString.lowercased() }
}

/// 현재 시각(ms). Mac의 `Date.now()`
public func epochMilliseconds(_ date: Date = .now) -> Double {
  (date.timeIntervalSince1970 * 1000).rounded()
}
