import Foundation

/// Mac의 localDate, offsetDate, dateLabel과 같은 날짜 규칙
enum Day {
  static let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "ko_KR")
    calendar.firstWeekday = 2
    return calendar
  }()

  private static let keyFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }()

  static func key(_ date: Date = .now) -> String { keyFormatter.string(from: date) }

  static func date(_ key: String) -> Date {
    let day = keyFormatter.date(from: key) ?? .now
    return calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day) ?? day
  }

  static func offset(_ days: Int, from key: String = Day.key()) -> String {
    Day.key(calendar.date(byAdding: .day, value: days, to: date(key)) ?? .now)
  }

  static func format(_ date: Date, _ template: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.setLocalizedDateFormatFromTemplate(template)
    return formatter.string(from: date)
  }

  /// `10월 27일 화요일`
  static func label(_ key: String) -> String { format(date(key), "MMMMdEEEE") }

  /// `10월 27일 (화)`: 날짜 스티커
  static func sticker(_ date: Date = .now) -> String { format(date, "MMMMdEEE") }

  /// `10월 27일`
  static func short(_ date: Date) -> String { format(date, "MMMMd") }

  /// 월요일 0시
  static func weekStart(_ date: Date) -> Date {
    calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date
  }

  static let weekdayNames = ["월", "화", "수", "목", "금", "토", "일"]
  /// 월~일 순서의 요일 번호. 일요일은 0이다.
  static let weekdayIds = [1, 2, 3, 4, 5, 6, 0]
}
