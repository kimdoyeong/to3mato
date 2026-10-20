<script lang="ts">
  let {
    phase = 'idle',
    paused = false,
  }: {
    phase?: 'idle' | 'focus' | 'rest';
    paused?: boolean;
  } = $props();
</script>

<div
  class="tomato-illustration"
  class:paused
  data-phase={phase}
  aria-hidden="true"
>
  <svg viewBox="-18 -20 176 154">
    <ellipse class="shadow" cx="70" cy="120" rx="38" ry="5" fill="#4a3128" />
    <g
      class="sparkles"
      fill="none"
      stroke="#db9a45"
      stroke-width="2.5"
      stroke-linecap="round"
    >
      <path class="spark sparkle-left" d="M1 40v10m-5-5H6" />
      <path class="spark sparkle-right" d="M139 22v12m-6-6h12" />
      <circle class="spark sparkle-dot" cx="137" cy="87" r="3" />
    </g>
    <g class="hop">
      <g class="body">
        <path
          d="M70 32C52 20 14 27 12 67c-2 32 26 50 58 50s60-18 58-50c-2-40-40-47-58-35Z"
          fill="#ef5b43"
        />
        <path
          d="M70 32C52 20 14 27 12 67c-1 12 3 22 10 31 6-34 28-58 48-66Z"
          fill="#f8765f"
          opacity=".55"
        />
        <path
          d="M29 54c-3 8-3 15 0 22"
          stroke="#ffb5a5"
          stroke-width="7"
          stroke-linecap="round"
          fill="none"
        />
        <g class="leaves">
          <path
            d="M70 40 51 43l9-11-17-7 19-3-4-13 12 10 11-10-4 13 19 3-17 7 9 11Z"
            fill="#69a84f"
          />
          <path
            d="M70 32c0-9 1-15 7-20"
            stroke="#4d8a3a"
            stroke-width="5"
            stroke-linecap="round"
            fill="none"
          />
        </g>
        <g class="face">
          <g class="open-eyes">
            <g class="eye">
              <ellipse cx="49" cy="76" rx="5" ry="6" fill="#4a3128" />
              <circle cx="51" cy="73.5" r="1.8" fill="#fff" />
            </g>
            <g class="eye">
              <ellipse cx="91" cy="76" rx="5" ry="6" fill="#4a3128" />
              <circle cx="93" cy="73.5" r="1.8" fill="#fff" />
            </g>
          </g>
          <path
            class="rest-eyes"
            d="M44 76q5 6 10 0m32 0q5 6 10 0"
            fill="none"
            stroke="#4a3128"
            stroke-width="3"
            stroke-linecap="round"
          />
          <ellipse
            cx="36"
            cy="88"
            rx="9"
            ry="5.5"
            fill="#ff8f7d"
            opacity=".75"
          />
          <ellipse
            cx="104"
            cy="88"
            rx="9"
            ry="5.5"
            fill="#ff8f7d"
            opacity=".75"
          />
          <path
            d="M62 87q8 10 16 0"
            fill="none"
            stroke="#4a3128"
            stroke-width="3"
            stroke-linecap="round"
          />
        </g>
      </g>
    </g>
  </svg>
</div>

