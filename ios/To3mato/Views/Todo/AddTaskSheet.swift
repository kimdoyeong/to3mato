import SwiftUI
import To3matoCore

/// 할 일 추가: 하나 추가, 여러 개 추가, 템플릿 모드를 한 시트에 둔다.
struct AddTaskSheet: View {
  enum Mode: Hashable { case single, batch, template }

  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let request: AddRequest
  @State var mode: Mode = .single
  @State private var draft: TaskItem
  @State private var error = ""

  init(request: AddRequest, mode: Mode = .single) {
    self.request = request
    _mode = State(initialValue: mode)
    _draft = State(
      initialValue: TaskItem(
        id: UUID().uuidString, title: request.title, estimate: 1, remaining: 1,
        project: request.project, date: request.date))
  }

  var body: some View {
    PaperSheet(title: mode == .single ? "할 일 추가" : "여러 할 일 추가") {
      ModePicker(mode: $mode)

      switch mode {
      case .single:
        TaskFields(draft: $draft, error: $error)
        if !error.isEmpty { FormError(text: error) }
        HStack {
          Spacer()
          Button("저장") {
            guard !draft.title.trimmingCharacters(in: .whitespaces).isEmpty else {
              error = "할 일 이름을 입력하세요."
              return
            }
            draft.remaining = draft.estimate
            model.save(draft)
            dismiss()
          }
          .buttonStyle(PrimaryButtonStyle())
        }
      case .batch:
        BatchForm(project: request.project, startDate: request.date.isEmpty ? model.today : request.date)
      case .template:
        TemplateForm(project: request.project, startDate: request.date.isEmpty ? model.today : request.date)
      }
    }
  }
}

/// `.add-mode`: 하나 추가 | 여러 개 추가 | 템플릿
private struct ModePicker: View {
  @Binding var mode: AddTaskSheet.Mode

  var body: some View {
    HStack(spacing: 6) {
      item("하나 추가", .single)
      item("여러 개 추가", .batch)
      item("템플릿", .template)
    }
    .padding(4)
    .background(Palette.paperSoft, in: WobbleShape(radii: Wobble.mode))
    .overlay(WobbleShape(radii: Wobble.mode).strokeBorder(Palette.line, lineWidth: 2))
  }

  private func item(_ label: String, _ value: AddTaskSheet.Mode) -> some View {
    Button {
      mode = value
    } label: {
      Text(label)
        .font(.hand(TextSize.base))
        .foregroundStyle(mode == value ? Palette.redDeep : Palette.muted)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(mode == value ? Palette.peach : .clear, in: WobbleShape(radii: Wobble.mode))
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(mode == value ? .isSelected : [])
  }
}

/// 여러 개 추가: 이름 규칙으로 목록을 만들고 날짜별로 배치한다.
private struct BatchForm: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let project: String
  @State var startDate: String
  @State private var template = ""
  @State private var count = 5
  @State private var estimate = 1
  @State private var perDay = 1
  @State private var weekdays: Set<Int> = [1, 2, 3, 4, 5]
  @State private var drafts: [TaskItem] = []

  init(project: String, startDate: String) {
    self.project = project
    _startDate = State(initialValue: startDate)
  }

  var body: some View {
    if drafts.isEmpty {
      setup
    } else {
      review
    }
  }

  private var setup: some View {
    VStack(alignment: .leading, spacing: 16) {
      LabeledField(label: "할 일 이름 규칙") {
        TextField("독서 (%n%) · %date%", text: $template)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .fieldBox()
      }
      Text("%n% 번호 · %date% 예정일 (2026-10-19)")
        .font(.hand(TextSize.sm))
        .foregroundStyle(Palette.muted)
      HStack(spacing: 14) {
        numberField("생성 개수", value: $count, range: 1...AppModel.maxBatchSize)
        numberField("공통 예상 포모도로", value: $estimate, range: 1...AppModel.maxTaskEstimate)
      }
      HStack(alignment: .bottom, spacing: 14) {
        LabeledField(label: "시작 날짜") {
          DatePicker(
            "시작 날짜", selection: Binding(get: { Day.date(startDate) }, set: { startDate = Day.key($0) }),
            displayedComponents: .date
          )
          .environment(\.timeZone, Day.zone)
          .labelsHidden()
        }
        numberField("하루 기본 개수", value: $perDay, range: 1...AppModel.maxBatchSize)
      }
      WeekdayPicker(value: $weekdays)
      HStack {
        Text("1번부터 생성 · 최대 \(AppModel.maxBatchSize)개")
          .font(.hand(TextSize.sm))
          .foregroundStyle(Palette.muted)
        Spacer()
        Button("목록 생성") { drafts = generate() }
          .buttonStyle(PrimaryButtonStyle())
          .disabled(template.trimmingCharacters(in: .whitespaces).isEmpty || weekdays.isEmpty)
      }
    }
  }

