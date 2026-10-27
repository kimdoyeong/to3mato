import SwiftUI

/// 하단 타이머 바: 두 줄 높이의 유리 바.
/// 왼쪽부터 현재 할 일 제목, 남은 시간, 재생·일시정지, 종료.
/// 집중 중에는 --peach-panel, 휴식 중에는 --green-light 종이 위에 유리를 올린다.
struct TimerBar: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let timer = model.timer
    let rest = timer?.phase == .rest
    let title = rest ? "휴식" : (model.timerTask ?? model.pendingToday.first)?.title ?? ""

    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(model.timerStatus)
          .font(.caption)
          .foregroundStyle(.secondary)
        Text(title)
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      if timer != nil {
        Text(model.clock)
          .font(.title3.monospacedDigit().weight(.medium))
          .accessibilityLabel("남은 시간 \(model.clock)")
      }

      GlassIconButton(
        systemImage: timer?.running == true ? "pause.fill" : "play.fill",
        label: playLabel, prominent: true
      ) {
        if timer?.phase == .checkin {
          model.runSheetOpen = true
        } else {
          model.toggleTimer()
        }
      }
      .disabled(timer == nil && model.pendingToday.isEmpty)

      if timer != nil {
        Button {
          model.endTimer()
        } label: {
          Image(systemName: rest ? "chevron.right" : "stop.fill")
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 36, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(rest ? "휴식 종료" : "집중 종료")
      }
    }
    .foregroundStyle(Palette.ink)
    .padding(.leading, 20)
    .padding(.trailing, 8)
    .padding(.vertical, 8)
    .frame(minHeight: 64)
    .contentShape(Capsule())
    .glassSurface(Capsule(), paper: paper)
    .glassGroup()
    .onTapGesture { model.runSheetOpen = true }
    .gesture(
      DragGesture(minimumDistance: 12).onEnded { value in
        if value.translation.height < -20 { model.runSheetOpen = true }
      }
    )
    .animation(.snappy, value: model.timer?.phase)
  }

  private var paper: Color? {
    guard let timer = model.timer else { return nil }
    return timer.phase == .rest ? Palette.greenLight : Palette.peachPanel
  }

  private var playLabel: String {
    guard let timer = model.timer else { return "집중 시작" }
    if timer.running { return "일시정지" }
    return timer.phase == .rest ? "휴식 시작" : "집중 재개"
  }
}
