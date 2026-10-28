import SwiftUI
import To3matoCore

/// 시트 공통 틀: 위쪽 조작 줄은 유리(툴바), 내용은 종이
struct PaperSheet<Content: View>: View {
  let title: String
  @ViewBuilder var content: Content
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) { content }
          .padding(20)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(Palette.paper)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            dismiss()
          } label: {
            Image(systemName: "xmark")
          }
          .accessibilityLabel("닫기")
        }
      }
    }
    .presentationBackground(Palette.paper)
    .presentationDragIndicator(.visible)
  }
}

/// 할 일 수정
struct TaskEditorSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let task: TaskItem
  @State private var draft: TaskItem
  @State private var error = ""
  @State private var remainingTouched = false

  init(task: TaskItem) {
    self.task = task
    _draft = State(initialValue: task)
  }

  var body: some View {
    let used = model.used(task.id)
    PaperSheet(title: "할 일 수정") {
      TaskFields(draft: $draft, error: $error, locked: used > 0)

      if used > 0 {
        HStack(spacing: 10) {
          stat("처음 예상") { Text("\(task.estimate)") }
          stat("실제 사용") { Text(used.pomodoroText) }
          stat("남은 예상") {
            HStack(spacing: 8) {
              StepButton(symbol: "−", label: "남은 예상 줄이기") {
                draft.remaining -= 1
                remainingTouched = true
              }
              .disabled(draft.remaining <= 0)
              Text("\(draft.remaining)")
              StepButton(symbol: "+", label: "남은 예상 늘리기") {
                draft.remaining += 1
                remainingTouched = true
              }
              .disabled(draft.remaining >= max(2, task.estimate))
            }
          }
        }
      }

      if !error.isEmpty { FormError(text: error) }

      HStack {
        Button("삭제") {
          model.delete(task.id)
          dismiss()
        }
        .buttonStyle(TextButtonStyle())
        Spacer()
        Button("저장") {
          guard !draft.title.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "할 일 이름을 입력하세요."
            return
          }
          model.save(draft, remaining: remainingTouched ? draft.remaining : nil)
          dismiss()
        }
        .buttonStyle(PrimaryButtonStyle())
      }
      .padding(.top, 6)
    }
  }

  private func stat<Value: View>(_ label: String, @ViewBuilder value: () -> Value) -> some View {
    VStack(spacing: 6) {
      Text(label).font(.hand(TextSize.xs)).foregroundStyle(Palette.muted)
      value().font(.hand(TextSize.lg)).foregroundStyle(Palette.ink)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 10)
    .paper(.peach, radii: Wobble.s, flat: true)
  }
}

/// 할 일 이름, 예상 포모도로, 예정일, 프로젝트
struct TaskFields: View {
  @Environment(AppModel.self) private var model
  @Binding var draft: TaskItem
  @Binding var error: String
  var locked = false
  @FocusState private var titleFocused: Bool

  var body: some View {
    LabeledField(label: "할 일 이름") {
      TextField("예: 강의 수강 및 정리", text: $draft.title)
        .focused($titleFocused)
        .fieldBox()
        .onChange(of: draft.title) { error = "" }
    }
    .onAppear { if draft.title.isEmpty { titleFocused = true } }

    HStack(alignment: .top, spacing: 16) {
      LabeledField(label: "예상 포모도로") {
        HStack(spacing: 8) {
          EstimatePicker(value: draft.estimate, locked: locked) { draft.estimate = $0 }
          if locked {
            Label("처음 예상", systemImage: "lock")
              .font(.hand(TextSize.sm))
              .foregroundStyle(Palette.muted)
          }
        }
      }
      Spacer(minLength: 0)
      LabeledField(label: "예정일") {
        HStack(spacing: 6) {
          if draft.date.isEmpty {
            Button("미지정") { draft.date = model.today }
              .buttonStyle(LineButtonStyle())
          } else {
            DatePicker(
              "예정일",
              selection: Binding(get: { Day.date(draft.date) }, set: { draft.date = Day.key($0) }),
              displayedComponents: .date
            )
            .environment(\.timeZone, Day.zone)
            .labelsHidden()
            .environment(\.locale, Locale(identifier: "ko_KR"))
            Button {
              draft.date = ""
            } label: {
              Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.inkHint)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("미지정")
          }
        }
      }
    }

    LabeledField(label: "프로젝트") {
      Picker("프로젝트", selection: $draft.project) {
        Text("프로젝트 없음").tag("")
        ForEach(model.projects) { Text($0.name).tag($0.id) }
      }
      .pickerStyle(.menu)
      .tint(Palette.ink)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 4)
      .fieldBox()
    }
  }
}
