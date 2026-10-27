import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startCallbackServer,
  callbackPort,
  CALLBACK_PORT,
} from '../electron/auth-callback.mjs';

test('callback port is fixed unless a test overrides it', () => {
  assert.equal(callbackPort({}), CALLBACK_PORT);
  assert.equal(callbackPort({ TO3MATO_AUTH_CALLBACK_PORT: '0' }), 0);
  assert.equal(callbackPort({ TO3MATO_AUTH_CALLBACK_PORT: 'abc' }), CALLBACK_PORT);
});

test('callback server answers only the callback path on loopback', async () => {
  const seen = [];
  const server = await startCallbackServer({
    port: 0,
    onCallback: async (params) => {
      seen.push(params.get('code'));
      return params.get('code') === 'good';
    },
  });
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    const ok = await fetch(`${server.url}?code=good`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /로그인했습니다\./);
    const bad = await fetch(`${server.url}?code=forged`);
    assert.match(await bad.text(), /로그인하지 못했습니다\./);
    const other = await fetch(server.url.replace('/auth/callback', '/other'));
    assert.equal(other.status, 404);
    const post = await fetch(server.url, { method: 'POST' });
    assert.equal(post.status, 404);
    assert.deepEqual(seen, ['good', 'forged']);
  } finally {
    await server.close();
  }
});

test('a callback that throws shows the failure page', async () => {
  const server = await startCallbackServer({
    port: 0,
    onCallback: async () => {
      throw new Error('exchange failed');
    },
  });
  try {
    const response = await fetch(`${server.url}?code=x`);
    assert.match(await response.text(), /로그인하지 못했습니다\./);
  } finally {
    await server.close();
  }
});
