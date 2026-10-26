<script lang="ts">
  import Icon from './Icon.svelte';
  import { send, notify } from '../lib/client';
  let {
    date,
    label,
    project = '',
  }: { date: string; label: string; project?: string } = $props();
  let title = $state(''),
    busy = $state(false);
  let input: HTMLInputElement;
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      notify('할 일 이름을 입력하세요.');
      input.focus();
      return;
    }
    busy = true;
    const success = await send('task:save', {
      title,
      estimate: 1,
      date,
      project,
    });
    busy = false;
    if (success) {
      title = '';
      notify('할 일을 추가했습니다.');
      input.focus();
    }
  }
</script>

<form class="quick" onsubmit={submit}>
  <Icon name="plus" />
  <input
    class="qinput"
    bind:this={input}
    bind:value={title}
    placeholder="예: 강의 수강 및 정리"
    aria-label="할 일 이름"
    maxlength="120"
    autocomplete="off"
    disabled={busy}
  />
  <button type="button" class="btn-line" disabled>템플릿</button>
  <button
    type="submit"
    class="btn-line"
    disabled={busy}
    aria-label={`${label} 할 일 추가`}>할 일 추가</button
  >
</form>
