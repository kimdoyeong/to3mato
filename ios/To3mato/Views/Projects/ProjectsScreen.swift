import PhotosUI
import SwiftUI
import To3matoCore

/// 프로젝트: 표지 이미지 종이 카드의 세로 목록
struct ProjectsScreen: View {
  @Environment(AppModel.self) private var model
  @State private var editor: ProjectEditor?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 26) {
          ForEach(Array(model.projects.enumerated()), id: \.element.id) { index, project in
            NavigationLink(value: project.id) {
              ProjectCard(project: project, index: index)
            }
            .buttonStyle(.plain)
          }
          Button {
            editor = ProjectEditor(project: nil)
          } label: {
            Label("프로젝트 추가", systemImage: "plus")
          }
          .buttonStyle(DashButtonStyle())
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
      }
      .readableWidth()
      .background(DotBackground())
      .navigationTitle("프로젝트")
      .navigationBarTitleDisplayMode(.inline)
      .navigationDestination(for: String.self) { id in
        ProjectDetailScreen(projectId: id, editor: $editor)
      }
    }
    .sheet(item: $editor) { ProjectEditorSheet(editor: $0) }
  }
}

struct ProjectEditor: Identifiable {
  let id = UUID()
  var project: Project?
}

private struct ProjectCard: View {
  @Environment(AppModel.self) private var model
  let project: Project
  let index: Int

  var body: some View {
    let summary = model.summary(project.id)
    VStack(alignment: .leading, spacing: 12) {
      ProjectCover(project: project)
        .frame(height: 130)
      HStack(spacing: 8) {
        Image(systemName: AppIcon.symbol(project.icon)).foregroundStyle(project.tint)
        DisplayText(project.name, size: TextSize.xl)
        Spacer(minLength: 0)
        HStack(spacing: -6) {
          ForEach(summary.recent) { _ in TomatoStamp(filled: true, size: 22) }
        }
        .accessibilityHidden(true)
      }
      if !project.outcome.isEmpty {
        HStack(spacing: 8) {
          Text("결과물").foregroundStyle(Palette.muted)
          Text(project.outcome).foregroundStyle(Palette.ink)
        }
        .font(.hand(TextSize.sm))
      }
      ProjectStats(summary: summary)
      HandBar(value: summary.progress, color: Palette.leaf)
        .accessibilityLabel("진행률 \(Int((summary.progress * 100).rounded()))%")
    }
    .padding(14)
    .paper(
      radii: index % 2 == 1 ? Wobble.b : Wobble.a,
      tilt: [Tilt.a, Tilt.b, Tilt.c][index % 3],
      tape: .center, tapeColor: [.pink, .yellow, .green][index % 3])
  }
}

/// 티켓, 남은 할 일, 실제 사용
struct ProjectStats: View {
  let summary: ProjectSummary

  var body: some View {
    HStack(spacing: 20) {
      stat("티켓") { Text("\(summary.tickets)") }
      stat("남은 할 일") { Text("\(summary.left)") }
      stat("실제 사용") { PomoCount(value: summary.used.pomodoroText, size: TextSize.lg) }
      Spacer(minLength: 0)
    }
  }

  private func stat<Value: View>(_ label: String, @ViewBuilder value: () -> Value) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(.hand(TextSize.xs)).foregroundStyle(Palette.muted)
      value().font(.hand(TextSize.lg)).foregroundStyle(Palette.ink)
    }
    .accessibilityElement(children: .combine)
  }
}

/// 표지: 사진 앱에서 고른 이미지 또는 기본 표지(아이콘 + 마스코트)
struct ProjectCover: View {
  @Environment(AppModel.self) private var model
  let project: Project
  @State private var pick: PhotosPickerItem?

  var body: some View {
    ZStack(alignment: .bottomTrailing) {
      Group {
        if let image = ProjectImages.image(named: project.image) {
          Image(uiImage: image).resizable().scaledToFill()
        } else {
          ZStack {
            project.tint.opacity(0.22).background(.white)
            Image(systemName: AppIcon.symbol(project.icon))
              .font(.system(size: 34))
              .foregroundStyle(project.tint)
            Mascot(size: 40)
              .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
              .padding(12)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .clipShape(WobbleShape(radii: Wobble.s))
      .accessibilityElement()
      .accessibilityLabel(project.image.isEmpty ? "\(project.name) 기본 표지" : "\(project.name) 표지 이미지")

      PhotosPicker(selection: $pick, matching: .images) {
        Text("이미지 변경")
          .font(.hand(TextSize.xs))
          .foregroundStyle(Palette.muted)
          .padding(.horizontal, 10)
          .padding(.vertical, 4)
          .background(.white.opacity(0.9), in: Capsule())
      }
      .padding(8)
    }
    .onChange(of: pick) { _, item in
      Task {
        if let data = try? await item?.loadTransferable(type: Data.self) {
          model.setImage(data, for: project.id)
        }
      }
    }
  }
}

/// 프로젝트 추가·수정
struct ProjectEditorSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let editor: ProjectEditor
  @State private var name = ""
  @State private var outcome = ""
  @State private var error = ""

  var body: some View {
    PaperSheet(title: editor.project == nil ? "프로젝트 추가" : "프로젝트 수정") {
      LabeledField(label: "프로젝트 이름") {
        TextField("프로젝트 이름", text: $name)
          .fieldBox()
          .onChange(of: name) { error = "" }
      }
      LabeledField(label: "결과물") {
        TextField("결과물", text: $outcome).fieldBox()
      }
      if !error.isEmpty { FormError(text: error) }
      HStack {
        Spacer()
        Button("저장") {
          guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            error = "프로젝트 이름을 입력하세요."
            return
          }
          model.saveProject(id: editor.project?.id, name: name, outcome: outcome)
          dismiss()
        }
        .buttonStyle(PrimaryButtonStyle())
      }
    }
    .onAppear {
      name = editor.project?.name ?? ""
      outcome = editor.project?.outcome ?? ""
    }
  }
}
