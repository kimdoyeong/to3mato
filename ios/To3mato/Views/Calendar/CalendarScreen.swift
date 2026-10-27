import SwiftUI

/// 캘린더: 가로 스크롤 요일 띠와 선택한 날의 할 일 목록.
/// 할 일 행을 길게 눌러 요일 칸에 놓으면 예정일을 옮긴다.
struct CalendarScreen: View {
  @Environment(AppModel.self) private var model
  @State private var selected = Day.key()
  @State private var week = 0
  @State private var target: String?
  @State private var editing: TaskItem?
  @State private var adding: AddRequest?

  var body: some View {
    let monday = Day.offset(week * 7, from: Day.key(Day.weekStart(model.now)))
    let dates = (0..<7).map { Day.offset($0, from: monday) }
    let tasks = model.tasks.filter { $0.date == selected }

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          HStack {
            DisplayText(Day.format(Day.date(monday), "yyyyMMMM"), size: TextSize.xl)
            Spacer()
            Button("이번 주") {
              week = 0
              selected = model.today
            }
            .buttonStyle(TextButtonStyle())
            Button {
              week -= 1
            } label: {
              Image(systemName: "chevron.left")
            }
            .buttonStyle(TextButtonStyle())
            .accessibilityLabel("이전 주")
            Button {
              week += 1
            } label: {
              Image(systemName: "chevron.right")
            }
            .buttonStyle(TextButtonStyle())
            .accessibilityLabel("다음 주")
          }

          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
              ForEach(Array(dates.enumerated()), id: \.element) { index, date in
                DayCell(
                  name: Day.weekdayNames[index], date: date, selected: date == selected,
                  today: date == model.today, target: target == date,
                  pomodoros: model.allocated(on: date)
                ) { selected = date }
                .dropDestination(for: String.self) { ids, _ in
                  guard let id = ids.first else { return false }
                  model.move(id, to: date)
                  return true
                } isTargeted: { over in
                  target = over ? date : (target == date ? nil : target)
                }
              }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 2)
          }

          HStack(alignment: .firstTextBaseline) {
            SectionTitle(title: Day.label(selected))
            Spacer()
            Text("날짜로 드래그하여 이동")
              .font(.hand(TextSize.sm))
              .foregroundStyle(Palette.muted)
          }

          if tasks.isEmpty {
            EmptyNote(text: "등록된 할 일이 없습니다.")
          }
          ForEach(tasks) { task in
            TaskRow(task: task) { editing = $0 }
              .draggable(task.id) {
                Text(task.title)
                  .font(.hand(TextSize.md))
                  .padding(12)
                  .paper()
              }
          }

          Button {
            adding = AddRequest(date: selected)
          } label: {
            Label("할 일 추가", systemImage: "plus")
          }
          .buttonStyle(DashButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
      }
      .readableWidth()
      .background(DotBackground())
      .navigationTitle("캘린더")
      .navigationBarTitleDisplayMode(.inline)
    }
    .sheet(item: $editing) { TaskEditorSheet(task: $0) }
    .sheet(item: $adding) { AddTaskSheet(request: $0) }
  }
}

/// 요일 칸: 요일, 날짜, 배치 토마토 수
private struct DayCell: View {
  let name: String
  let date: String
  let selected: Bool
  let today: Bool
  let target: Bool
  let pomodoros: Int
  let select: () -> Void

  var body: some View {
    Button(action: select) {
      VStack(spacing: 4) {
        Text(name).font(.hand(TextSize.sm)).foregroundStyle(today ? Palette.red : Palette.muted)
        Text("\(Int(date.suffix(2)) ?? 0)")
          .font(.hand(TextSize.xl))
          .foregroundStyle(Palette.ink)
        PomoCount(value: "\(pomodoros)", size: TextSize.xs)
          .foregroundStyle(Palette.muted)
      }
      .frame(width: 58)
      .padding(.vertical, 12)
      .paper(
        target ? .current : selected ? .peach : .paper, radii: Wobble.s,
        tilt: selected ? Tilt.b : 0)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(Day.label(date))
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