<style>
  .tomato-illustration {
    width: 154px;
    height: 135px;
    margin: 0 auto 8px;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .body,
  .hop,
  .leaves,
  .face,
  .shadow {
    transform-box: view-box;
    transform-origin: 70px 117px;
  }
  .body {
    animation: idle 4.8s ease-in-out infinite;
  }
  .leaves {
    transform-origin: 70px 34px;
    animation: leaf-sway 4.8s ease-in-out infinite;
  }
  .face {
    transform-origin: 70px 80px;
    animation: look-around 9s ease-in-out infinite;
  }
  .eye {
    transform-box: fill-box;
    transform-origin: center;
    animation: blink 5.4s infinite;
  }
  .shadow {
    opacity: 0.09;
    animation: shadow-breathe 4.8s ease-in-out infinite;
  }
  .spark {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
  }
  .rest-eyes {
    display: none;
  }

  [data-phase='focus'] .hop {
    animation: hop 2.4s infinite;
  }
  [data-phase='focus'] .body {
    animation: squash 2.4s infinite;
  }
  [data-phase='focus'] .leaves {
    animation: leaf-bounce 2.4s infinite;
  }
  [data-phase='focus'] .shadow {
    animation: hop-shadow 2.4s infinite;
  }
  [data-phase='focus'] .spark {
    animation: sparkle 2.4s ease-out infinite;
  }
  [data-phase='focus'] .sparkle-right {
    animation-delay: 0.15s;
  }
  [data-phase='focus'] .sparkle-dot {
    animation-delay: 0.3s;
  }
  [data-phase='rest'] .body {
    animation: rest-sway 5s ease-in-out infinite;
  }
  [data-phase='rest'] .leaves {
    animation-duration: 5s;
  }
  [data-phase='rest'] .face {
    animation: none;
  }
  [data-phase='rest'] .open-eyes {
    display: none;
  }
  [data-phase='rest'] .rest-eyes {
    display: inline;
  }
  .tomato-illustration.paused svg * {
    animation-play-state: paused;
  }
  .tomato-illustration.paused .spark {
    opacity: 0;
  }

  @keyframes idle {
    0%,
    100% {
      transform: translateY(0) rotate(-2deg) scale(1, 1);
    }
    50% {
      transform: translateY(-3px) rotate(2deg) scale(1.025, 0.98);
    }
  }
  @keyframes hop {
    0%,
    18%,
    62%,
    100% {
      transform: translateY(0);
    }
    34% {
      transform: translateY(-17px);
      animation-timing-function: ease-out;
    }
    42% {
      transform: translateY(-20px);
      animation-timing-function: ease-in;
    }
    56% {
      transform: translateY(0);
    }
  }
  @keyframes squash {
    0%,
    12%,
    76%,
    100% {
      transform: scale(1) rotate(0);
    }
    22% {
      transform: scale(1.12, 0.87) rotate(-3deg);
    }
    33% {
      transform: scale(0.93, 1.08) rotate(-5deg);
    }
    44% {
      transform: scale(1.02, 0.98) rotate(4deg);
    }
    56% {
      transform: scale(1.14, 0.85) rotate(2deg);
    }
    65% {
      transform: scale(0.97, 1.035) rotate(-1deg);
    }
  }
  @keyframes leaf-sway {
    0%,
    100% {
      transform: rotate(-5deg);
    }
    50% {
      transform: rotate(7deg);
    }
  }
  @keyframes leaf-bounce {
    0%,
    12%,
    85%,
    100% {
      transform: rotate(0);
    }
    24% {
      transform: rotate(-12deg) scale(1.05, 0.92);
    }
    40% {
      transform: rotate(12deg);
    }
    58% {
      transform: rotate(-14deg) scale(1.08, 0.9);
    }
    70% {
      transform: rotate(7deg);
    }
  }
  @keyframes look-around {
    0%,
    20%,
    70%,
    100% {
      transform: translateX(0);
    }
    30%,
    42% {
      transform: translateX(2px) rotate(2deg);
    }
    50%,
    60% {
      transform: translateX(-2px) rotate(-2deg);
    }
  }
  @keyframes blink {
    0%,
    39%,
    43%,
    46%,
    50%,
    100% {
      transform: scaleY(1);
    }
    41%,
    48% {
      transform: scaleY(0.08);
    }
  }
  @keyframes shadow-breathe {
    0%,
    100% {
      transform: scaleX(1);
    }
    50% {
      transform: scaleX(0.92);
    }
  }
  @keyframes hop-shadow {
    0%,
    15%,
    76%,
    100% {
      transform: scaleX(1);
      opacity: 0.09;
    }
    22%,
    56% {
      transform: scaleX(1.15);
      opacity: 0.12;
    }
    40% {
      transform: scaleX(0.68);
      opacity: 0.045;
    }
  }
  @keyframes sparkle {
    0%,
    26%,
    68%,
    100% {
      opacity: 0;
      transform: translateY(3px) scale(0.5) rotate(-15deg);
    }
    39% {
      opacity: 0.85;
      transform: translateY(-3px) scale(1) rotate(0);
    }
    60% {
      opacity: 0;
      transform: translateY(-10px) scale(0.65) rotate(15deg);
    }
  }
  @keyframes rest-sway {
    0%,
    100% {
      transform: rotate(-4deg) scale(1.025, 0.98);
    }
    50% {
      transform: rotate(4deg) translateY(-3px) scale(0.99, 1.02);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    svg * {
      animation: none !important;
    }
    .spark {
      opacity: 0;
    }
  }
</style>