  private var review: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("\(drafts.count)개 · 이름과 예정일 및 포모도로를 수정한 뒤 추가하세요.")
        .font(.hand(TextSize.sm))
        .foregroundStyle(Palette.muted)
      ForEach($drafts) { $draft in
        let index = (drafts.firstIndex { $0.id == draft.id } ?? 0) + 1
        HStack(spacing: 10) {
          Text("\(index)").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted).frame(width: 22)
          TextField("할 일 이름", text: $draft.title)
            .font(.hand(TextSize.base))
            .accessibilityLabel("\(index)번 할 일 이름")
          EstimatePicker(value: draft.estimate, label: "\(index)번 예상 포모도로") {
            draft.estimate = $0
            draft.remaining = $0
          }
          Text(Day.short(Day.date(draft.date)))
            .font(.hand(TextSize.xs))
            .foregroundStyle(Palette.muted)
        }
        .padding(.vertical, 6)
        Divider().overlay(Palette.line)
      }
      HStack {
        Button("목록 다시 생성") { drafts = [] }
          .buttonStyle(SecondaryButtonStyle())
        Spacer()
        Button("\(drafts.count)개 추가") {
          model.addBatch(drafts, project: project)
          dismiss()
        }
        .buttonStyle(PrimaryButtonStyle())
      }
    }
  }

  private func numberField(_ label: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
    LabeledField(label: label) {
      TextField(label, value: value, format: .number)
        .keyboardType(.numberPad)
        .fieldBox()
        .onChange(of: value.wrappedValue) { _, new in
          value.wrappedValue = min(range.upperBound, max(range.lowerBound, new))
        }
    }
  }

  /// 시작 날짜부터 고른 요일에만 하루 기본 개수씩 놓는다.
  private func generate() -> [TaskItem] {
    var result: [TaskItem] = []
    var date = startDate
    var placed = 0
    var guardDays = 0
    while result.count < count, guardDays < 3660 {
      // Mac의 getDay()와 같이 일요일이 0이다.
      let id = Day.calendar.component(.weekday, from: Day.date(date)) - 1
      if weekdays.contains(id), placed < perDay {
        let n = result.count + 1
        let title = template
          .replacingOccurrences(of: "%n%", with: "\(n)")
          .replacingOccurrences(of: "%date%", with: date)
        result.append(
          TaskItem(
            id: UUID().uuidString, title: title, estimate: estimate, remaining: estimate, project: project,
            date: date))
        placed += 1
      } else {
        date = Day.offset(1, from: date)
        placed = 0
        guardDays += 1
      }
    }
    return result
  }
}

/// 배치할 요일
struct WeekdayPicker: View {
  @Binding var value: Set<Int>

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("배치할 요일").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
      HStack(spacing: 6) {
        ForEach(Array(zip(Day.weekdayIds, Day.weekdayNames)), id: \.0) { id, name in
          let on = value.contains(id)
          Button {
            if on { value.remove(id) } else { value.insert(id) }
          } label: {
            Text(name)
              .font(.hand(TextSize.base))
              .foregroundStyle(on ? Palette.redDeep : Palette.muted)
              .frame(width: 38, height: 36)
              .background {
                WobbleShape(radii: Wobble.blob).fill(on ? Palette.peach : .white)
                WobbleShape(radii: Wobble.blob).strokeBorder(on ? Palette.coral : Palette.lineStrong, lineWidth: 2)
              }
          }
          .buttonStyle(.plain)
          .accessibilityLabel("\(name)요일 배치")
          .accessibilityAddTraits(on ? .isSelected : [])
        }
      }
    }
  }
}

