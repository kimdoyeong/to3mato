<script lang="ts">
  import { state as appState } from '../lib/client';
  import Icon from './Icon.svelte';
  import Tomato from './Tomato.svelte';
  import HandBar from './parts/HandBar.svelte';
  import ProjectCover from './ProjectCover.svelte';
  import DiaryView from './DiaryView.svelte';
  import { projectSummary } from '../lib/diary.mjs';
  import type { Project, Task } from '../lib/types';
  let {
    onedit,
    onadd,
    onproject,
    oneditproject,
    onlog,
    selected = $bindable<string | null>(null),
  }: {
    selected?: string | null;
    onedit: (task: Task) => void;
    onadd: (project: string) => void;
    onproject: () => void;
    oneditproject: (project: Project) => void;
    onlog: () => void;
  } = $props();
  let project = $derived($appState.projects.find((p) => p.id === selected));
</script>

{#if project}
  <DiaryView
    {project}
    {onedit}
    {onadd}
    {oneditproject}
    {onlog}
    onback={() => (selected = null)}
  />
{:else}
  <div class="project-grid">
    {#each $appState.projects as item, index (item.id)}
      {@const summary = projectSummary($appState, item.id)}
      <article
        class="project-card cover paper"
        class:alt={index % 2 === 1}
        class:tilt-a={index % 3 === 0}
        class:tilt-b={index % 3 === 1}
        class:tilt-c={index % 3 === 2}
      >
        <span class="tape {['pink', '', 'green'][index % 3]}" aria-hidden="true"
        ></span>
        <ProjectCover project={item} />
        <button class="cover-main" onclick={() => (selected = item.id)}>
          <span class="cover-title">
            <span class="project-symbol" style:color={item.color}
              ><Icon name={item.icon} /></span
            >
            <h2>{item.name}</h2>
          </span>
          {#if item.outcome}<span class="cover-outcome"
              ><span class="muted">결과물</span><span>{item.outcome}</span
              ></span
            >{/if}
          <span class="cover-stats">
            <span class="stat"
              ><small>티켓</small><b class="num">{summary.tickets}</b></span
            >
            <span class="stat"
              ><small>남은 할 일</small><b class="num">{summary.left}</b></span
            >
            <span class="stat"
              ><small>실제 사용</small><b class="num pomo-count"
                >{summary.used}<Tomato filled /></b
              ></span
            >
          </span>
          <HandBar
            value={summary.progress}
            color="var(--leaf)"
            label={`진행률 ${Math.round(summary.progress * 100)}%`}
          />
        </button>
        {#if summary.recent.length}
          <span class="peek-row" aria-hidden="true">
            {#each summary.recent as ticket, i (ticket.id)}<span
                class="peek"
                class:one={i === 0}
                class:two={i === 1}><Tomato filled /></span
              >{/each}
          </span>
        {/if}
      </article>{/each}
  </div>
  <button class="add-task btn-dash" onclick={onproject}
    ><Icon name="plus" />프로젝트 추가</button
  >
{/if}
