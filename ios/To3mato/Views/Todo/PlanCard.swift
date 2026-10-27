import SwiftUI
import To3matoCore

/// 계획 시작 카드: 어제 미완료, 오늘 가능, 미지정
struct PlanCard: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let today = model.today
    let carry = model.tasks.filter { $0.date == Day.offset(-1, from: today) && !$0.done }
    let backlog = model.tasks.filter { $0.date.isEmpty && !$0.done }

    VStack(alignment: .leading, spacing: 18) {
      HStack {
        SectionTitle(title: "계획 시작", size: TextSize.title)
        Spacer()
        Button {
          withAnimation { model.planOpen = false }
        } label: {
          Image(systemName: "xmark")
        }
        .buttonStyle(TextButtonStyle())
        .accessibilityLabel("닫기")
      }

      VStack(alignment: .leading, spacing: 8) {
        step(1, "어제 미완료", count: carry.count)
        if carry.isEmpty {
          Text("어제 미완료 할 일이 없습니다.").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
        }
        ForEach(carry) { RitualTaskRow(task: $0, target: today, mode: .carry) }
      }

      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          Circ(content: .number(2), state: .on)
          CountStepper(
            label: "오늘 가능",
            value: Binding(get: { model.settings.dailyCapacity }, set: { model.setCapacity($0) }),
            range: 1...16, decreaseLabel: "오늘 가능 −", increaseLabel: "오늘 가능 +")
        }
        Text("지난 7일 평균 \(model.sevenDayAverage())")
          .font(.hand(TextSize.sm))
          .foregroundStyle(Palette.muted)
        CapacityRow(
          capacity: model.settings.dailyCapacity, allocated: model.allocated(on: today),
          done: model.doneOn(today))
      }

      VStack(alignment: .leading, spacing: 8) {
        step(3, "미지정", count: backlog.count)
        ForEach(backlog) { RitualTaskRow(task: $0, target: today, mode: .backlog) }
      }
    }
    .padding(20)
    .paper(.peach, tilt: Tilt.a, tape: .center)
  }

  private func step(_ n: Int, _ title: String, count: Int) -> some View {
    HStack(spacing: 8) {
      Circ(content: .number(n), state: .on)
      DisplayText(title, size: TextSize.lg)
      Badge(count)
    }
  }
}

/// 계획 카드와 돌아보기의 할 일 줄
struct RitualTaskRow: View {
  enum Mode { case carry, review, backlog }

  @Environment(AppModel.self) private var model
  let task: TaskItem
  let target: String
  let mode: Mode

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text(task.title).font(.hand(TextSize.md)).foregroundStyle(Palette.ink)
        if let project = model.project(task.project) {
          Chip(text: project.name)
        }
        Spacer(minLength: 0)
        PomoCount(value: "\(task.estimate)", filled: false)
          .foregroundStyle(Palette.muted)
          .accessibilityLabel("처음 예상 \(task.estimate)")
      }
      HStack(spacing: 4) {
        Button(mode == .carry ? "오늘로" : mode == .review ? "내일로" : "오늘에 배치") {
          model.move(task.id, to: target)
        }
        .buttonStyle(LineButtonStyle())
        if mode != .backlog {
          Button("보관") { model.move(task.id, to: "") }
            .buttonStyle(TextButtonStyle(size: TextSize.sm))
          Button(mode == .carry ? "삭제" : "완료") {
            if mode == .carry { model.delete(task.id) } else { model.toggle(task) }
          }
          .buttonStyle(TextButtonStyle(size: TextSize.sm))
        }
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .paper(flat: true)
  }
}
