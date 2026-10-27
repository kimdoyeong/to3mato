import SwiftUI

/// 돌아보기: 전체 화면 시트
struct ReviewScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let today = model.today
    let tomorrow = Day.offset(1, from: today)
    let tasks = model.todayTasks
    let pending = tasks.filter { !$0.done }
    let next = model.tasks.filter { $0.date == tomorrow }
    let done = model.doneOn(today)
    let capacity = model.settings.dailyCapacity

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          HStack {
            SectionTitle(title: "돌아보기", size: TextSize.h2)
            Spacer()
            StickerDate(text: Day.sticker(model.now))
          }

          HStack(alignment: .center, spacing: 16) {
            Mascot(size: 64)
            stat("완료", done.pomodoroText)
            stat("오늘 가능", "\(capacity)")
            stat("배치", "\(model.allocated(on: today))")
          }
          .padding(18)
          .frame(maxWidth: .infinity)
          .overlay(alignment: .bottom) {
            HStack(spacing: 4) {
              ForEach(0..<max(capacity, Int(done.rounded(.up))), id: \.self) { i in
                TomatoStamp(Double(i + 1) <= done ? .filled : Double(i) < done ? .half : .empty, size: 20)
              }
            }
            .offset(y: 14)
          }
          .padding(.bottom, 14)
          .paper(.peach, tilt: Tilt.c, tape: .left, tapeColor: .pink)

          VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "오늘 할 일", count: tasks.count)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
              GridRow {
                Color.clear.frame(height: 1).accessibilityLabel("할 일 이름")
                Text("처음 예상")
                Text("실제 사용")
                Color.clear.frame(width: 24, height: 1)
              }
              .font(.hand(TextSize.xs))
              .foregroundStyle(Palette.muted)
              ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                let used = model.used(task.id)
                let diff = used - Double(task.estimate)
                GridRow {
                  HStack(spacing: 8) {
                    Circ(content: task.done ? .check : .number(index + 1), state: task.done ? .ok : .idle)
                    Text(task.title)
                      .font(.hand(TextSize.base))
                      .foregroundStyle(task.done ? Palette.inkSoft : Palette.ink)
                      .lineLimit(2)
                  }
                  PomoCount(value: "\(task.estimate)", filled: false)
                  PomoCount(value: used.pomodoroText, filled: used > 0)
                  Text(task.done ? (diff > 0 ? "+" : "") + diff.pomodoroText : "")
                    .font(.hand(TextSize.sm))
                    .foregroundStyle(diff > 0 ? Palette.redDeep : diff < 0 ? Palette.green : Palette.muted)
                }
                .foregroundStyle(Palette.ink)
              }
            }
          }

          VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: "미완료", count: pending.count)
            if pending.isEmpty {
              Text("미완료 할 일이 없습니다.").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
            }
            ForEach(pending) { RitualTaskRow(task: $0, target: tomorrow, mode: .review) }
          }

          VStack(alignment: .leading, spacing: 10) {
            HStack {
              SectionTitle(title: "내일", count: next.count)
              Spacer()
              CountStepper(
                label: "내일 가능",
                value: Binding(get: { model.settings.dailyCapacity }, set: { model.setCapacity($0) }),
                range: 1...16, decreaseLabel: "내일 가능 −", increaseLabel: "내일 가능 +")
            }
            CapacityRow(capacity: capacity, allocated: model.allocated(on: tomorrow), done: 0)
            ForEach(Array(next.enumerated()), id: \.element.id) { index, task in
              HStack(spacing: 10) {
                Circ(content: .number(index + 1))
                Text(task.title).font(.hand(TextSize.base)).foregroundStyle(Palette.ink)
                Spacer()
                PomoCount(value: "\(task.estimate)", filled: false)
              }
              .padding(.horizontal, 14)
              .padding(.vertical, 8)
              .paper(flat: true)
            }
          }

          HStack {
            Spacer()
            Button("저장") { dismiss() }
              .buttonStyle(PrimaryButtonStyle())
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
      }
      .readableWidth()
      .background(DotBackground())
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
  }

  private func stat(_ label: String, _ value: String) -> some View {
    VStack(spacing: 2) {
      Text(label).font(.hand(TextSize.xs)).foregroundStyle(Palette.muted)
      Text(value).font(.hand(TextSize.h2)).foregroundStyle(Palette.ink)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }
}
