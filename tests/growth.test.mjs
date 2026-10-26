import test from 'node:test';
import assert from 'node:assert/strict';
import {
  growth,
  fruitScale,
  TALL_AT,
  FRUIT_AT,
  FRUIT_DONE,
} from '../src/lib/growth.mjs';

test('the plant grows through sprout, tall and fruit stages', () => {
  assert.deepEqual(growth(0), { stage: 'sprout', scale: 0.15 });
  assert.equal(growth(TALL_AT - 0.001).stage, 'sprout');
  assert.equal(growth(TALL_AT).stage, 'tall');
  assert.equal(growth(FRUIT_AT).stage, 'fruit');
  assert.deepEqual(growth(1), { stage: 'fruit', scale: 1 });
  assert.deepEqual(growth(5), growth(1));
  assert.deepEqual(growth(-1), growth(0));
  assert.deepEqual(growth(NaN), growth(0));
});

test('the tall plant takes over at the sprout height', () => {
  const sproutHeight = 1.58 * growth(TALL_AT - 1e-9).scale;
  const tallHeight = 1.87 * growth(TALL_AT).scale;
  assert.ok(Math.abs(sproutHeight - tallHeight) < 1e-3);
});

test('plant size never shrinks as the session goes on', () => {
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const { stage, scale } = growth(i / 1000);
    const height = scale * (stage === 'sprout' ? 1.58 : 1.87);
    assert.ok(height >= previous - 1e-9);
    previous = height;
  }
});

test('fruit appears one by one and is all grown before the session ends', () => {
  const count = 7;
  for (let i = 0; i < count; i++) {
    assert.equal(fruitScale(FRUIT_AT, i, count), 0);
    assert.equal(fruitScale(FRUIT_DONE, i, count), 1);
    assert.equal(fruitScale(1, i, count), 1);
  }
  const middle = FRUIT_AT + (FRUIT_DONE - FRUIT_AT) / 2;
  const grown = Array.from({ length: count }, (_, i) =>
    fruitScale(middle, i, count),
  );
  assert.ok(grown[0] > 0);
  assert.equal(grown.at(-1), 0);
});
