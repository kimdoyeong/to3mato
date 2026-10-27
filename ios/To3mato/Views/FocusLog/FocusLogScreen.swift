import SwiftUI

/// 집중 로그: 주 이동, 이번 주 섬, 영상 편지, 클립 목록
struct FocusLogScreen: View {
  @Environment(AppModel.self) private var model
  @State private var week = 0

  var body: some View {
    let start = Day.calendar.date(byAdding: .day, value: week * 7, to: Day.weekStart(model.now)) ?? model.now
    let end = Day.calendar.date(byAdding: .day, value: 7, to: start) ?? start
    let last = end.addingTimeInterval(-1)
    let clips = model.clips.filter { $0.at >= start && $0.at < end }
    let records = model.records.filter { $0.at >= start && $0.at < end }
    let days = Set(clips.map { Day.key($0.at) }).count

    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          Text("집중 완료 후 촬영한 3초 영상을 주별로 모읍니다.")
            .font(.hand(TextSize.base))
            .foregroundStyle(Palette.muted)

          DeliveryInbox()

          HStack {
            Button {
              week -= 1
            } label: {
              Image(systemName: "chevron.left")
            }
            .accessibilityLabel("이전 기록 주")
            Spacer()
            DisplayText("\(Day.short(start)) — \(Day.short(last))", size: TextSize.lg)
            Spacer()
            Button {
              week += 1
            } label: {
              Image(systemName: "chevron.right")
            }
            .disabled(week >= 0)
            .accessibilityLabel("다음 기록 주")
          }
          .buttonStyle(TextButtonStyle())

          HStack {
            Text("\(days)일 · 영상 \(clips.count)개 · \(clips.count * 3)초")
              .font(.hand(TextSize.sm))
              .foregroundStyle(Palette.muted)
            Spacer()
            if week != 0 {
              Button("이번 주") { week = 0 }
                .buttonStyle(TextButtonStyle(size: TextSize.sm))
            }
          }

          ForestIsland(pomodoros: records.reduce(0) { $0 + $1.pomodoros })

          if clips.isEmpty {
            VStack(spacing: 8) {
              Text("✳").font(.system(size: 28)).foregroundStyle(Palette.red)
              DisplayText("이번 주 기록 없음", size: TextSize.xl)
              Text("집중 타이머가 끝나면 촬영할 수 있습니다.")
                .font(.hand(TextSize.sm))
                .foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 26)
          } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 18) {
              ForEach(clips) { MomentCard(clip: $0) }
            }
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
      }
      .readableWidth()
      .background(DotBackground())
      .navigationTitle("집중 로그")
      .navigationBarTitleDisplayMode(.inline)
    }
  }
}

/// 영상 편지함: 배달 일정, 배달된 편지
private struct DeliveryInbox: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(alignment: .top, spacing: 13) {
        Image(systemName: "envelope").font(.system(size: 26)).foregroundStyle(Palette.red).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 6) {
          Text("매주 월요일 오전 9시 배달").font(.hand(TextSize.lg)).foregroundStyle(Palette.ink)
          Text("지난주 월요일부터 일요일까지 촬영한 영상을 한 편으로 만듭니다.\n앱이 꺼져 있었다면 다음 실행 시 만듭니다.")
            .font(.hand(TextSize.sm))
            .foregroundStyle(Palette.muted)
            .lineSpacing(3)
        }
      }

      if model.deliveries.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          Text("다음 배달").font(.hand(TextSize.md)).foregroundStyle(Palette.ink)
          let next = Day.calendar.date(byAdding: .day, value: 7, to: Day.weekStart(model.now)) ?? model.now
          Text("\(Day.short(next)) 월요일 오전 9시").font(.hand(TextSize.sm)).foregroundStyle(Palette.muted)
        }
      }

      ForEach(model.deliveries) { delivery in
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            DisplayText("배달왔어요 🍅", size: TextSize.xl)
            Spacer()
            if !delivery.seen {
              Text("NEW")
                .font(.hand(TextSize.xs))
                .foregroundStyle(Palette.red)
                .padding(8)
                .overlay(Circle().strokeBorder(Palette.red, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2])))
                .rotationEffect(.degrees(-10))
            }
          }
          Text(
            "\(Day.short(delivery.start)) — \(Day.short(delivery.end.addingTimeInterval(-1)))\n영상 \(delivery.clipCount)개 · \(Int((delivery.duration / 1000).rounded()))초"
          )
          .font(.hand(TextSize.sm))
          .foregroundStyle(Palette.muted)
          .lineSpacing(3)
          Button("영상 편지 보기") {
            if let index = model.deliveries.firstIndex(where: { $0.id == delivery.id }) {
              model.deliveries[index].seen = true
            }
          }
          .buttonStyle(PrimaryButtonStyle())
        }
        .padding(22)
        .background(Color(hex: 0xfff8e9), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(hex: 0xdfc9a9), lineWidth: 1))
      }
    }
  }
}

/// 이번 주 숲 섬: 3D 대신 섬 위에 집중한 만큼 토마토를 심는다.
private struct ForestIsland: View {
  let pomodoros: Double

  var body: some View {
    let count = Int(pomodoros.rounded(.up))
    ZStack {
      Ellipse().fill(Palette.kraftDeep).offset(y: 10)
      Ellipse().fill(Palette.leafLight)
      Ellipse().strokeBorder(Palette.leaf.opacity(0.35), lineWidth: 2)
      FlowLayout(spacing: 4) {
        ForEach(0..<count, id: \.self) { i in
          TomatoStamp(filled: Double(i) < pomodoros.rounded(.down), size: 24)
        }
      }
      .frame(maxWidth: 200)
      .offset(y: -4)
    }
    .frame(width: 280, height: 96)
    .padding(.bottom, 10)
    .frame(maxWidth: .infinity)
    .accessibilityHidden(true)
  }
}

/// 3초 영상 카드: 썸네일, 날짜와 시각, 할 일 제목, 삭제
private struct MomentCard: View {
  @Environment(AppModel.self) private var model
  let clip: Clip
  @State private var confirming = false

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ZStack {
        RoundedRectangle(cornerRadius: 10).fill(Palette.kraft)
        Mascot(size: 44).opacity(0.5)
        Text("▷").font(.system(size: 22)).foregroundStyle(.white)
      }
      .aspectRatio(3 / 4, contentMode: .fit)
      .accessibilityElement()
      .accessibilityLabel("\(clip.taskTitle) 영상 보기")
      .accessibilityAddTraits(.isButton)

      Text("\(Day.format(clip.at, "MdEEE")) · \(Day.format(clip.at, "jjmm"))")
        .font(.hand(TextSize.xs))
        .foregroundStyle(Palette.muted)
      Text(clip.taskTitle).font(.hand(TextSize.base)).foregroundStyle(Palette.ink).lineLimit(2)
      Button("삭제") { confirming = true }
        .buttonStyle(TextButtonStyle(size: TextSize.sm))
        .accessibilityLabel("\(clip.taskTitle) 영상 삭제")
    }
    .padding(10)
    .paper(radii: Wobble.s)
    .confirmationDialog("이 영상을 삭제합니다. 삭제한 영상은 복구할 수 없습니다.", isPresented: $confirming, titleVisibility: .visible) {
      Button("삭제", role: .destructive) {
        model.clips.removeAll { $0.id == clip.id }
        model.notify("영상을 삭제했습니다.")
      }
      Button("취소", role: .cancel) {}
    }
  }
}
