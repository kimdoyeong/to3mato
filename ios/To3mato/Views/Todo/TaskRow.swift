import SwiftUI
import To3matoCore

/// 할 일 행: 순번 동그라미, 제목, 예상 1 | 2, 사용 토마토 n / m, 더보기
struct TaskRow: View {
  @Environment(AppModel.self) private var model
  let task: TaskItem
  var index = 0
  /// 오늘 목록: 번호를 붙이고 길게 눌러 순서를 바꾼다.
  var ordered = false
  /// 미지정 목록: 오늘에 배치 버튼을 둔다.
  var backlog = false
  var showDate = false
  let edit: (TaskItem) -> Void

  var body: some View {
    let used = model.used(task.id)
    let current = model.isCurrent(task)
    let project = model.project(task.project)
    let doneLabel = "\(task.title) \(task.done ? "완료 취소" : "완료")"

    HStack(alignment: .top, spacing: 12) {
      if ordered {
        Button {
          model.toggle(task)
        } label: {
          Circ(content: task.done ? .check : .number(index + 1), state: task.done ? .ok : current ? .on : .idle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(doneLabel)
      } else {
        CheckBox(checked: task.done, label: doneLabel) { model.toggle(task) }
      }

      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .top) {
          Button {
            edit(task)
          } label: {
            Text(task.title)
              .font(.hand(TextSize.md))
              .foregroundStyle(task.done ? Palette.inkSoft : Palette.ink)
              .strikethrough(task.done, color: Palette.strokeSoft)
              .multilineTextAlignment(.leading)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .buttonStyle(.plain)

          Button {
            edit(task)
          } label: {
            Image(systemName: "ellipsis")
              .foregroundStyle(Palette.inkHint)
              .frame(width: 28, height: 24)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("\(task.title) 수정")
        }

        HStack(spacing: 8) {
          Chip(text: project?.name ?? "프로젝트 없음", dot: project?.tint)
          if showDate {
            Text(dateText).font(.hand(TextSize.xs)).foregroundStyle(Palette.muted)
          }
          Spacer(minLength: 0)
          if backlog && !task.done {
            Button("오늘에 배치") { model.move(task.id, to: model.today) }
              .buttonStyle(LineButtonStyle())
          }
        }

        HStack(spacing: 8) {
          Text("예상").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
          EstimatePicker(
            value: task.estimate, locked: task.done || used > 0, label: "\(task.title) 예상 포모도로"
          ) { model.setEstimate(task, $0) }
          Spacer(minLength: 0)
          Pomodoros(estimate: task.estimate, actual: used)
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
    .paper(task.done ? .done : current ? .current : .paper, radii: index % 2 == 1 ? Wobble.b : Wobble.a)
    .contentShape(.dragPreview, WobbleShape(radii: Wobble.a))
  }

  private var dateText: String {
    if task.date == model.today { return "오늘" }
    if task.date.isEmpty { return "날짜 미지정" }
    return Day.short(Day.date(task.date))
  }
}

/// 오늘 가능 수만큼 연필 토마토, 배치한 만큼 옅게, 완료한 만큼 빨간 도장. 가능을 넘긴 배치는 점선 토마토.
struct CapacityRow: View {
  let capacity: Int
  let allocated: Int
  let done: Double

  var body: some View {
    let slots = (0..<max(capacity, allocated)).map { i -> TomatoVariant in
      if i >= capacity { return .over }
      if Double(i) < done { return .filled }
      if i < allocated { return .plan }
      return .empty
    }
    VStack(alignment: .leading, spacing: 10) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 29), spacing: 5)], alignment: .leading, spacing: 5) {
        ForEach(Array(slots.enumerated()), id: \.offset) { _, variant in
          TomatoStamp(variant, size: 26)
        }
      }
      HStack(spacing: 16) {
        figure("배치", "\(allocated)")
        figure("완료", done.pomodoroText)
        if allocated > capacity {
          figure("초과", "\(allocated - capacity)", color: Palette.redDeep)
        }
      }
      .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
    .paper(tilt: Tilt.c, tape: .left)
  }

  private func figure(_ label: String, _ value: String, color: Color = Palette.muted) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text(label).font(.hand(TextSize.sm)).foregroundStyle(color)
      Text(value).font(.hand(TextSize.md)).foregroundStyle(color == Palette.muted ? Palette.ink : color)
    }
  }
}
