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
test('clock: running focus keeps the mascot, waiting and rest states are marked', () => {
  const ink = [74, 49, 40, 255],
    green = [79, 138, 58, 255],
    white = [255, 255, 255, 255];
  for (const scale of [1, 2]) {
    const mascot = decodePNG(
      readFileSync(
        new URL(
          `../electron/assets/mascot-tray${scale === 2 ? '@2x' : ''}.png`,
          import.meta.url,
        ),
      ),
    );
    const render = (view) =>
      decodePNG(renderTrayPNG('clock', { ratio: 0.5, ...view }, scale));
    const at = (image, x, y) => [
      ...image.pixels.subarray(
        (y * scale * image.width + x * scale) * 4,
        (y * scale * image.width + x * scale) * 4 + 4,
      ),
    ];
    const focus = render({ phase: 'focus', paused: false });
    assert.equal(focus.width, 22 * scale);
    assert.equal(focus.height, 22 * scale);
    assert.deepEqual(focus.pixels, mascot.pixels);

    // Idle: desaturated and faded, no badge.
    const idle = render({ phase: 'idle', paused: false });
    let alpha = 0;
    for (let i = 0; i < idle.pixels.length; i += 4) {
      assert.equal(idle.pixels[i], idle.pixels[i + 1]);
      assert.equal(idle.pixels[i + 1], idle.pixels[i + 2]);
      assert.ok(idle.pixels[i + 3] <= mascot.pixels[i + 3]);
      alpha += idle.pixels[i + 3];
    }
    assert.ok(
      alpha <
        mascot.pixels.reduce((sum, v, i) => sum + (i % 4 === 3 ? v : 0), 0) *
          0.7,
    );
    assert.notDeepEqual(at(idle, 15, 12), ink);

    // Paused focus: desaturated at full alpha with an ink badge and two bars.
    const paused = render({ phase: 'focus', paused: true });
    // Outside the badge the mascot is gray but keeps its alpha.
    for (let y = 0; y < 10 * scale; y++)
      for (let x = 0; x < 22 * scale; x++) {
        const i = (y * paused.width + x) * 4;
        assert.equal(paused.pixels[i], paused.pixels[i + 1]);
        assert.equal(paused.pixels[i + 1], paused.pixels[i + 2]);
        assert.equal(paused.pixels[i + 3], mascot.pixels[i + 3]);
      }
    assert.deepEqual(at(paused, 15, 12), ink);
    assert.deepEqual(at(paused, 14, 16), white);
    assert.deepEqual(at(paused, 16, 21), white);

    // Rest: colored mascot with a green badge; the glyph is a cup while running
    // and bars when paused.
    const rest = render({ phase: 'rest', paused: false });
    assert.deepEqual(at(rest, 3, 10), at(mascot, 3, 10));
    assert.deepEqual(at(rest, 15, 12), green);
    assert.deepEqual(at(rest, 14, 16), white);
    assert.deepEqual(at(rest, 16, 21), white);
    const restPaused = render({ phase: 'rest', paused: true });
    assert.deepEqual(at(restPaused, 15, 12), green);
    assert.deepEqual(at(restPaused, 14, 16), white);
    assert.notDeepEqual(restPaused.pixels, rest.pixels);
    assert.notDeepEqual(at(restPaused, 3, 10), at(mascot, 3, 10));

    // Shape displays carry the same badge.
    for (const display of ['bar', 'ring', 'hourglass']) {
      const image = decodePNG(
        renderTrayPNG(
          display,
          { phase: 'rest', paused: false, ratio: 0.5 },
          scale,
        ),
      );
      assert.deepEqual(at(image, 15, 12), green);
    }
  }
  assert.equal(ratioBucket('clock', 0.9), 0);
  assert.equal(
    trayImageKey('clock', { ratio: 0.1, phase: 'focus', paused: false }),
    trayImageKey('clock', { ratio: 0.9, phase: 'focus', paused: false }),
  );
  assert.notEqual(
    trayImageKey('clock', { ratio: 0.1, phase: 'focus', paused: false }),
    trayImageKey('clock', { ratio: 0.1, phase: 'focus', paused: true }),
  );
});
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
