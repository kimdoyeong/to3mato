<script lang="ts">
  import { state as appState, send, notify, message } from '../lib/client';
  import { deliveries } from '../lib/deliveries';
  import { listClips, logRevision, type ClipSummary } from '../lib/focus-log';
  import { projectSummary, ticketWeeks, clipIdFor } from '../lib/diary.mjs';
  import { TICKET_STICKERS } from '../lib/domain.mjs';
  import Icon from './Icon.svelte';
  import Tomato from './Tomato.svelte';
  import TaskList from './TaskList.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import Ticket from './Ticket.svelte';
  import ProjectCover from './ProjectCover.svelte';
  import HandBar from './parts/HandBar.svelte';
  import type { Project, Task, Ticket as TicketRow } from '../lib/types';
  let {
    project,
    onedit,
    onadd,
    onback,
    oneditproject,
    onlog,
  }: {
    project: Project;
    onedit: (task: Task) => void;
    onadd: (project: string) => void;
    onback: () => void;
    oneditproject: (project: Project) => void;
    onlog: () => void;
  } = $props();
  let summary = $derived(projectSummary($appState, project.id));
  let open = $derived(
    $appState.tasks.filter((t) => t.project === project.id && !t.done),
  );
  let weeks = $derived(
    ticketWeeks($appState.tickets.filter((t) => t.projectId === project.id)),
  );
  let deliveryIds = $derived(new Set($deliveries.map((d) => d.id)));
  // Thumbnails of the 3-second clips recorded while the task was in focus.
  let clips = $state<ClipSummary[]>([]);
  let urls = $state<Record<string, string>>({});
  $effect(() => {
    $logRevision;
    let active = true;
    listClips()
      .then((value) => {
        if (active) clips = value;
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  });
  $effect(() => {
    const next: Record<string, string> = {};
    const ids = clips.map((c) => c.id);
    for (const week of weeks)
      for (const ticket of week.tickets) {
        const id = clipIdFor(ticket, ids);
        const clip = id && clips.find((c) => c.id === id);
        if (clip) next[ticket.id] = URL.createObjectURL(clip.thumbnail);
      }
    urls = next;
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  });
  let selected = $state<string | null>(null);
  let selectedTicket = $derived(
    $appState.tickets.find((t) => t.id === selected) ?? null,
  );
  let note = $state('');
  function select(ticket: TicketRow) {
    selected = selected === ticket.id ? null : ticket.id;
    note = ticket.note;
  }
  async function decorate(payload: Record<string, unknown>) {
    if (!selectedTicket) return;
    await send('ticket:update', { id: selectedTicket.id, ...payload });
  }
  let deleteDialog: HTMLDialogElement;
  let deleting = $state(false);
  let deleteError = $state('');
  async function deleteProject() {
    if (deleting) return;
    deleting = true;
    const success = await send('project:delete', { id: project.id });
    deleting = false;
    if (success) {
      deleteDialog.close();
      onback();
    } else deleteError = $message || '삭제하지 못했습니다. 다시 시도하세요.';
  }
  const stickerLabel: Record<string, string> = {
    '': '없음',
    star: '별',
    heart: '하트',
    leaf: '잎',
  };
</script>

<button class="back-button" onclick={onback}
  ><Icon name="back" />모든 프로젝트</button
>
<header class="diary-head paper peach tilt-c">
  <span class="tape l pink" aria-hidden="true"></span>
  <div class="diary-cover"><ProjectCover {project} /></div>
  <div class="diary-title">
    <div class="intro">
      <div>
        <h1>{project.name}</h1>
        <p class="diary-outcome">
          <span class="muted">결과물</span>
          {#if project.outcome}<span class="hl">{project.outcome}</span
            >{:else}<span class="muted">없음</span>{/if}
        </p>
      </div>
      <div class="diary-actions">
        <button class="text-button" onclick={() => oneditproject(project)}
          >프로젝트 수정</button
        >
        <button
          class="text-button"
          onclick={() => {
            deleteError = '';
            deleteDialog.showModal();
          }}>프로젝트 삭제</button
        >
      </div>
    </div>
    <div class="diary-stats">
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
      <HandBar
        value={summary.progress}
        color="var(--leaf)"
        label={`진행률 ${Math.round(summary.progress * 100)}%`}
        class="diary-bar"
      />
    </div>
  </div>
</header>

<section class="diary-section" aria-labelledby="left-heading">
  <h2 id="left-heading" class="wave">
    남은 할 일 <span class="badge">{open.length}</span>
  </h2>
  {#if open.length}<TaskList tasks={open} {onedit} />{/if}
  <QuickAdd date="" label={project.name} project={project.id} />
  <button class="add-task btn-dash" onclick={() => onadd(project.id)}
    ><Icon name="plus" />할 일 추가</button
  >
</section>

<section class="diary-section" aria-labelledby="ticket-heading">
  <h2 id="ticket-heading" class="wave">
    티켓 <span class="badge">{summary.tickets}</span>
  </h2>
  {#each weeks as week (week.id)}
    <div class="divider">
      <hr />
      <span class="sticker-date">{week.label}</span>
      <hr />
    </div>
    {#if deliveryIds.has(week.id)}
      <div class="film tilt-c">
        <span class="frames" aria-hidden="true"
          ><span></span><span></span><span></span><span></span></span
        >
        <span class="film-label">{week.label}</span>
        <button class="btn-line" onclick={onlog}>영상 편지 보기</button>
      </div>
    {/if}
    <div class="ticket-grid">
      {#each week.tickets as ticket, i (ticket.id)}
        <div class="ticket-slot">
          <Ticket
            {ticket}
            project={{ name: project.name, color: project.color }}
            thumbnail={urls[ticket.id] ?? ''}
            tilt={i % 2 ? 'b' : 'a'}
            tape={['pink', '', 'green'][i % 3] as '' | 'pink' | 'green'}
            onselect={select}
          />
          {#if selected === ticket.id && selectedTicket}
            <div
              class="ticket-tools paper alt"
              role="group"
              aria-label="티켓 꾸미기"
            >
              <button
                class="btn-line"
                class:pressed={selectedTicket.highlight}
                aria-pressed={selectedTicket.highlight}
                onclick={() =>
                  decorate({ highlight: !selectedTicket!.highlight })}
                >형광펜</button
              >
              <span class="sticker-pick" role="group" aria-label="스티커">
                {#each TICKET_STICKERS as sticker (sticker)}
                  <button
                    class="step"
                    class:on={selectedTicket.sticker === sticker}
                    aria-pressed={selectedTicket.sticker === sticker}
                    aria-label={`스티커 ${stickerLabel[sticker]}`}
                    onclick={() => decorate({ sticker })}
                    >{#if sticker}<Icon name={sticker} />{:else}<Icon
                        name="close"
                      />{/if}</button
                  >
                {/each}
              </span>
              <input
                class="note-input"
                type="text"
                maxlength="200"
                aria-label="메모"
                placeholder="메모"
                bind:value={note}
                onchange={() => decorate({ note })}
              />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">발권된 티켓이 없습니다.</div>
  {/each}
</section>

<dialog
  bind:this={deleteDialog}
  aria-labelledby="delete-project-title"
  oncancel={(event) => {
    if (deleting) event.preventDefault();
  }}
>
  <div class="dialog-heading">
    <h2 id="delete-project-title">프로젝트 삭제</h2>
  </div>
  <p>{project.name}</p>
  {#if deleteError}<p class="form-error" role="alert">{deleteError}</p>{/if}
  <div class="dialog-footer">
    <button
      class="text-button"
      disabled={deleting}
      onclick={() => deleteDialog.close()}>취소</button
    >
    <button class="primary" disabled={deleting} onclick={deleteProject}
      >삭제</button
    >
  </div>
</dialog>
