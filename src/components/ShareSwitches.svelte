<script lang="ts">
  import Icon from './Icon.svelte';
  import Switch from './parts/Switch.svelte';
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
      <Switch
        checked={value[key]}
        labelledby="{id}-{key}"
        disabled={disabled || (key === 'memo' && !value.tasks)}
        onchange={(next) => onchange(key, next)}
      />
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
</style>
