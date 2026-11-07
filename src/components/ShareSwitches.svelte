<script lang="ts">
  import Icon from './Icon.svelte';
  import { COPY } from '../lib/share-copy';
  import type { Visibility } from '../lib/types';
  let {
    value,
    id,
    disabled = false,
    onchange,
  }: {
    value: Visibility;
    id: string;
    disabled?: boolean;
    onchange: (key: keyof Visibility, next: boolean) => void;
  } = $props();
  const rows: Array<[keyof Visibility, string]> = [
    ['video', COPY.video],
    ['focus', COPY.focus],
    ['projects', COPY.projects],
    ['tasks', COPY.tasks],
    ['memo', COPY.memo],
  ];
</script>

<ul class="share-list">
  <li class="share-row fixed">
    <span>{COPY.grass}</span><Icon name="lock" />
  </li>
  <li class="share-row fixed">
    <span>{COPY.todayCount}</span><Icon name="lock" />
  </li>
  {#each rows as [key, label] (key)}
    <li class="share-row" class:sub={key === 'memo'}>
      <span id="{id}-{key}">{label}</span>
      <button
        type="button"
        class="sw"
        role="switch"
        aria-checked={value[key]}
        aria-labelledby="{id}-{key}"
        disabled={disabled || (key === 'memo' && !value.tasks)}
        onclick={() => onchange(key, !value[key])}
      ></button>
    </li>
  {/each}
</ul>

<style>
  .share-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .share-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 46px;
    padding: 6px 0;
    font-size: var(--text-md);
    border-top: 2px dashed var(--line);
  }
  .share-row:first-child {
    border-top: 0;
  }
  .share-row.fixed + .share-row:not(.fixed) {
    border-top: 2px solid var(--line);
    margin-top: 6px;
    padding-top: 12px;
  }
  .share-row.fixed :global(.icon) {
    color: var(--ink-hint);
    width: 20px;
    height: 20px;
    margin-right: 13px;
  }
  .share-row.sub {
    padding-left: 22px;
    position: relative;
  }
  .share-row.sub::before {
    content: '';
    position: absolute;
    left: 6px;
    top: 6px;
    width: 10px;
    height: 20px;
    border-left: 2px solid var(--line-strong);
    border-bottom: 2px solid var(--line-strong);
    border-radius: 0 0 0 8px;
  }
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
