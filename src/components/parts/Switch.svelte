<script lang="ts">
  let {
    checked,
    labelledby,
    disabled = false,
    onchange,
  }: {
    checked: boolean;
    labelledby: string;
    disabled?: boolean;
    onchange: (next: boolean) => void;
  } = $props();
</script>

<button
  type="button"
  class="sw"
  role="switch"
  aria-checked={checked}
  aria-labelledby={labelledby}
  {disabled}
  onclick={() => onchange(!checked)}
></button>

<style>
  /* 스위치: 손그림 알약 + 토마토 손잡이 */
  .sw {
    position: relative;
    flex-shrink: 0;
    width: 50px;
    height: 28px;
    padding: 0;
    border: 2px solid var(--line-strong);
    border-radius: 15px 17px 14px 16px / 16px 14px 17px 15px;
    background: #fff;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .sw::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: var(--blob);
    background: var(--stroke-soft);
    transition: transform 0.18s;
  }
  .sw[aria-checked='true'] {
    background: var(--tomato);
    border-color: var(--red);
  }
  .sw[aria-checked='true']::after {
    transform: translateX(22px);
    background: #fff;
  }
  .sw:disabled {
    opacity: 0.4;
  }
  @media (prefers-reduced-motion: reduce) {
    .sw,
    .sw::after {
      transition: none;
    }
  }
</style>
