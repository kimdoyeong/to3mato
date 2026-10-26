// A week of focus records becomes one island. Every full pomodoro plants a
// tree and a half one a bush, in the order they were done. Pomodoros done
// back to back (the next one starting within the rest time plus a little
// slack) form a run, and a run of two or more leaves a bonus after it that
// grows with the run's length.
export const SLACK_SECONDS = 5 * 60;
export const BONUSES = ['flowers', 'chicken', 'pig', 'cow'];
export const TREES = 4;

/** Small stable hash so an item keeps its look and turn between renders. */
function seed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}

/** Bonus for a run of `length` consecutive full pomodoros, if any. */
export function runBonus(length) {
  return length < 2 ? null : BONUSES[Math.min(length, 5) - 2];
}

/** Items on a week's island, in planting order. */
export function forestItems(records, restSeconds) {
  const items = [];
  let run = 0;
  let previousEnd = -Infinity;
  const close = (id) => {
    const bonus = runBonus(run);
    if (bonus) items.push({ kind: bonus, seed: seed(`${id}:bonus`) });
    run = 0;
  };
  const sorted = [...records]
    .filter((record) => record.pomodoros > 0)
    .sort((a, b) => a.at - b.at);
  sorted.forEach((record, i) => {
    const start = record.at - record.seconds * 1000;
    const joined = start - previousEnd <= (restSeconds + SLACK_SECONDS) * 1000;
    if (run && (!joined || record.pomodoros < 1)) close(sorted[i - 1].id);
    const s = seed(record.id);
    if (record.pomodoros >= 1) {
      items.push({ kind: 'tree', variant: Math.floor(s * TREES), seed: s });
      run++;
    } else items.push({ kind: 'bush', seed: s });
    previousEnd = record.at;
  });
  if (run) close(sorted.at(-1).id);
  return items;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Position of item `index` on a sunflower spiral, `spacing` apart. */
export function spiral(index, spacing) {
  const radius = spacing * Math.sqrt(index + 0.5);
  const angle = index * GOLDEN_ANGLE;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius };
}
