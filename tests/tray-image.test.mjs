import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renderTrayPNG,
  decodePNG,
  ratioBucket,
  trayImageKey,
} from '../electron/tray-image.mjs';
import {
  timerMenuState,
  createInitialState,
  applyCommand,
} from '../src/lib/domain.mjs';

for (const display of ['bar', 'ring', 'hourglass']) {
  test(`${display}: PNG dimensions, original mascot, progress, idle and pause`, () => {
    for (const scale of [1, 2]) {
      const view = { phase: 'focus', paused: false, ratio: 1 };
      const full = renderTrayPNG(display, view, scale),
        decoded = decodePNG(full);
      assert.equal(decoded.height, 22 * scale);
      assert.ok(decoded.width > 22 * scale);
      const mascot = decodePNG(
        readFileSync(
          new URL(
            `../electron/assets/mascot-tray${scale === 2 ? '@2x' : ''}.png`,
            import.meta.url,
          ),
        ),
      );
      for (let y = 0; y < mascot.height; y++)
        assert.deepEqual(
          decoded.pixels.subarray(
            y * decoded.width * 4,
            (y * decoded.width + mascot.width) * 4,
          ),
          mascot.pixels.subarray(
            y * mascot.width * 4,
            (y + 1) * mascot.width * 4,
          ),
        );
      for (const changed of [
        { ratio: 0 },
        { ratio: 0.5 },
        { phase: 'idle', ratio: 0 },
        { paused: true },
        { phase: 'rest' },
      ])
        assert.notDeepEqual(
          renderTrayPNG(display, { ...view, ...changed }, scale),
          full,
        );
    }
    assert.equal(ratioBucket(display, -1), 0);
    assert.equal(ratioBucket(display, 2), ratioBucket(display, 1));
    assert.equal(
      trayImageKey(display, { ratio: 0.5, phase: 'focus', paused: false }),
      trayImageKey(display, { ratio: 0.5001, phase: 'focus', paused: false }),
    );
  });
}
test('shared tray state uses timer duration, task and current day', () => {
  let state = createInitialState();
  let view = timerMenuState(state);
  assert.equal(view.ratio, 0);
  assert.equal(view.phase, 'idle');
  assert.equal(view.taskTitle, state.tasks[0].title);
  state = applyCommand(
    state,
    { type: 'timer:play', payload: { id: state.tasks[0].id } },
    1000,
  );
  view = timerMenuState(state, 751000);
  assert.equal(view.ratio, 0.5);
  assert.equal(view.clock, '12:30');
  assert.equal(view.status, '집중 중');
  state = applyCommand(state, { type: 'timer:toggle' }, 751000);
  assert.equal(timerMenuState(state, 900000).ratio, 0.5);
  assert.equal(timerMenuState(state).paused, true);
});
