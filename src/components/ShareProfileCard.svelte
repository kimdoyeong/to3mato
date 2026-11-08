<script lang="ts">
  import ShareSwitches from './ShareSwitches.svelte';
  import { notify } from '../lib/client';
  import { COPY } from '../lib/share-copy';
  import {
    dialogRequest,
    profile,
    profileLoaded,
    profilePhoto,
    publishError,
    setVisibility,
    stopSharing,
    visibility,
  } from '../lib/share-profile';
  let busy = $state(false),
    error = $state('');
  async function change(key: Parameters<typeof setVisibility>[0], value: boolean) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await setVisibility(key, value);
    } catch {
      error = COPY.saveFailed;
    } finally {
      busy = false;
    }
  }
  async function stop() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await stopSharing();
      notify(COPY.stoppedToast);
    } catch {
      error = COPY.saveFailed;
    } finally {
      busy = false;
    }
  }
</script>

<section class="settings-card share-card" aria-labelledby="share-card-title">
  <h2 id="share-card-title">{COPY.card}</h2>
  <div class="name-row">
    <span>{COPY.name}</span>
    <span class="name-value">
      {#if $profile?.name}
        {#if $profilePhoto}<img
            class="avatar-sm"
            src={$profilePhoto}
            alt={COPY.photoAlt}
          />{/if}
        <span class="name-text">{$profile.name}</span>
        <button
          class="text-button"
          disabled={busy}
          onclick={() => dialogRequest.set('edit')}>{COPY.edit}</button
        >
      {:else}
        <span class="muted">{COPY.none}</span>
      {/if}
    </span>
  </div>
  <ShareSwitches
    id="share-card"
    value={$visibility}
    disabled={busy || !$profileLoaded}
    onchange={change}
  />
  {#if $profile && !$profile.active && $profile.name}<p class="share-status">
      {COPY.stopped}
    </p>{/if}
  {#if error || $publishError}<p class="form-error" role="alert">
      {error || $publishError}
    </p>{/if}
  {#if $profile?.active}<div class="share-footer">
      <button class="text-button" disabled={busy} onclick={stop}
        >{COPY.stop}</button
      >
    </div>{/if}
</section>

<style>
  .share-card {
    margin: 0 0 30px;
  }
  .name-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 48px;
    margin-top: 10px;
    font-size: var(--text-md);
    border-bottom: 2px dashed var(--line);
  }
  .name-value {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    color: var(--muted);
  }
  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .avatar-sm {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid #fff;
    flex-shrink: 0;
  }
  .share-status {
    margin: 12px 0 0;
  }
  .share-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
</style>
