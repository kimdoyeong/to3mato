import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forestItems,
  runBonus,
  spiral,
  SLACK_SECONDS,
  TREES,
} from '../src/lib/forest.mjs';

const REST = 300;
const FOCUS = 1500;
// Records back to back: each one starts `gap` seconds after the last ended.
function session(pomodoros, { start = 0, gap = REST } = {}) {
  let end = start;
  return pomodoros.map((count, i) => {
    const seconds = count * FOCUS;
    end += (i ? gap : 0) * 1000 + seconds * 1000;
    return {
      id: `r${start}-${i}`,
      taskId: 't',
      seconds,
      pomodoros: count,
      duration: FOCUS,
      at: end,
    };
  });
}
const kinds = (items) => items.map((item) => item.kind);

test('every full pomodoro is a tree and every half one a bush', () => {
  const far = (FOCUS + REST + SLACK_SECONDS + 1) * 1000;
  const records = [
    ...session([1], { start: 0 }),
    ...session([0.5], { start: far }),
    ...session([1], { start: far * 2 }),
  ];
  assert.deepEqual(kinds(forestItems(records, REST)), ['tree', 'bush', 'tree']);
});

test('a run of back-to-back pomodoros leaves one bonus after it', () => {
  assert.deepEqual(kinds(forestItems(session([1, 1]), REST)), [
    'tree',
    'tree',
    'flowers',
  ]);
  assert.deepEqual(kinds(forestItems(session([1, 1, 1, 1]), REST)), [
    'tree',
    'tree',
    'tree',
    'tree',
    'pig',
  ]);
});

test('bonuses grow with the run and stop growing at five', () => {
  assert.equal(runBonus(1), null);
  assert.equal(runBonus(2), 'flowers');
  assert.equal(runBonus(3), 'chicken');
  assert.equal(runBonus(4), 'pig');
  assert.equal(runBonus(5), 'cow');
  assert.equal(runBonus(12), 'cow');
});

test('a long break or a half pomodoro ends the run', () => {
  const late = session([1, 1, 1], { gap: REST + SLACK_SECONDS + 1 });
  assert.deepEqual(kinds(forestItems(late, REST)), ['tree', 'tree', 'tree']);
  const slack = session([1, 1], { gap: REST + SLACK_SECONDS });
  assert.deepEqual(kinds(forestItems(slack, REST)), [
    'tree',
    'tree',
    'flowers',
  ]);
  assert.deepEqual(kinds(forestItems(session([1, 1, 0.5, 1]), REST)), [
    'tree',
    'tree',
    'flowers',
    'bush',
    'tree',
  ]);
});

test('items follow time order and keep their look between calls', () => {
  const records = session([1, 1, 1]);
  const items = forestItems(records, REST);
  assert.deepEqual(forestItems([...records].reverse(), REST), items);
  for (const item of items.filter((item) => item.kind === 'tree')) {
    assert.ok(item.variant >= 0 && item.variant < TREES);
    assert.ok(item.seed >= 0 && item.seed < 1);
  }
});

test('zero-length records plant nothing', () => {
  assert.deepEqual(forestItems(session([0]), REST), []);
  assert.deepEqual(forestItems([], REST), []);
});

test('the spiral moves outward and keeps neighbours apart', () => {
  const spacing = 0.2;
  const points = Array.from({ length: 60 }, (_, i) => spiral(i, spacing));
  for (let i = 1; i < points.length; i++)
    assert.ok(points[i].radius > points[i - 1].radius);
  let closest = Infinity;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      closest = Math.min(
        closest,
        Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z),
      );
  assert.ok(closest > spacing * 0.9, `closest ${closest}`);
});
