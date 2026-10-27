import SwiftUI

/// 할 일: Mac의 TodoView를 세로 한 열로 옮긴다.
struct TodoScreen: View {
  @Environment(AppModel.self) private var model
  @State private var editing: TaskItem?
  @State private var adding: AddRequest?

  var body: some View {
    NavigationStack {
      List {
        HStack {
          Spacer()
          StickerDate(text: Day.sticker(model.now))
        }
        .plainRow()

        if model.planOpen {
          PlanCard().plainRow(top: 14, bottom: 14)
        }

        ForEach(Array(model.sections().enumerated()), id: \.element.id) { index, section in
          SectionView(index: index, section: section, edit: { editing = $0 }, add: { adding = $0 })
        }
      }
      .listStyle(.plain)
      .scrollContentBackground(.hidden)
      .readableWidth()
      .background(DotBackground())
      .navigationTitle("할 일")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink {
            SettingsScreen()
          } label: {
            Image(systemName: AppIcon.symbol("settings"))
          }
          .accessibilityLabel("설정")
        }
      }
    }
    .sheet(item: $editing) { task in
      TaskEditorSheet(task: task)
    }
    .sheet(item: $adding) { request in
      AddTaskSheet(request: request)
    }
  }
}

/// 할 일 추가 시트를 여는 요청. 바로 추가 줄의 입력과 섹션 날짜를 넘긴다.
struct AddRequest: Identifiable {
  let id = UUID()
  var title = ""
  var date: String
  var project = ""
}

private struct SectionView: View {
  @Environment(AppModel.self) private var model
  let index: Int
  let section: TodoSection
  let edit: (TaskItem) -> Void
  let add: (AddRequest) -> Void

  var body: some View {
    let today = index == 0
    HStack(alignment: .center) {
      SectionTitle(title: section.label, count: section.tasks.count)
      Spacer()
      if today {
        CountStepper(
          label: "오늘 가능",
          value: Binding(get: { model.settings.dailyCapacity }, set: { model.setCapacity($0) }),
          range: 1...16,
          decreaseLabel: "오늘 가능 포모도로 줄이기",
          increaseLabel: "오늘 가능 포모도로 늘리기")
      }
    }
    .plainRow(top: index == 0 ? 6 : 26, bottom: 4)

    if today {
      CapacityRow(
        capacity: model.settings.dailyCapacity,
        allocated: model.allocated(on: section.date),
        done: model.doneOn(section.date)
      )
      .plainRow(top: 8, bottom: 8)
    }

    ForEach(Array(section.tasks.enumerated()), id: \.element.id) { offset, task in
      TaskRow(task: task, index: offset, ordered: today, backlog: section.date.isEmpty, edit: edit)
        .plainRow(top: 5, bottom: 5)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
          Button {
            model.toggle(task)
          } label: {
            Label("완료", systemImage: "checkmark")
          }
          .tint(Palette.leaf)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
          Button(role: .destructive) {
            model.delete(task.id)
          } label: {
            Label("삭제", systemImage: "trash")
          }
          if !section.date.isEmpty {
            Button {
              model.move(task.id, to: "")
            } label: {
              Label("보관", systemImage: "tray")
            }
            .tint(Palette.muted)
          }
          if section.date != Day.offset(1, from: model.today) {
            Button {
              model.move(task.id, to: Day.offset(1, from: model.today))
            } label: {
              Label("내일로", systemImage: "arrow.turn.down.right")
            }
            .tint(Palette.highlight)
          }
        }
    }
    .onMove { source, destination in
      model.reorder(on: section.date, from: source, to: destination)
    }

    QuickAdd(date: section.date, label: section.label, add: add)
      .plainRow(top: 6, bottom: 6)
  }
}

extension View {
  /// List 행을 바탕 없이 종이만 보이게 한다.
  func plainRow(top: CGFloat = 0, bottom: CGFloat = 0) -> some View {
    listRowInsets(EdgeInsets(top: top, leading: 16, bottom: bottom, trailing: 16))
      .listRowBackground(Color.clear)
      .listRowSeparator(.hidden)
  }
}
