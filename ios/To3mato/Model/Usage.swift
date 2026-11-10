import To3matoCore
import UIKit

extension Analytics {
  /// 앱의 사용 통계 창구. 키가 있는 릴리스 빌드에서만 기록하고 보낸다.
  @MainActor
  static func app() -> Analytics {
    #if DEBUG
      let debug = true
    #else
      let debug = false
    #endif
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    return Analytics(
      directory: AppPaths.root, key: AnalyticsConfig.key, host: AnalyticsConfig.host,
      active: AnalyticsConfig.active(debug: debug), transport: URLSessionAnalyticsTransport(),
      shared: [
        "$lib": "to3mato-ios", "$lib_version": .string(version), "app_version": .string(version), "$os": "iOS",
        "$os_version": .string(UIDevice.current.systemVersion),
        "$device_type": UIDevice.current.userInterfaceIdiom == .pad ? "Tablet" : "Mobile", "platform": "ios",
        "locale": .string(Locale.current.identifier(.bcp47)),
      ])
  }
}
