import Foundation
import Supabase
import To3matoCore

// Mac의 electron/auth.mjs, src/lib/sync/transport.mjs. 문구는 Mac과 같다.

/// 앱에 넣는 공개 연결 정보. publishable key만 허용한다.
public struct CloudConfig: Sendable, Equatable {
  public let url: URL
  public let key: String

  /// 둘 다 없으면 계정 기능을 쓰지 않는다(nil).
  public static func make(url: String?, key: String?) throws -> CloudConfig? {
    let url = url?.trimmingCharacters(in: .whitespaces) ?? ""
    let key = key?.trimmingCharacters(in: .whitespaces) ?? ""
    if url.isEmpty && key.isEmpty { return nil }
    guard !url.isEmpty, !key.isEmpty else { throw DomainError("Supabase 연결 설정이 없습니다.") }
    guard let parsed = URLComponents(string: url), let host = parsed.host, parsed.user == nil, parsed.password == nil,
      parsed.query == nil, parsed.fragment == nil, parsed.path.isEmpty || parsed.path == "/",
      (parsed.scheme == "https" && host.hasSuffix(".supabase.co")) || (parsed.scheme == "http" && host == "127.0.0.1"),
      let origin = URL(string: "\(parsed.scheme!)://\(host)\(parsed.port.map { ":\($0)" } ?? "")")
    else { throw DomainError("Supabase 주소가 올바르지 않습니다.") }
    guard key.range(of: "^sb_publishable_[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
      throw DomainError("Supabase 공개 키가 올바르지 않습니다.")
    }
    return CloudConfig(url: origin, key: key)
  }
}

public struct AccountUser: Equatable, Sendable {
  public let id: String
  public let email: String?
}

/// Supabase 인증. 세션 토큰은 Keychain에 둔다(supabase-swift 기본 저장소).
public final class CloudAccount: @unchecked Sendable {
  public static let callback = URL(string: "to3mato://auth/callback")!
  static let linkInvalid = "로그인 링크가 올바르지 않거나 만료되었습니다. 다시 요청하세요."

  public let client: SupabaseClient

  public init(config: CloudConfig) {
    client = SupabaseClient(
      supabaseURL: config.url, supabaseKey: config.key,
      options: SupabaseClientOptions(
        auth: .init(redirectToURL: Self.callback, storageKey: "to3mato-auth", flowType: .pkce, autoRefreshToken: true)))
  }

  public var user: AccountUser? {
    client.auth.currentUser.map { AccountUser(id: $0.id.uuidString.lowercased(), email: $0.email) }
  }

  /// 저장된 세션을 확인하고 필요하면 갱신한다.
  public func restore() async -> AccountUser? {
    guard let session = try? await client.auth.session else { return nil }
    return AccountUser(id: session.user.id.uuidString.lowercased(), email: session.user.email)
  }

  public var changes: AsyncStream<AccountUser?> {
    AsyncStream { continuation in
      let task = Task {
        for await (_, session) in client.auth.authStateChanges {
          continuation.yield(session.map { AccountUser(id: $0.user.id.uuidString.lowercased(), email: $0.user.email) })
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// 로그인 링크를 메일로 보낸다. 처음 쓰는 주소는 링크를 열 때 계정이 만들어진다.
  public func requestLink(email: String) async throws {
    guard Check.jsLength(email) <= 254,
      email.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    else { throw DomainError("이메일 주소를 확인하세요.") }
    do {
      try await client.auth.signInWithOTP(email: email, redirectTo: Self.callback, shouldCreateUser: true)
    } catch {
      throw Self.status(error) == 429
        ? DomainError("요청이 너무 많습니다. 잠시 후 다시 시도하세요.")
        : DomainError("로그인 링크를 보내지 못했습니다. 잠시 후 다시 시도하세요.")
    }
  }

  /// 메일의 로그인 링크로 앱이 열렸을 때 세션을 받는다.
  public func open(_ url: URL) async throws -> AccountUser {
    do {
      let session = try await client.auth.session(from: url)
      return AccountUser(id: session.user.id.uuidString.lowercased(), email: session.user.email)
    } catch {
      throw DomainError(Self.linkInvalid)
    }
  }

  public func logout() async {
    try? await client.auth.signOut(scope: .local)
  }

  /// 서버의 계정, 동기화 데이터와 파일을 삭제한다.
  public func deleteAccount() async throws {
    struct Result: Decodable { let deleted: Bool? }
    do {
      let result: Result = try await client.functions.invoke(
        "delete-account", options: FunctionInvokeOptions(body: [String: String]()))
      guard result.deleted == true else { throw DomainError("") }
    } catch {
      throw DomainError("계정을 삭제하지 못했습니다. 다시 시도하세요.")
    }
  }

  public func transport(userId: String) -> SyncTransport {
    SupabaseTransport(client: client, userId: userId)
  }

  static func status(_ error: Error) -> Int? {
    if let error = error as? AuthError, case .api(_, _, _, let response) = error { return response.statusCode }
    if let error = error as? HTTPError { return error.response.statusCode }
    return nil
  }
}

/// sync_pull·sync_push RPC와 계정별 비공개 Realtime 채널
final class SupabaseTransport: SyncTransport, @unchecked Sendable {
  let client: SupabaseClient
  let userId: String

  init(client: SupabaseClient, userId: String) {
    self.client = client
    self.userId = userId
  }

  private func call(_ function: String, _ params: JSON) async throws -> JSON {
    do {
      return try await client.rpc(function, params: params).execute().value
    } catch let error as PostgrestError where error.code == "PGRST301" || error.code == "42501" {
      throw SyncAuthRequired()
    } catch {
      if CloudAccount.status(error) == 401 { throw SyncAuthRequired() }
      throw error
    }
  }

  func pull(epoch: String?, cursor: String, deviceId: String, timeZone: String) async throws -> JSON {
    try await call(
      "sync_pull",
      ["p_epoch": .optional(epoch), "p_cursor": .string(cursor), "p_device": .string(deviceId),
       "p_timezone": .string(timeZone)])
  }

  func push(operation: JSON, epoch: String?) async throws -> JSON {
    try await call("sync_push", ["p_operation": operation, "p_epoch": .optional(epoch)])
  }

  func subscribe(
    onChange: @escaping @Sendable () -> Void, onConnection: @escaping @Sendable (Bool) -> Void
  ) async -> SyncSubscription {
    let realtime = client.realtimeV2
    await realtime.setAuth()
    let channel = realtime.channel("account:\(userId)") { $0.isPrivate = true }
    let changes = channel.broadcastStream(event: "changed")
    let status = channel.statusChange
    let listen = Task {
      for await _ in changes { onChange() }
    }
    let watch = Task {
      for await value in status { onConnection(value == .subscribed) }
    }
    let join = Task { try? await channel.subscribeWithError() }
    return Subscription(stop: {
      listen.cancel()
      watch.cancel()
      join.cancel()
      Task { await realtime.removeChannel(channel) }
    })
  }

  struct Subscription: SyncSubscription {
    let stop: @Sendable () -> Void
    func cancel() { stop() }
  }
}
