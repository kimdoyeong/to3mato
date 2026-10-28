import Foundation
import To3matoCore

/// Mac의 localDate, offsetDate, dateLabel과 같은 날짜 규칙
enum Day {
  /// 계정 시간대(없으면 기기 시간대). 연동 중에는 기기 시간대가 달라도 계정 날짜를 쓴다.
  static var zone: TimeZone { CalendarTime.zone ?? .current }

  static var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "ko_KR")
    calendar.firstWeekday = 2
    calendar.timeZone = zone
    return calendar
  }

  /// 계정 시간대(없으면 기기 시간대)의 날짜
  static func key(_ date: Date = .now) -> String { CalendarTime.dateInZone(date) }

  /// 그 날짜의 정오(계정 시간대)
  static func date(_ key: String) -> Date {
    CalendarTime.at(key, hour: 12) ?? .now
  }

  static func offset(_ days: Int, from key: String = Day.key()) -> String {
    CalendarTime.shiftDay(key, days)
  }

  static func format(_ date: Date, _ template: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.timeZone = zone
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
