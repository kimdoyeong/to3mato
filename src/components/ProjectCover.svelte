<script lang="ts">
  import Icon from './Icon.svelte';
  import { isDesktop } from '../lib/client';
  import {
    loadProjectImage,
    pickProjectImage,
    storeProjectImage,
    imageRevision,
  } from '../lib/project-images';
  import type { Project } from '../lib/types';
  let { project }: { project: Project } = $props();
  let url = $state('');
  let input = $state<HTMLInputElement | null>(null);
  $effect(() => {
    $imageRevision;
    const name = project.image;
    let active = true;
    loadProjectImage(name).then((value) => {
      if (active) url = value;
    });
    return () => {
      active = false;
    };
  });
  function change() {
    if (isDesktop) pickProjectImage(project.id, project.name);
    else input?.click();
  }
</script>

<div
  class="coverimg"
  class:photo={!!url}
  style:background-color={url
    ? undefined
    : `color-mix(in srgb, ${project.color} 22%, #fff)`}
  role="img"
  aria-label={url ? `${project.name} 표지 이미지` : `${project.name} 기본 표지`}
>
  {#if url}
    <img src={url} alt="" />
  {:else}
    <span class="cover-icon" style:color={project.color}
      ><Icon name={project.icon} /></span
    >
    <span class="cover-mascot" aria-hidden="true">
      <svg viewBox="0 0 52 48" width="40" height="36"
        ><path
          d="M26 14C18 8 3 11 2.5 26 2 38 12 46 26 46s24-8 23.5-20C49 11 34 8 26 14Z"
          fill="#ef5b43"
        /><path
          d="M26 15l-8 1 4-5-7-3 8-1-2-6 5 4 5-4-2 6 8 1-7 3 4 5Z"
          fill="#69a84f"
        /><circle cx="18.5" cy="28" r="2.2" fill="#4a3128" /><circle
          cx="33.5"
          cy="28"
          r="2.2"
          fill="#4a3128"
        /><path
          d="M23 33q3 3.5 6 0"
          fill="none"
          stroke="#4a3128"
          stroke-width="1.8"
          stroke-linecap="round"
        /></svg
      >
    </span>
  {/if}
  <button class="imgbtn" type="button" onclick={change}>이미지 변경</button>
  {#if !isDesktop}
    <input
      class="file-input"
      bind:this={input}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      aria-label={`${project.name} 표지 이미지 파일`}
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) storeProjectImage(project.id, project.name, file);
        event.currentTarget.value = '';
      }}
    />
  {/if}
</div>
