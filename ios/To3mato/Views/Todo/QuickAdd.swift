import SwiftUI
import To3matoCore

/// 바로 추가 줄: 입력 후 리턴으로 바로 추가하고, `할 일 추가`는 추가 시트를 연다.
struct QuickAdd: View {
  @Environment(AppModel.self) private var model
  let date: String
  let label: String
  var project = ""
  let add: (AddRequest) -> Void
  @State private var title = ""
  @State private var templatesOpen = false
  @FocusState private var focused: Bool

  var body: some View {
    VStack(spacing: 12) {
      HStack(spacing: 10) {
        Image(systemName: "plus")
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(Palette.inkHint)
        TextField("예: 강의 수강 및 정리", text: $title)
          .font(.hand(18))
          .foregroundStyle(Palette.ink)
          .focused($focused)
          .submitLabel(.done)
          .onSubmit(submit)
          .accessibilityLabel("할 일 이름")
        Button("템플릿") { templatesOpen.toggle() }
          .buttonStyle(LineButtonStyle(pressed: templatesOpen))
        Button("할 일 추가") {
          add(AddRequest(title: title, date: date, project: project))
          title = ""
        }
        .buttonStyle(LineButtonStyle())
        .accessibilityLabel("\(label) 할 일 추가")
      }
      .padding(.leading, 18)
      .padding(.trailing, 12)
      .padding(.vertical, 8)
      .frame(minHeight: 60)
      .background {
        WobbleShape(radii: Wobble.a).fill(focused ? Palette.paper : Palette.paperSoft)
        WobbleShape(radii: Wobble.a)
          .strokeBorder(focused ? Palette.coral : Palette.lineStrong, style: StrokeStyle(lineWidth: 2, dash: [6, 5]))
      }

      if templatesOpen {
        TemplatePicker(date: date, project: project) { templatesOpen = false }
      }
    }
  }

  private func submit() {
    guard !title.trimmingCharacters(in: .whitespaces).isEmpty else {
      model.notify("할 일 이름을 입력하세요.")
      return
    }
    model.addTask(title: title, date: date, project: project)
    model.notify("할 일을 추가했습니다.")
    title = ""
    focused = true
  }
}

/// 템플릿 목록: 고르면 해당 날짜에 단계를 추가한다.
struct TemplatePicker: View {
  @Environment(AppModel.self) private var model
  let date: String
  let project: String
  let close: () -> Void
  @State private var editorOpen = false

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(model.templates) { template in
        Button {
          model.apply(template, date: date, project: project)
          close()
        } label: {
          VStack(alignment: .leading, spacing: 6) {
            Text(template.name).font(.hand(TextSize.md)).foregroundStyle(Palette.ink)
            FlowLayout(spacing: 6) {
              ForEach(template.steps, id: \.self) { step in
                HStack(spacing: 4) {
                  Text(step.title.replacingOccurrences(of: "%n%", with: "1"))
                  PomoCount(value: "\(step.estimate)", size: TextSize.xs)
                }
                .font(.hand(TextSize.xs))
                .foregroundStyle(Palette.inkChip)
                .padding(.horizontal, 8)
                .background(Palette.butter, in: WobbleShape(radii: Wobble.s))
              }
            }
            HStack(spacing: 4) {
              Text("예상 합계")
              PomoCount(value: "\(template.steps.reduce(0) { $0 + $1.estimate })")
            }
            .font(.hand(TextSize.sm))
            .foregroundStyle(Palette.muted)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
      }
      Button("템플릿 추가") { editorOpen = true }
        .buttonStyle(DashButtonStyle())
    }
    .padding(16)
    .paper(radii: Wobble.b, tilt: Tilt.a, tape: .right)
    .sheet(isPresented: $editorOpen) {
      AddTaskSheet(request: AddRequest(date: date, project: project), mode: .template)
    }
  }
}

/// 줄바꿈 되는 가로 배치
struct FlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0
    var y: CGFloat = 0
    var row: CGFloat = 0
    var widest: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > 0, x + size.width > width {
        y += row + spacing
        x = 0
        row = 0
      }
      x += size.width + spacing
      row = max(row, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: min(widest, width), height: y + row)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX
    var y = bounds.minY
    var row: CGFloat = 0
    for view in subviews {
      let size = view.sizeThatFits(.unspecified)
      if x > bounds.minX, x + size.width > bounds.maxX {
        y += row + spacing
        x = bounds.minX
        row = 0
      }
      view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      row = max(row, size.height)
    }
  }
}
