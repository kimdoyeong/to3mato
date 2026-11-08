<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { notify } from '../lib/client';
  import { errorText } from '../lib/account';
  import { COPY } from '../lib/share-copy';
  import {
    copyProfileLink,
    dialogRequest,
    profile,
    profileLoaded,
    signedIn,
  } from '../lib/share-profile';
  let open = $state(false),
    busy = $state(false);
  let button = $state<HTMLButtonElement>(),
    menu = $state<HTMLDivElement>();
  async function toggle() {
    open = !open;
    if (open) {
      await tick();
      menu?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }
  function closeMenu(focus = true) {
    open = false;
    if (focus) button?.focus();
  }
  async function shareProfile() {
    if (busy) return;
    closeMenu(false);
    if (!$profile?.name) {
      dialogRequest.set('first');
      return;
    }
    busy = true;
    try {
      await copyProfileLink();
      notify(COPY.copied);
    } catch (failure) {
      console.error(errorText(failure));
      notify(COPY.copyFailed);
    } finally {
      busy = false;
      button?.focus();
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (open && event.key === 'Escape') closeMenu();
  }}
  onclick={(event) => {
    if (open && !(event.target as Element).closest?.('.share-wrap'))
      closeMenu(false);
  }}
/>

{#if $signedIn}<div class="share-wrap">
    <button
      bind:this={button}
      class="btn-line share-button"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={!$profileLoaded || busy}
      onclick={toggle}><Icon name="share" />{COPY.share}</button
    >
    {#if open}<div class="share-menu" role="menu" bind:this={menu}>
        <button role="menuitem" onclick={shareProfile}
          ><Icon name="link" />{COPY.shareProfile}</button
        >
      </div>{/if}
  </div>{/if}

<style>
  .share-wrap {
    position: relative;
  }
  .share-button :global(.icon) {
    width: 17px;
    height: 17px;
  }
  .share-menu {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 4;
    min-width: 210px;
    padding: 8px;
    background: var(--paper);
    border: 2px solid var(--line-strong);
    border-radius: var(--wobble-a);
    box-shadow:
      0 4px 0 var(--line-strong),
      0 14px 30px #4a312826;
  }
  .share-menu button {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--wobble-s);
    font-size: var(--text-md);
    text-align: left;
    white-space: nowrap;
  }
  .share-menu button:hover,
  .share-menu button:focus-visible {
    background: var(--peach);
    color: var(--red-deep);
  }
</style>
