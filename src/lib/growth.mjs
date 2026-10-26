// A focus session grows one tomato plant: a sprout that fills out, a taller
// plant that matches the sprout's height when it takes over, then fruit that
// ripens from the lowest branch up near the end of the session.
export const TALL_AT = 0.5;
export const FRUIT_AT = 0.75;
export const FRUIT_DONE = 0.95;
// SM_TomatoPlant_1_A is 1.58 high and SM_TomatoPlant_2_A is 1.87 high.
const HANDOFF = 1.58 / 1.87;
const POP = 0.04;

const clamp = (value) => Math.min(1, Math.max(0, value || 0));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

/** Which plant model shows and how large it is at a session progress of 0–1. */
export function growth(progress) {
  const p = clamp(progress);
  if (p < TALL_AT)
    return { stage: 'sprout', scale: 0.15 + 0.85 * easeOut(p / TALL_AT) };
  if (p < FRUIT_AT)
    return {
      stage: 'tall',
      scale:
        HANDOFF + (1 - HANDOFF) * easeOut((p - TALL_AT) / (FRUIT_AT - TALL_AT)),
    };
  return { stage: 'fruit', scale: 1 };
}

/** Size of fruit `index` of `count`; each one pops in at its own moment. */
export function fruitScale(progress, index, count) {
  const appear = FRUIT_AT + ((FRUIT_DONE - FRUIT_AT - POP) * index) / count;
  const t = (clamp(progress) - appear) / POP;
  return t <= 0 ? 0 : t >= 1 ? 1 : Math.max(0, easeOutBack(t));
}
