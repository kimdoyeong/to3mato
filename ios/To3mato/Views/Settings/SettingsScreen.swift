import SwiftUI
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
        SettingsCard(title: "계정") {
          Text("연동하면 다른 기기와 동기화되어 사용하실 수 있습니다.").cardText()
          AuthForm()
        }

        SettingsCard(title: "알림") {
          TimeRow(label: "계획 시각", value: $model.settings.planAt)
          TimeRow(label: "돌아보기 시각", value: $model.settings.reviewAt)
          WeekdayPicker(value: $model.settings.remindDays)
          Button("돌아보기") { model.reviewOpen = true }
            .buttonStyle(LineButtonStyle())
        }

        SettingsCard(title: "포모도로 설정") {
          Text("변경한 시간은 다음 포모도로부터 적용됩니다.").cardText()
          MenuRow(label: "집중 시간", value: $model.settings.focus, options: [(900, "15분"), (1500, "25분"), (3000, "50분")])
          MenuRow(label: "휴식 시간", value: $model.settings.rest, options: [(300, "5분"), (600, "10분")])
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
    .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { _ in }
    .fileExporter(
      isPresented: $exporting, document: JSONDocument(), contentType: .json, defaultFilename: "to3mato"
    ) { _ in }
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
  init() {}
  init(configuration: ReadConfiguration) throws {}
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: Data("{}".utf8))
  }
}

/// 이메일 로그인 링크
struct AuthForm: View {
  @State private var email = ""
  @State private var sent = false

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
          .onChange(of: email) { sent = false }
        Button("로그인 링크 받기") { sent = true }
          .buttonStyle(LineButtonStyle())
          .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty)
      }
      if sent {
        Text("로그인 링크를 보냈습니다. 이 컴퓨터에서 메일의 링크를 여세요.").cardText()
      }
    }
  }
}
