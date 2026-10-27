import SwiftUI

/// 실행 시트: iPhone에서 하단 타이머 바를 누르면 실행 영역을 시트로 올린다.
struct RunSheet: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ExecutionPanel()
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
      .navigationBarTitleDisplayMode(.inline)
    }
    .presentationDragIndicator(.visible)
    .presentationBackground(Palette.paperWarm)
  }
}

/// 실행 영역: Mac의 오른쪽 실행 영역과 같은 내용. iPhone은 시트로, iPad는 오른쪽 열로 보여준다.
struct ExecutionPanel: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ScrollView {
      VStack(spacing: 22) {
        if model.timer != nil {
          LiveTag(
            text: model.timerStatus,
            running: model.timer?.running == true && model.timer?.phase != .rest)
        }
        if model.timer?.phase == .checkin, let task = model.timerTask {
          CheckinCard(task: task, used: model.used(task.id))
        } else {
          TimerPanel()
        }
        TodayList()
        DailySummary()
      }
      .padding(.horizontal, 18)
      .padding(.top, 8)
      .padding(.bottom, 30)
    }
    .background(Palette.paperWarm)
  }
}

/// 타이머 판: --peach-panel 종이, 테이프, 토마토, 할 일 제목, 큰 시계, 진행 막대, 예상 토마토
struct TimerPanel: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let timer = model.timer
    let rest = timer?.phase == .rest
    let task = model.timerTask
    let progress = timer.map { model.elapsed / $0.duration } ?? 0

    VStack(spacing: 6) {
      Group {
        if let timer, !rest {
          TomatoGrowth(progress: progress, running: timer.running)
        } else {
          Mascot(resting: rest, size: 110)
        }
      }
      .frame(height: 120)

      if rest || task != nil {
        DisplayText(rest ? "휴식" : task?.title ?? "", size: 26)
          .lineLimit(1)
      }

      Text(model.clock)
        .font(.hand(88, relativeTo: .largeTitle))
        .monospacedDigit()
        .foregroundStyle(Palette.ink)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .contentTransition(.numericText(countsDown: true))
        .accessibilityLabel("남은 시간 \(model.clock)")

      HandBar(value: progress)
        .frame(maxWidth: 270)
        .padding(.bottom, 4)

      if let task, !rest {
        HStack(spacing: 6) {
          Text("예상").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
          Pomodoros(estimate: task.estimate, actual: model.used(task.id))
        }
      }

      HStack(spacing: 14) {
        Button {
          model.toggleTimer()
        } label: {
          Label(primaryLabel, systemImage: timer?.running == true ? "pause.fill" : "play.fill")
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(timer == nil && model.pendingToday.isEmpty)

        Button {
          model.endTimer()
        } label: {
          Image(systemName: rest ? "chevron.right" : "stop.fill")
        }
        .buttonStyle(EndButtonStyle())
        .disabled(timer == nil)
        .accessibilityLabel(rest ? "휴식 종료" : "집중 종료")
      }
      .padding(.top, 14)
    }
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 22)
    .padding(.top, 26)
    .padding(.bottom, 28)
    .paper(.peach, radii: Wobble.l, tape: .center)
  }

  private var primaryLabel: String {
    guard let timer = model.timer else { return "집중 시작" }
    if timer.running { return "일시정지" }
    return timer.phase == .rest ? "휴식 시작" : "집중 재개"
  }
}

/// 토마토 성장: 3D 대신 도장이 진행에 맞춰 자라고 익는다.
struct TomatoGrowth: View {
  let progress: Double
  let running: Bool

  var body: some View {
    let p = max(0, min(1, progress))
    TomatoStamp(p < 0.34 ? .empty : p < 0.67 ? .plan : .filled, size: 50 + 60 * p)
      .scaleEffect(running ? 1 : 0.96)
      .animation(.easeInOut(duration: 0.6), value: p)
  }
}

/// 오늘 할 일 목록: 각 행에 재생 버튼
struct TodayList: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let tasks = model.todayTasks
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        SectionTitle(title: "오늘 할 일", count: model.pendingToday.count)
        Spacer()
        HStack(spacing: 4) {
          Text("예상").foregroundStyle(Palette.muted)
          PomoCount(value: "\(tasks.reduce(0) { $0 + $1.estimate })")
        }
        .font(.hand(TextSize.sm))
      }
      if tasks.isEmpty {
        EmptyNote(text: "오늘 예정된 할 일이 없습니다.")
      }
      ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
        let active = model.isCurrent(task)
        let playing = active && model.timer?.running == true
        HStack(spacing: 12) {
          Circ(content: task.done ? .check : .number(index + 1), state: task.done ? .ok : active ? .on : .idle)
          VStack(alignment: .leading, spacing: 4) {
            Text(task.title)
              .font(.hand(TextSize.md))
              .foregroundStyle(task.done ? Palette.inkSoft : Palette.ink)
              .strikethrough(task.done, color: Palette.strokeSoft)
              .lineLimit(1)
            Pomodoros(estimate: task.estimate, actual: model.used(task.id))
          }
          Spacer(minLength: 0)
          PlayButton(active: playing, label: "\(task.title) \(playing ? "일시정지" : "시작")") {
            model.play(task.id)
          }
          .disabled(task.done)
          .opacity(task.done ? 0.4 : 1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(minHeight: 56)
        .background {
          if active {
            WobbleShape(radii: Wobble.row).fill(Palette.peach)
            WobbleShape(radii: Wobble.row).strokeBorder(Palette.coralLight, lineWidth: 2)
          }
        }
        .opacity(task.done ? 0.7 : 1)
      }
    }
  }
}

/// 오늘 완료 포모도로
struct DailySummary: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let daily = model.doneOn(model.today)
    let capacity = model.settings.dailyCapacity
    HStack(spacing: 14) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(daily.pomodoroText).font(.hand(TextSize.h2))
        Text("포모도로").font(.hand(TextSize.sm))
      }
      .foregroundStyle(Palette.ink)
      Spacer(minLength: 0)
      FlowStamps(count: max(capacity, Int(daily.rounded(.up))), filled: Int(daily))
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 16)
    .paper(.butter, tape: .right, tapeColor: .green)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("오늘 완료 포모도로 \(daily.pomodoroText)")
  }
}

/// 줄이 넘치면 다음 줄로 넘기는 도장 묶음
struct FlowStamps: View {
  let count: Int
  let filled: Int
  var size: CGFloat = 18

  var body: some View {
    let columns = Array(repeating: GridItem(.fixed(size), spacing: 3), count: max(1, min(count, 8)))
    LazyVGrid(columns: columns, alignment: .trailing, spacing: 3) {
      ForEach(0..<count, id: \.self) { i in
        TomatoStamp(filled: i < filled, size: size)
      }
    }
    .fixedSize()
  }
}
