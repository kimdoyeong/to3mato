<script lang="ts">
  import Tomato from './Tomato.svelte';
  import Icon from './Icon.svelte';
  import type { Ticket } from '../lib/types';
  let {
    ticket,
    project = null,
    thumbnail = '',
    tilt = 'a',
    tape = '',
    onselect,
  }: {
    ticket: Ticket;
    project?: { name: string; color: string } | null;
    /** Object URL of the 3-second clip thumbnail, when one exists. */
    thumbnail?: string;
    tilt?: 'a' | 'b';
    tape?: '' | 'pink' | 'green';
    onselect?: (ticket: Ticket) => void;
  } = $props();
  const time = $derived(
    new Date(ticket.completedAt).toLocaleString('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );
  const stamp = $derived(
    `${new Date(ticket.completedAt).getMonth() + 1}.${new Date(ticket.completedAt).getDate()}`,
  );
  const slots = $derived(
    Math.min(6, Math.max(ticket.estimate, Math.ceil(ticket.used))),
  );
</script>

<article
  class="ticket tilt-big-{tilt}"
  class:voided={ticket.voided}
  class:highlighted={ticket.highlight}
  aria-label={`티켓 ${ticket.title}`}
>
  <span class="tape l {tape}" aria-hidden="true"></span>
  {#if ticket.sticker}<span class="sticker" aria-hidden="true"
      ><Icon name={ticket.sticker} /></span
    >{/if}
  <div class="stub">
    <span
      class="tomatoes"
      aria-label={`처음 예상 ${ticket.estimate}, 실제 사용 ${ticket.used}`}
      >{#each Array(slots) as _, i (i)}<Tomato
          filled={i < Math.floor(ticket.used)}
        />{/each}</span
    >
    <span class="num muted">{ticket.used} / {ticket.estimate}</span>
  </div>
  <span class="notch t"></span><span class="notch b"></span>
  <button
    class="ticket-body"
    onclick={() => onselect?.(ticket)}
    aria-label={`${ticket.title} 티켓 꾸미기`}
  >
    <span class="ticket-title" class:hl={ticket.highlight}>{ticket.title}</span>
    <span class="ticket-meta">
      {#if project}<span class="chip"
          ><i class="project-dot" style:background={project.color}
          ></i>{project.name}</span
        >{/if}
      <span class="muted">{time}</span>
    </span>
    {#if ticket.note}<span class="ticket-note">{ticket.note}</span>{/if}
  </button>
  {#if thumbnail}<img class="thumb" src={thumbnail} alt="3초 영상" />{/if}
  <div class="datestamp" aria-hidden="true">
    {stamp}<br />{ticket.voided ? '취소' : '완료'}
  </div>
</article>
