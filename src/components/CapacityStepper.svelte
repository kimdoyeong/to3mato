<script lang="ts">
  import { state as appState, send } from '../lib/client';
  let { label }: { label: string } = $props();
  let busy = $state(false);
  async function change(delta: number) {
    if (busy) return;
    const next = $appState.settings.dailyCapacity + delta;
    if (next < 1 || next > 16) return;
    busy = true;
    await send('settings:save', { dailyCapacity: next });
    busy = false;
  }
</script>

<div class="ritual-stepper" role="group" aria-label={label}>
  <span>{label}</span>
  <button
    class="step"
    aria-label={`${label} −`}
    disabled={busy || $appState.settings.dailyCapacity <= 1}
    onclick={() => change(-1)}>−</button
  >
  <span class="num capacity-value">{$appState.settings.dailyCapacity}</span>
  <button
    class="step"
    aria-label={`${label} +`}
    disabled={busy || $appState.settings.dailyCapacity >= 16}
    onclick={() => change(1)}>+</button
  >
</div>
