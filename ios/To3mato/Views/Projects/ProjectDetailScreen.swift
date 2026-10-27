import SwiftUI

/// 프로젝트 상세: 표지, 결과물, 숫자, 진행 막대, 남은 할 일, 다이어리(티켓 목록)
struct ProjectDetailScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let projectId: String
  @Binding var editor: ProjectEditor?
  @State private var editing: TaskItem?
  @State private var adding: AddRequest?
  @State private var deleting = false
  @State private var selectedTicket: String?

  var body: some View {
    if let project = model.project(projectId) {
      content(project)
    }
  }

  private func content(_ project: Project) -> some View {
    let summary = model.summary(project.id)
    let open = model.tasks.filter { $0.project == project.id && !$0.done }
    let weeks = model.ticketWeeks(project.id)

    return ScrollView {
      VStack(alignment: .leading, spacing: 30) {
        VStack(alignment: .leading, spacing: 14) {
          ProjectCover(project: project).frame(height: 170)
          DisplayText(project.name, size: TextSize.h2)
          HStack(spacing: 8) {
            Text("결과물").foregroundStyle(Palette.muted)
            if project.outcome.isEmpty {
              Text("없음").foregroundStyle(Palette.muted)
            } else {
              Text(project.outcome).foregroundStyle(Palette.ink).highlighter()
            }
          }
          .font(.hand(TextSize.base))
          HStack(spacing: 4) {
            Button("프로젝트 수정") { editor = ProjectEditor(project: project) }
            Button("프로젝트 삭제") { deleting = true }
          }
          .buttonStyle(TextButtonStyle())
          ProjectStats(summary: summary)
          HandBar(value: summary.progress, color: Palette.leaf)
            .accessibilityLabel("진행률 \(Int((summary.progress * 100).rounded()))%")
        }
        .padding(18)
        .paper(.peach, tilt: Tilt.c, tape: .left, tapeColor: .pink)

        VStack(alignment: .leading, spacing: 10) {
          SectionTitle(title: "남은 할 일", count: open.count)
          ForEach(Array(open.enumerated()), id: \.element.id) { index, task in
            TaskRow(task: task, index: index, showDate: true) { editing = $0 }
          }
          QuickAdd(date: "", label: project.name, project: project.id) { adding = $0 }
        }

        VStack(alignment: .leading, spacing: 14) {
          HStack(alignment: .firstTextBaseline) {
            SectionTitle(title: "티켓", count: summary.tickets)
            Spacer()
            Button("템플릿으로 저장") { saveTemplate(project) }
              .buttonStyle(LineButtonStyle())
              .disabled(!model.tickets.contains { $0.projectId == project.id && !$0.voided })
          }
          if weeks.isEmpty {
            EmptyNote(text: "발권된 티켓이 없습니다.")
          }
          ForEach(weeks) { week in
            HStack(spacing: 10) {
              Rectangle().fill(Palette.line).frame(height: 2)
              StickerDate(text: week.label).fixedSize()
              Rectangle().fill(Palette.line).frame(height: 2)
            }
            if model.deliveries.contains(where: { $0.id == week.id }) {
              FilmStrip(label: week.label) { model.tab = .log }
            }
            ForEach(Array(week.tickets.enumerated()), id: \.element.id) { index, ticket in
              VStack(spacing: 10) {
                TicketView(ticket: ticket, project: project, index: index) {
                  selectedTicket = selectedTicket == ticket.id ? nil : ticket.id
                }
                if selectedTicket == ticket.id {
                  TicketTools(ticketId: ticket.id)
                }
              }
            }
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 20)
    }
    .readableWidth()
    .background(DotBackground())
    .navigationTitle(project.name)
    .navigationBarTitleDisplayMode(.inline)
    .sheet(item: $editing) { TaskEditorSheet(task: $0) }
    .sheet(item: $adding) { AddTaskSheet(request: $0) }
    .confirmationDialog("프로젝트 삭제", isPresented: $deleting, titleVisibility: .visible) {
      Button("삭제", role: .destructive) {
        model.deleteProject(project.id)
        dismiss()
      }
      Button("취소", role: .cancel) {}
    } message: {
      Text(project.name)
    }
  }

  private func saveTemplate(_ project: Project) {
    let done = model.tickets.filter { $0.projectId == project.id && !$0.voided }
      .sorted { $0.completedAt < $1.completedAt }
    model.templates.append(
      TaskTemplate(
        id: UUID().uuidString, name: project.name,
        steps: done.map { TemplateStep(title: $0.title, estimate: min(AppModel.maxTaskEstimate, $0.estimate)) }))
  }
}

/// 티켓: 왼쪽 그루터기(도장), 가운데 본문, 오른쪽 날짜 도장
struct TicketView: View {
  let ticket: Ticket
  var project: Project?
  var index = 0
  var select: () -> Void = {}

  var body: some View {
    let slots = min(6, max(ticket.estimate, Int(ticket.used.rounded(.up))))
    HStack(spacing: 0) {
      VStack(spacing: 6) {
        HStack(spacing: 1) {
          ForEach(0..<slots, id: \.self) { i in
            TomatoStamp(filled: i < Int(ticket.used), size: 13)
          }
        }
        Text("\(ticket.used.pomodoroText) / \(ticket.estimate)")
          .font(.hand(TextSize.xs))
          .foregroundStyle(Palette.muted)
      }
      .frame(width: 84)
      .padding(.vertical, 14)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("처음 예상 \(ticket.estimate), 실제 사용 \(ticket.used.pomodoroText)")

      Rectangle()
        .stroke(Palette.lineStrong, style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
        .frame(width: 1.5)
        .padding(.vertical, 8)

      Button(action: select) {
        VStack(alignment: .leading, spacing: 6) {
          Text(ticket.title)
            .font(.hand(TextSize.md))
            .foregroundStyle(Palette.ink)
            .modifier(Highlight(on: ticket.highlight))
            .strikethrough(ticket.voided, color: Palette.strokeSoft)
          HStack(spacing: 6) {
            if let project { Chip(text: project.name, dot: project.tint) }
            Text(Day.format(ticket.completedAt, "MMMMdEEEjjmm"))
              .font(.hand(TextSize.xs))
              .foregroundStyle(Palette.muted)
              .lineLimit(1)
          }
          if !ticket.note.isEmpty {
            Text(ticket.note).font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("\(ticket.title) 티켓 꾸미기")

      VStack(spacing: 0) {
        Text("\(Day.calendar.component(.month, from: ticket.completedAt)).\(Day.calendar.component(.day, from: ticket.completedAt))")
        Text(ticket.voided ? "취소" : "완료")
      }
      .font(.hand(TextSize.xs))
      .foregroundStyle(ticket.voided ? Palette.muted : Palette.red)
      .padding(6)
      .overlay(Circle().strokeBorder(ticket.voided ? Palette.strokeSoft : Palette.red, lineWidth: 1.5))
      .rotationEffect(.degrees(-12))
      .padding(.trailing, 12)
      .accessibilityHidden(true)
    }
    .background(Palette.paper)
    .clipShape(RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.line, lineWidth: 2))
    .overlay(alignment: .topTrailing) {
      if ticket.sticker != .none {
        Image(systemName: AppIcon.symbol(ticket.sticker.rawValue))
          .font(.system(size: 20))
          .foregroundStyle(ticket.sticker == .star ? Palette.butterDeep : Palette.red)
          .rotationEffect(.degrees(12))
          .offset(x: 6, y: -10)
          .accessibilityHidden(true)
      }
    }
    .overlay(alignment: .topLeading) {
      Tape(spot: .left, color: [.pink, .yellow, .green][index % 3])
        .padding(.leading, 28)
        .offset(y: -9)
    }
    .opacity(ticket.voided ? 0.6 : 1)
    .rotationEffect(.degrees(index % 2 == 1 ? 0.8 : -0.8))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("티켓 \(ticket.title)")
  }
}

private struct Highlight: ViewModifier {
  let on: Bool
  func body(content: Content) -> some View {
    if on { content.highlighter() } else { content }
  }
}

/// 티켓 꾸미기: 형광펜, 스티커, 메모
private struct TicketTools: View {
  @Environment(AppModel.self) private var model
  let ticketId: String
  @State private var note = ""

  var body: some View {
    if let ticket = model.tickets.first(where: { $0.id == ticketId }) {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          Button("형광펜") { model.decorate(ticketId) { $0.highlight.toggle() } }
            .buttonStyle(LineButtonStyle(pressed: ticket.highlight))
          ForEach(TicketSticker.allCases, id: \.self) { sticker in
            Button {
              model.decorate(ticketId) { $0.sticker = sticker }
            } label: {
              Image(systemName: sticker == .none ? "xmark" : AppIcon.symbol(sticker.rawValue))
                .font(.system(size: 12))
                .frame(width: 28, height: 28)
            }
            .buttonStyle(StepButtonStyle())
            .accessibilityLabel("스티커 \(stickerLabel(sticker))")
            .accessibilityAddTraits(ticket.sticker == sticker ? .isSelected : [])
          }
        }
        TextField("메모", text: $note)
          .fieldBox()
          .onSubmit { model.decorate(ticketId) { $0.note = note } }
      }
      .padding(14)
      .paper(radii: Wobble.b)
      .onAppear { note = ticket.note }
    }
  }

  private func stickerLabel(_ sticker: TicketSticker) -> String {
    switch sticker {
    case .none: "없음"
    case .star: "별"
    case .heart: "하트"
    case .leaf: "잎"
    }
  }
}

/// 영상 편지 필름: 해당 주에 배달된 영상이 있을 때
private struct FilmStrip: View {
  let label: String
  let open: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      HStack(spacing: 4) {
        ForEach(0..<4, id: \.self) { _ in
          RoundedRectangle(cornerRadius: 2).fill(Palette.kraft).frame(width: 18, height: 24)
        }
      }
      .accessibilityHidden(true)
      Text(label).font(.hand(TextSize.sm)).foregroundStyle(Palette.paper)
      Spacer(minLength: 0)
      Button("영상 편지 보기", action: open)
        .buttonStyle(LineButtonStyle())
    }
    .padding(12)
    .background(Palette.ink, in: RoundedRectangle(cornerRadius: 8))
    .rotationEffect(.degrees(Tilt.c))
  }
}
