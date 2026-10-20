<script lang="ts">
  import { state as appState, send, message } from '../lib/client';
  import Icon from './Icon.svelte';
  import Tomato from './Tomato.svelte';
  import TaskList from './TaskList.svelte';
  import type { Task } from '../lib/types';
  let {
    onedit,
    onadd,
    onproject,
    selected = $bindable<string | null>(null),
  }: {
    selected?: string | null;
    onedit: (task: Task) => void;
    onadd: (project: string) => void;
    onproject: () => void;
  } = $props();
  let project = $derived($appState.projects.find((p) => p.id === selected));
  let deleteDialog: HTMLDialogElement;
  let deleting = $state(false);
  let deleteError = $state('');
  let deleteTarget = $state<{ id: string; name: string } | null>(null);
  function confirmDelete() {
    if (!project) return;
    deleteTarget = { id: project.id, name: project.name };
    deleteError = '';
    deleteDialog.showModal();
  }
  async function deleteProject() {
    if (!deleteTarget || deleting) return;
    deleting = true;
    const success = await send('project:delete', { id: deleteTarget.id });
    deleting = false;
    if (success) {
      selected = null;
      deleteDialog.close();
    } else deleteError = $message || '삭제하지 못했습니다. 다시 시도하세요.';
  }
</script>

{#if project}
  <button class="back-button" onclick={() => (selected = null)}
    ><Icon name="back" />모든 프로젝트</button
  >
  <div class="intro">
    <div><h1>{project.name}</h1></div>
    <button class="text-button" onclick={confirmDelete}>프로젝트 삭제</button>
  </div>
  <TaskList
    tasks={$appState.tasks.filter((t) => t.project === selected)}
    {onedit}
  />
  <button class="add-task" onclick={() => onadd(project!.id)}
    ><Icon name="plus" />할 일 추가</button
  >
{:else}
  <div class="project-grid">
    {#each $appState.projects as item (item.id)}
      {@const tasks = $appState.tasks.filter(
        (t) => t.project === item.id,
      )}{@const completed = tasks.filter((t) => t.done).length}
      <button class="project-card" onclick={() => (selected = item.id)}>
        <span class="project-symbol" style:color={item.color}
          ><Icon name={item.icon} /></span
        >
        <h2>{item.name}</h2>
        <div class="project-bottom">
          <span>{tasks.length}개의 할 일 · {completed}개 완료</span><span
            class="pomo-count"
            >{tasks.reduce((sum, t) => sum + t.estimate, 0)}<Tomato
              filled
            /></span
          >
        </div>
        <div class="progress-line">
          <div
            style:width={`${tasks.length ? (completed / tasks.length) * 100 : 0}%`}
          ></div>
        </div>
      </button>{/each}
  </div>
  <button class="add-task" onclick={onproject}
    ><Icon name="plus" />프로젝트 추가</button
  >
{/if}

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
  <p>{deleteTarget?.name}</p>
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
