// swift-tools-version: 6.0
import PackageDescription

// To3matoCore: Mac의 domain.mjs, sync/protocol.mjs, sync/engine.mjs를 옮긴 플랫폼 무관 규칙.
// To3matoCloud: Supabase 인증, RPC, Realtime 연결.
let package = Package(
  name: "To3matoKit",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "To3matoCore", targets: ["To3matoCore"]),
    .library(name: "To3matoCloud", targets: ["To3matoCloud"]),
  ],
  dependencies: [
    .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.0.0")
  ],
  targets: [
    .target(name: "To3matoCore", swiftSettings: [.swiftLanguageMode(.v5)]),
    .target(
      name: "To3matoCloud",
      dependencies: ["To3matoCore", .product(name: "Supabase", package: "supabase-swift")],
      swiftSettings: [.swiftLanguageMode(.v5)]),
    .testTarget(
      name: "To3matoCoreTests", dependencies: ["To3matoCore"], exclude: ["Parity"],
      swiftSettings: [.swiftLanguageMode(.v5)]),
  ]
)
