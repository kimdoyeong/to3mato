import Foundation

/// Mac의 calendar-time.mjs. 날짜만 있는 계획은 `YYYY-MM-DD`로 다룬다.
public enum CalendarTime {
  /// 계정의 시간대. 없으면 기기 시간대를 쓴다.
  nonisolated(unsafe) public static var zone: TimeZone?

  public static func setZone(_ identifier: String?) throws {
    guard let identifier, !identifier.isEmpty else {
      zone = nil
      return
    }
    guard let value = TimeZone(identifier: identifier) else {
      throw DomainError("지원하지 않는 동기화 데이터입니다.")
    }
    zone = value
  }

  public static func dateInZone(_ date: Date = .now, _ timeZone: TimeZone? = nil) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone ?? zone ?? .current
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  /// `YYYY-MM-DD` 문자열을 offset일만큼 옮긴다.
  public static func shiftDay(_ day: String, _ offset: Int) -> String {
    guard let date = utcNoon(day) else { return day }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let shifted = calendar.date(byAdding: .day, value: offset, to: date) ?? date
    return dateInZone(shifted, TimeZone(identifier: "UTC"))
  }

  /// 해당 날짜의 정오(UTC). 형식이 맞지 않으면 nil
  public static func utcNoon(_ day: String) -> Date? {
    let parts = day.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3, day.count == 10 else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
  }

  /// 해당 시간대에서 day의 hour:minute 시각
  public static func at(_ day: String, hour: Int = 0, minute: Int = 0, _ timeZone: TimeZone? = nil) -> Date? {
    let parts = day.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone ?? zone ?? .current
    return calendar.date(
      from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: hour, minute: minute))
  }
}
