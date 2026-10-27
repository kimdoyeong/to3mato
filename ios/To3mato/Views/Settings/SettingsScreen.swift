import SwiftUI
import To3matoCore
import UniformTypeIdentifiers

/// 설정: 계정, 알림, 포모도로 설정, 최근 집중 기록, 로컬 데이터
struct SettingsScreen: View {
  @Environment(AppModel.self) private var model
  @State private var importing = false
  @State private var exporting = false

  var body: some View {
    @Bindable var model = model
    ScrollView {
      VStack(spacing: 22) {
        AccountCard()

        SettingsCard(title: "알림") {
          TimeRow(label: "계획 시각", value: Binding(get: { model.timeSetting("planAt") }, set: { model.setTimeSetting("planAt", $0) }))
          TimeRow(label: "돌아보기 시각", value: Binding(get: { model.timeSetting("reviewAt") }, set: { model.setTimeSetting("reviewAt", $0) }))
          WeekdayPicker(value: $model.remindDays)
          Button("돌아보기") { model.reviewOpen = true }
            .buttonStyle(LineButtonStyle())
        }

        SettingsCard(title: "포모도로 설정") {
          Text("변경한 시간은 다음 포모도로부터 적용됩니다.").cardText()
          MenuRow(label: "집중 시간", value: duration("focus"), options: [(900, "15분"), (1500, "25분"), (3000, "50분")])
          MenuRow(label: "휴식 시간", value: duration("rest"), options: [(300, "5분"), (600, "10분")])
        }

        SettingsCard(title: "최근 집중 기록") {
          Text("작업 전환 시 0 / 0.5 / 1포모도로로 반올림합니다.").cardText()
          if model.records.isEmpty {
            Text("집중 기록이 없습니다.").cardText()
          }
          ForEach(model.records.suffix(10).reversed()) { record in
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text(model.tasks.first { $0.id == record.taskId }?.title ?? "삭제된 할 일")
                  .font(.hand(TextSize.base))
                  .foregroundStyle(Palette.ink)
                Text("실제 \(Int(record.seconds) / 60)분 \(Int(record.seconds) % 60)초")
                  .font(.hand(TextSize.xs))
                  .foregroundStyle(Palette.muted)
              }
              Spacer()
              PomoCount(value: record.pomodoros.pomodoroText)
            }
            .padding(.vertical, 4)
          }
        }

        SettingsCard(title: "로컬 데이터") {
          HStack(spacing: 10) {
            Button("데이터 내보내기") { exporting = true }
            Button("데이터 가져오기") { importing = true }
          }
          .buttonStyle(SecondaryButtonStyle())
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 20)
    }
    .readableWidth()
    .background(DotBackground())
    .navigationTitle("설정")
    .navigationBarTitleDisplayMode(.inline)
    .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
      guard case .success(let url) = result else { return }
      let scoped = url.startAccessingSecurityScopedResource()
      defer { if scoped { url.stopAccessingSecurityScopedResource() } }
      guard let data = try? Data(contentsOf: url) else {
        model.notify("파일을 읽을 수 없습니다.")
        return
      }
      model.importData(data)
    }
    .fileExporter(
      isPresented: $exporting, document: JSONDocument(data: model.exportData()), contentType: .json,
      defaultFilename: "to3mato-\(model.today)"
    ) { result in
      model.notify((try? result.get()) != nil ? "데이터를 내보냈습니다." : "데이터를 내보낼 수 없습니다.")
    }
  }

  private func duration(_ key: String) -> Binding<Double> {
    Binding(
      get: { key == "focus" ? model.settings.focus : model.settings.rest },
      set: { value in
        model.send(Command("settings:save", [key: .number(value)]), success: "다음 포모도로부터 적용됩니다.")
      })
  }
}

/// 설정 카드: 종이 + 제목
struct SettingsCard<Content: View>: View {
  let title: String
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      DisplayText(title, size: TextSize.xl)
        .accessibilityAddTraits(.isHeader)
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(20)
    .paper()
  }
}

extension Text {
  func cardText() -> some View {
    font(.hand(TextSize.sm)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
  }
}

private struct TimeRow: View {
  let label: String
  @Binding var value: Date?

