<script lang="ts">
  import { tick } from 'svelte';
  import { state as appState, send, message } from '../lib/client';
  import type { Ticket } from '../lib/types';
  import Tomato from './Tomato.svelte';
  let { project }: { project: string } = $props();
  let dialog: HTMLDialogElement;
  let name = $state(''),
    chosen = $state<string[]>([]),
    busy = $state(false),
    error = $state('');
  let tickets = $derived(
    $appState.tickets
      .filter((t) => t.projectId === project && !t.voided)
      .sort((a, b) => b.completedAt - a.completedAt),
  );
  export async function open() {
    name = '';
    chosen = tickets.slice(0, 6).map((t) => t.id);
    error = '';
    await tick();
    dialog.showModal();
    dialog.querySelector('input')?.focus();
  }
  function toggle(ticket: Ticket) {
    chosen = chosen.includes(ticket.id)
      ? chosen.filter((id) => id !== ticket.id)
      : [...chosen, ticket.id];
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    const success = await send('template:save', {
      name,
      steps: tickets
        .filter((t) => chosen.includes(t.id))
        .map((t) => ({ title: t.title, estimate: Math.min(2, t.estimate) })),
    });
    busy = false;
    if (success) dialog.close();
    else error = $message;
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="ticket-template-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <form onsubmit={save}>
    <div class="dialog-heading">
      <h2 id="ticket-template-title">템플릿으로 저장</h2>
      <button
        class="icon-button"
        type="button"
        aria-label="닫기"
        disabled={busy}
        onclick={() => dialog.close()}>✕</button
      >
    </div>
    <label
      >템플릿 이름<input
        bind:value={name}
        maxlength="80"
        required
        disabled={busy}
      /></label
    >
    <div class="ticket-template-list">
      {#each tickets as ticket (ticket.id)}
        <label class="ticket-choice"
          ><input
            type="checkbox"
            checked={chosen.includes(ticket.id)}
            disabled={busy ||
              (!chosen.includes(ticket.id) && chosen.length >= 6)}
            onchange={() => toggle(ticket)}
          /><span>{ticket.title}</span><span class="pomo-count"
            >{Math.min(2, ticket.estimate)}<Tomato filled /></span
          ></label
        >
      {/each}
    </div>
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <div class="dialog-footer">
      <button
        class="primary"
        type="submit"
        disabled={busy || !chosen.length || !name.trim()}>저장</button
      >
    </div>
  </form>
</dialog>
