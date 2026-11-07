<script lang="ts">
  import { tick } from 'svelte';
  import ShareSwitches from './ShareSwitches.svelte';
  import { notify, now, state as appState } from '../lib/client';
  import { errorText } from '../lib/account';
  import { readDelivery } from '../lib/deliveries';
  import { COPY } from '../lib/share-copy';
  import {
    buildSnapshot,
    cleanName,
    icon,
    lastWeekStart,
    MAX_NAME,
    renderProfile,
  } from '../lib/public-profile.mjs';
  import {
    dialogRequest,
    editIdentity,
    ensureProfile,
    firstShare,
    freshDelivery,
    profile,
    profilePhoto,
    timeZone,
    visibility,
  } from '../lib/share-profile';
  import { dateInZone } from '../lib/calendar-time.mjs';
  import type { Visibility } from '../lib/types';

  let dialog: HTMLDialogElement;
  let mode = $state<'first' | 'edit'>('first');
  let name = $state(''),
    photo = $state('keep'), // 'keep' | 'remove' | token
    photoUrl = $state(''),
    draft = $state<Visibility>({ ...$visibility }),
    slug = $state(''),
    videoUrl = $state(''),
    busy = $state(false),
    nameError = $state(''),
    photoError = $state(''),
    error = $state('');

  $effect(() => {
    const request = $dialogRequest;
    if (request) void open(request);
  });

  async function open(request: 'first' | 'edit') {
    dialogRequest.set(null);
    mode = request;
    error = nameError = photoError = '';
    draft = { ...$visibility };
    name = request === 'edit' ? $profile?.name || '' : '';
    photo = 'keep';
    photoUrl = request === 'edit' ? $profilePhoto : '';
    slug = $profile?.slug || '';
    await tick();
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.focus();
    if (request === 'first' && !slug) {
      try {
        slug = (await ensureProfile()).slug;
      } catch (failure) {
        error = COPY.saveFailed;
        console.error(errorText(failure));
      }
    }
  }
  function close() {
    if (busy) return;
    dialog.close();
  }
  function cleanup() {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = '';
    // Focus goes back to the share button the request came from.
    if (mode === 'first')
      document.querySelector<HTMLButtonElement>('.share-button')?.focus();
  }

  // The weekly video is shown only while its switch is on and last week has a delivery.
  $effect(() => {
    const on = mode === 'first' && draft.video && dialog?.open;
    const delivery = on ? freshDelivery() : null;
    if (!delivery) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = '';
      return;
    }
    let active = true;
    readDelivery(delivery.id)
      .then((blob) => {
        if (active) videoUrl = URL.createObjectURL(blob);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  });

  const preview = $derived.by(() => {
    if (mode !== 'first' || !slug) return '';
    const snapshot = buildSnapshot({
      state: $appState,
      visibility: draft,
      now: new Date($now),
      timeZone: timeZone(),
      // The local video is last week's delivery, so it counts as fresh.
      video:
        draft.video && videoUrl
          ? { path: '', weekStart: lastWeekStart(dateInZone(new Date($now), timeZone())) }
          : null,
    });
    return renderProfile(
      { slug, name: cleanName(name), photoUrl, videoUrl, snapshot },
      { now: new Date($now) },
    );
  });

  /** The preview markup is plain HTML, so its pause button is wired here. */
  function previewClick(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('.pp-pause');
    const video = button?.closest('.pp')?.querySelector('video');
    if (!button || !video) return;
    const play = video.paused;
    if (play) void video.play();
    else video.pause();
    button.innerHTML = icon(play ? 'pause' : 'play');
    button.setAttribute(
      'aria-label',
      (play ? button.dataset.labelPause : button.dataset.labelPlay) || '',
    );
  }
  async function pickPhoto() {
    photoError = '';
    const result = await window.to3mato!.profile.pickPhoto();
    if (!result) return;
    if ('error' in result) {
      photoError =
        result.error === 'type'
          ? COPY.photoType
          : result.error === 'size'
            ? COPY.photoSize
            : COPY.photoRead;
      return;
    }
    photo = result.token;
    photoUrl = result.preview;
  }
  function removePhoto() {
    photo = 'remove';
    photoUrl = '';
    photoError = '';
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    error = '';
    if (!cleanName(name)) {
      nameError = COPY.nameRequired;
      dialog.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    busy = true;
    try {
      if (mode === 'first') {
        await firstShare({ name, photo, visibility: draft });
        busy = false;
        dialog.close();
        notify(COPY.copied);
      } else {
        await editIdentity({ name, photo });
        busy = false;
        dialog.close();
      }
    } catch (failure) {
      console.error(errorText(failure));
      error = COPY.saveFailed;
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="share-dialog"
  class:wide={mode === 'first'}
  aria-labelledby="share-dialog-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
  onclose={cleanup}
>
  <form onsubmit={submit} novalidate>
    <div class="dialog-heading">
      <h2 id="share-dialog-title">
        {mode === 'first' ? COPY.shareProfile : COPY.editName}
      </h2>
      <button
        type="button"
        class="icon-button"
        disabled={busy}
        onclick={close}
        aria-label={COPY.close}>✕</button
      >
    </div>
    <div class="share-grid">
      <div>
        <label
          >{COPY.name}<input
            bind:value={name}
            maxlength={MAX_NAME}
            autocomplete="nickname"
            disabled={busy}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'share-name-error' : undefined}
            oninput={() => (nameError = '')}
          /></label
        >
        <p class="name-count num">{[...name].length} / {MAX_NAME}</p>
        {#if nameError}<p id="share-name-error" class="form-error" role="alert">
            {nameError}
          </p>{/if}
        <h3 class="field-title">{COPY.photo}</h3>
        <div class="photo-field">
          {#if photoUrl}<img class="photo" src={photoUrl} alt={COPY.photoAlt} />
            <button
              type="button"
              class="btn-line"
              disabled={busy}
              onclick={removePhoto}>{COPY.removePhoto}</button
            >
          {:else}<span class="photo-empty" aria-hidden="true"></span>
            <button
              type="button"
              class="btn-line"
              disabled={busy}
              onclick={pickPhoto}>{COPY.addPhoto}</button
            >{/if}
        </div>
        {#if photoError}<p class="form-error" role="alert">{photoError}</p>{/if}
        {#if mode === 'first'}
          <h3 class="field-title">{COPY.range}</h3>
          <ShareSwitches
            id="share-dialog"
            value={draft}
            disabled={busy}
            onchange={(key, next) => (draft = { ...draft, [key]: next })}
          />
        {/if}
      </div>
      {#if mode === 'first'}
        <div class="preview-column">
          <h3 class="field-title">{COPY.preview}</h3>
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="preview-screen" onclick={previewClick}>
            <!-- renderProfile escapes every user value. -->
            {@html preview}
          </div>
        </div>
      {/if}
    </div>
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <div class="dialog-footer">
      <button class="primary" type="submit" disabled={busy}>{COPY.save}</button>
    </div>
  </form>
</dialog>

<style>
  .share-dialog.wide {
    width: 880px;
    max-height: calc(100dvh - 40px);
    overflow-y: auto;
    padding: 26px 30px;
  }
  .share-grid {
    display: grid;
    gap: 28px;
  }
  .wide .share-grid {
    grid-template-columns: minmax(0, 1fr) 330px;
  }
  .share-grid > div {
    min-width: 0;
  }
  label {
    margin-bottom: 0;
  }
  .name-count {
    font-size: var(--text-xs);
    color: var(--ink-hint);
    text-align: right;
    margin: 6px 0 0;
  }
  .field-title {
    font-family: var(--font-body);
    font-size: var(--text-base);
    letter-spacing: 0;
    margin: 18px 0 8px;
  }
  .preview-column .field-title {
    margin-top: 0;
  }
  .photo-field {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .photo,
  .photo-empty {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .photo {
    object-fit: cover;
    border: 3px solid #fff;
    box-shadow: 0 2px 0 var(--line-strong);
  }
  .photo-empty {
    border: 2px dashed var(--line-strong);
    background: var(--paper-soft);
  }
  .preview-screen {
    height: 500px;
    overflow-y: auto;
    border: 2px solid var(--line);
    border-radius: 22px;
    background: var(--bg);
  }
  @media (max-width: 760px) {
    .wide .share-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
