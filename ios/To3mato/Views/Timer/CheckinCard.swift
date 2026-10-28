import SwiftUI
import To3matoCore

/// 진척 확인: 집중이 끝나면 타이머 판 자리에 들어간다.
struct CheckinCard: View {
  @Environment(AppModel.self) private var model
  let task: TaskItem
  let used: Double
  @State private var remaining = 0

  var body: some View {
    let maximum = max(AppModel.maxTaskEstimate, task.estimate)
    let total = max(task.estimate, Int(used.rounded(.up)) + remaining)

    VStack(spacing: 14) {
      DisplayText("진척 확인", size: 26)
      VStack(alignment: .leading, spacing: 10) {
        Text(task.title)
          .font(.hand(TextSize.lg))
          .foregroundStyle(Palette.ink)
        receiptLine("처음 예상") {
          Text("\(task.estimate)").font(.hand(TextSize.md))
          stamps(min(6, task.estimate), filled: 0)
        }
        receiptLine("실제 사용") {
          Text(used.pomodoroText).font(.hand(TextSize.md))
          stamps(min(6, Int(used.rounded(.up))), filled: Int(used.rounded(.up)))
        }
        receiptLine("남은 예상", icon: "pencil") {
          StepButton(symbol: "−", label: "남은 예상 줄이기") { remaining -= 1 }
            .disabled(remaining <= 0)
          Text("\(remaining)").font(.hand(TextSize.md)).frame(minWidth: 18)
          StepButton(symbol: "+", label: "남은 예상 늘리기") { remaining += 1 }
            .disabled(remaining >= maximum)
        }
        Divider().overlay(Palette.line)
        HStack(spacing: 6) {
          Text("전체").foregroundStyle(Palette.muted)
          stamps(min(8, total), filled: Int(used))
        }
        .font(.hand(TextSize.sm))
      }
      .padding(18)
      .background(Palette.paper, in: RoundedRectangle(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Palette.line, lineWidth: 1.5))

      HStack(spacing: 8) {
        Button("완료") { model.checkinDone() }
          .buttonStyle(TextButtonStyle())
        Button("이어서 할 일 만들기") { model.checkinFollowUp() }
          .buttonStyle(LineButtonStyle())
        Button("저장") { model.checkinSave(remaining: remaining) }
          .buttonStyle(PrimaryButtonStyle())
      }
      Text("저장하면 휴식을 시작합니다.")
        .font(.hand(TextSize.sm))
        .foregroundStyle(Palette.muted)
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 18)
    .padding(.top, 26)
    .padding(.bottom, 24)
    .paper(.peach, radii: Wobble.l, tape: .center)
    .onAppear { remaining = min(maximum, max(0, task.remaining - 1)) }
  }

  private func receiptLine<Value: View>(
    _ label: String, icon: String? = nil, @ViewBuilder value: () -> Value
  ) -> some View {
    HStack {
      HStack(spacing: 4) {
        if let icon { Image(systemName: icon).font(.system(size: 12)) }
        Text(label)
      }
      .font(.hand(TextSize.sm))
      .foregroundStyle(Palette.muted)
      Spacer()
      HStack(spacing: 6) { value() }
        .foregroundStyle(Palette.ink)
    }
  }

  private func stamps(_ count: Int, filled: Int) -> some View {
    HStack(spacing: 2) {
      ForEach(0..<count, id: \.self) { i in
        TomatoStamp(filled: i < filled, size: 15)
      }
    }
  }
}