  var body: some View {
    HStack {
      Text(label).font(.hand(TextSize.base)).foregroundStyle(Palette.ink)
      Spacer()
      if let current = value {
        DatePicker(label, selection: Binding(get: { current }, set: { value = $0 }), displayedComponents: .hourAndMinute)
          .labelsHidden()
      }
      Toggle(
        label,
        isOn: Binding(
          get: { value != nil },
          set: { value = $0 ? Day.calendar.date(bySettingHour: 9, minute: 0, second: 0, of: .now) : nil })
      )
      .labelsHidden()
      .tint(Palette.leaf)
    }
  }
}

private struct MenuRow: View {
  let label: String
  @Binding var value: Double
  let options: [(Double, String)]

  var body: some View {
    HStack {
      Text(label).font(.hand(TextSize.base)).foregroundStyle(Palette.ink)
      Spacer()
      Picker(label, selection: $value) {
        ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
      }
      .pickerStyle(.menu)
      .tint(Palette.ink)
    }
  }
}

private struct JSONDocument: FileDocument {
  static let readableContentTypes: [UTType] = [.json]
  var data: Data
  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}

/// 계정: Mac의 AccountSettings와 같은 항목과 문구
private struct AccountCard: View {
  @Environment(AppModel.self) private var model
  @State private var confirmDelete = false

  var body: some View {
    let account = model.account
    SettingsCard(title: "계정") {
      if !account.configured {
        Text("이 실행 환경에서는 계정 기능을 사용할 수 없습니다.").cardText()
      } else {
        Text("연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.").cardText()
        if let user = account.user {
          Text(user.email ?? "").font(.hand(TextSize.base)).foregroundStyle(Palette.ink)
          FlowLayout(spacing: 8) {
            if account.enabled {
              Button("연동 해제") { model.disableSync() }
              Button("지금 동기화") { model.syncNow() }
            } else {
              Button("연동") { model.enableSync() }
            }
            Button("로그아웃") { model.logout() }
            Button("계정 삭제") { confirmDelete = true }
          }
          .buttonStyle(SecondaryButtonStyle())
          .disabled(account.busy)
          if account.pending > 0 {
            Text("전송 대기 \(account.pending)").cardText()
          }
          ForEach(account.conflicts.filter { $0["archived"] != .bool(true) }, id: \.self) { conflict in
            let id = conflict["id"]?.string ?? ""
            let initial = conflict["reason"] == "initial-timer"
            HStack(spacing: 8) {
              Text(initial ? "연동 전 타이머" : "동기화 충돌").font(.hand(TextSize.sm)).foregroundStyle(Palette.ink)
              Spacer(minLength: 0)
              if initial {
                Button("타이머 적용") { model.resolve(id, action: "timer") }
              }
              Button("별도 보관") { model.resolve(id, action: "keep") }
            }
            .buttonStyle(SecondaryButtonStyle())
          }
        } else {
          AuthForm()
        }
      }
      if !account.error.isEmpty {
        Text(account.error).font(.hand(TextSize.sm)).foregroundStyle(Palette.redDeep)
      }
    }
    .confirmationDialog(
      "서버에 저장된 계정, 동기화 데이터와 파일을 삭제합니다. 이 기기에 저장된 데이터는 남습니다.",
      isPresented: $confirmDelete, titleVisibility: .visible
    ) {
      Button("계정 삭제", role: .destructive) { model.deleteAccount() }
      Button("취소", role: .cancel) {}
    }
  }
}

/// 이메일 로그인 링크
struct AuthForm: View {
  @Environment(AppModel.self) private var model
  @State private var email = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("이메일").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
      HStack(spacing: 8) {
        TextField("이메일", text: $email)
          .keyboardType(.emailAddress)
          .textContentType(.emailAddress)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .fieldBox()
          .onChange(of: email) {
            model.account.linkSent = false
            model.account.error = ""
          }
          .onSubmit { model.requestLink(email: email) }
        Button("로그인 링크 받기") { model.requestLink(email: email) }
          .buttonStyle(LineButtonStyle())
          .disabled(model.account.busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
      }
      if model.account.linkSent {
        Text("로그인 링크를 보냈습니다. 이 디바이스에서 메일의 링크를 여세요.").cardText()
      }
    }
  }
}
