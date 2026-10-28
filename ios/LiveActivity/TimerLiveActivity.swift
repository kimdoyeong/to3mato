import ActivityKit
import SwiftUI
import WidgetKit

@main
struct To3matoLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    TimerLiveActivity()
  }
}

/// 집중·휴식 동안 잠금 화면과 Dynamic Island에 남은 시간을 보여준다.
struct TimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TimerActivityAttributes.self) { context in
      LockScreenView(state: context.isStale ? context.state.expired : context.state)
        .activitySystemActionForegroundColor(LiveTomato.red)
    } dynamicIsland: { context in
      let state = context.isStale ? context.state.expired : context.state
      let controls = !context.isStale && state.phase != .checkin
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            LiveTomato(filled: state.phase != .rest, size: 28)
            Text(state.status)
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ClockText(state: state)
            .font(.title2.monospacedDigit().weight(.semibold))
            .foregroundStyle(state.phase == .rest ? .green : LiveTomato.red)
            .frame(width: 84, alignment: .trailing)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
              Text(state.title)
                .font(.headline)
                .lineLimit(1)
              ProgressBar(state: state)
            }
            if controls {
              Controls(state: state)
            }
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        LiveTomato(filled: state.phase != .rest, size: 18)
      } compactTrailing: {
        ClockText(state: state)
          .font(.caption.monospacedDigit().weight(.semibold))
          .foregroundStyle(state.phase == .rest ? .green : LiveTomato.red)
          .frame(width: 44, alignment: .trailing)
      } minimal: {
        LiveTomato(filled: state.phase != .rest, size: 18)
      }
      .keylineTint(LiveTomato.red)
    }
  }
}

/// 잠금 화면: 할 일 제목, 남은 시간, 토마토 진행
private struct LockScreenView: View {
  let state: TimerActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 12) {
        LiveTomato(filled: state.phase != .rest, size: 34)
        VStack(alignment: .leading, spacing: 2) {
          Text(state.status)
            .font(.caption)
            .foregroundStyle(.secondary)
          Text(state.title)
            .font(.headline)
            .lineLimit(1)
        }
        Spacer(minLength: 8)
        ClockText(state: state)
          .font(.system(size: 34, weight: .semibold).monospacedDigit())
          .foregroundStyle(state.phase == .rest ? .green : LiveTomato.red)
          .frame(width: 104, alignment: .trailing)
      }
      ProgressBar(state: state)
      if state.phase == .focus, state.estimate > 0 {
        HStack(spacing: 3) {
          ForEach(0..<min(6, state.estimate), id: \.self) { i in
            LiveTomato(filled: Double(i) < state.used.rounded(.down), size: 16)
          }
          Text("\(pomodoroText(state.used)) / \(state.estimate)")
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            .padding(.leading, 4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("예상 \(state.estimate)포모도로 / 기록 \(pomodoroText(state.used))포모도로")
      }
    }
    .padding(16)
  }

  private func pomodoroText(_ value: Double) -> String {
    value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
  }
}

/// 진행 중이면 시스템이 종료 시각까지 세고, 멈춰 있으면 남은 시간을 그대로 둔다.
private struct ClockText: View {
  let state: TimerActivityAttributes.ContentState

  var body: some View {
    Group {
      if state.running, state.endsAt > state.startedAt {
        Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
      } else {
        Text(state.clock)
      }
    }
    .multilineTextAlignment(.trailing)
  }
}

private struct ProgressBar: View {
  let state: TimerActivityAttributes.ContentState

  var body: some View {
    let tint = state.phase == .rest ? Color.green : LiveTomato.red
    Group {
      if state.running, state.endsAt > state.startedAt {
        ProgressView(timerInterval: state.startedAt...state.endsAt, countsDown: false) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
      } else {
        ProgressView(value: state.progress)
      }
    }
    .progressViewStyle(.linear)
    .tint(tint)
    .labelsHidden()
  }
}

/// Dynamic Island의 일시정지·재개, 종료. Mac 액션 버튼과 같은 명령이다.
private struct Controls: View {
  let state: TimerActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 8) {
      Button(intent: ToggleTimerIntent()) {
        Image(systemName: state.running ? "pause.fill" : "play.fill")
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 44, height: 44)
          .background(LiveTomato.red, in: Circle())
          .foregroundStyle(.white)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(state.running ? "일시정지" : state.phase == .rest ? "휴식 시작" : "집중 재개")

      Button(intent: EndTimerIntent()) {
        Image(systemName: state.phase == .rest ? "chevron.right" : "stop.fill")
          .font(.system(size: 15, weight: .semibold))
          .frame(width: 44, height: 44)
          .background(.white.opacity(0.18), in: Circle())
          .foregroundStyle(.white)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(state.phase == .rest ? "휴식 종료" : "집중 종료")
    }
  }
}
