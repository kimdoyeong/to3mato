<script lang="ts">
  let {
    value,
    onchange,
    disabled = false,
  }: {
    value: number[];
    onchange: (value: number[]) => void;
    disabled?: boolean;
  } = $props();
  const days = [
    { id: 1, name: '월' },
    { id: 2, name: '화' },
    { id: 3, name: '수' },
    { id: 4, name: '목' },
    { id: 5, name: '금' },
    { id: 6, name: '토' },
    { id: 0, name: '일' },
  ];
</script>

<fieldset class="weekday-field" {disabled}>
  <legend>배치할 요일</legend>
  <div class="weekday-picker">
    {#each days as day}<button
        type="button"
        class:selected={value.includes(day.id)}
        aria-pressed={value.includes(day.id)}
        aria-label={`${day.name}요일 배치`}
        onclick={() =>
          onchange(
            value.includes(day.id)
              ? value.filter((id) => id !== day.id)
              : [...value, day.id],
          )}>{day.name}</button
      >{/each}
  </div>
</fieldset>