/// 템플릿: 단계 목록을 회차만큼 고른 요일에 만든다.
private struct TemplateForm: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State var project: String
  @State var startDate: String
  @State private var selected = ""
  @State private var name = ""
  @State private var steps = [StepDraft()]
  @State private var rounds = 1
  @State private var weekdays: Set<Int> = [1, 2, 3, 4, 5]

  init(project: String, startDate: String) {
    _project = State(initialValue: project)
    _startDate = State(initialValue: startDate)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      FlowLayout(spacing: 8) {
        ForEach(model.templates) { template in
          Button(template.name) { select(template) }
            .buttonStyle(LineButtonStyle(pressed: selected == template.id))
        }
        Button("템플릿 추가") { select(nil) }
          .buttonStyle(DashButtonStyle())
      }

      LabeledField(label: "템플릿 이름") {
        TextField("템플릿 이름", text: $name).fieldBox()
      }

      VStack(alignment: .leading, spacing: 8) {
        ForEach($steps) { $step in
          let index = steps.firstIndex { $0.id == step.id } ?? 0
          HStack(spacing: 8) {
            Text("\(index + 1)").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted).frame(width: 18)
            TextField("단계 \(index + 1)", text: $step.title)
              .fieldBox()
            EstimatePicker(value: step.estimate) { step.estimate = $0 }
            Button("삭제") { steps.removeAll { $0.id == step.id } }
              .buttonStyle(TextButtonStyle(size: TextSize.sm))
              .disabled(steps.count == 1)
              .accessibilityLabel("단계 \(index + 1) 삭제")
          }
        }
        Button("단계 추가") { steps.append(StepDraft()) }
          .buttonStyle(DashButtonStyle())
          .disabled(steps.count >= 20)
      }

      HStack(alignment: .bottom, spacing: 16) {
        LabeledField(label: "회차") {
          HStack(spacing: 8) {
            StepButton(symbol: "−", label: "회차 −") { rounds -= 1 }.disabled(rounds <= 1)
            Text("\(rounds)").font(.hand(TextSize.lg)).frame(minWidth: 22)
            StepButton(symbol: "+", label: "회차 +") { rounds += 1 }
              .disabled(rounds >= 500 / max(1, steps.count))
          }
        }
        LabeledField(label: "시작일") {
          DatePicker(
            "시작일", selection: Binding(get: { Day.date(startDate) }, set: { startDate = Day.key($0) }),
            displayedComponents: .date
          )
          .environment(\.timeZone, Day.zone)
          .labelsHidden()
        }
      }

      WeekdayPicker(value: $weekdays)

      LabeledField(label: "프로젝트") {
        Picker("프로젝트", selection: $project) {
          Text("프로젝트 없음").tag("")
          ForEach(model.projects) { Text($0.name).tag($0.id) }
        }
        .pickerStyle(.menu)
        .tint(Palette.ink)
      }

      let total = steps.count * rounds
      HStack(spacing: 16) {
        HStack(spacing: 4) {
          Text("생성될 할 일")
          Text("\(total)").foregroundStyle(Palette.ink)
        }
        HStack(spacing: 4) {
          Text("예상 합계")
          PomoCount(value: "\(steps.reduce(0) { $0 + $1.estimate } * rounds)")
        }
      }
      .font(.hand(TextSize.sm))
      .foregroundStyle(Palette.muted)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(14)
      .paper(radii: Wobble.b)

      HStack {
        Button("템플릿으로 저장") { saveTemplate() }
          .buttonStyle(LineButtonStyle())
          .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || steps.contains { $0.title.isEmpty })
        Spacer()
        Button("저장") {
          // 한 회차는 고른 요일 하루를 차지한다. 단계는 저장된 순서를 따른다.
          let dates = scheduleDates(count: rounds, start: startDate, weekdays: weekdays)
          let tasks = dates.enumerated().flatMap { round, date in
            steps.map {
              TaskItem(
                id: "", title: $0.title.replacingOccurrences(of: "%n%", with: "\(round + 1)")
                  .replacingOccurrences(of: "%date%", with: date),
                estimate: $0.estimate, remaining: $0.estimate, date: date)
            }
          }
          model.addBatch(tasks, project: project)
          dismiss()
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(steps.contains { $0.title.isEmpty })
      }
    }
  }

  private func select(_ template: TaskTemplate?) {
    selected = template?.id ?? ""
    name = template?.name ?? ""
    steps = template?.steps.map { StepDraft(title: $0.title, estimate: $0.estimate) } ?? [StepDraft()]
  }

  private func saveTemplate() {
    let known = Set(model.templates.map(\.id))
    model.saveTemplate(id: selected, name: name, steps: steps.map { TemplateStep(title: $0.title, estimate: $0.estimate) }) {
      if selected.isEmpty { selected = model.templates.first { !known.contains($0.id) }?.id ?? "" }
    }
  }
}

/// 편집 중인 템플릿 단계. 삭제해도 다른 행과 섞이지 않도록 고유 id를 둔다.
private struct StepDraft: Identifiable {
  let id = UUID()
  var title = ""
  var estimate = 1
}

/// 시작 날짜부터 고른 요일에만 하루 하나씩 날짜를 고른다.
func scheduleDates(count: Int, start: String, weekdays: Set<Int>) -> [String] {
  guard !weekdays.isEmpty else { return [] }
  var result: [String] = []
  var date = start
  var guardDays = 0
  while result.count < count, guardDays < 3660 {
    // Mac의 getDay()와 같이 일요일이 0이다.
    if weekdays.contains(Day.calendar.component(.weekday, from: Day.date(date)) - 1) { result.append(date) }
    date = Day.offset(1, from: date)
    guardDays += 1
  }
  return result
}
