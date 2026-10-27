import http from 'node:http';

export const CALLBACK_PATH = '/auth/callback';
/** Fixed so the Supabase redirect allow list can name it exactly. */
export const CALLBACK_PORT = 43117;

export function callbackPort(env = process.env) {
  const value = env.TO3MATO_AUTH_CALLBACK_PORT;
  return value !== undefined && /^\d{1,5}$/.test(value)
    ? Number(value)
    : CALLBACK_PORT;
}

const page = (ok) =>
  `<!doctype html><meta charset="utf-8"><title>To3mato</title><p>${
    ok
      ? '로그인했습니다. To3mato로 돌아가세요.'
      : '로그인하지 못했습니다. To3mato에서 로그인 링크를 다시 받으세요.'
  }</p>`;

/**
 * Listens on 127.0.0.1 for the browser to come back from an email link.
 * onCallback receives the query and resolves true when sign-in succeeded.
 * A forged request cannot sign anyone in: the code only exchanges with the
 * PKCE verifier stored on this device.
 */
export async function startCallbackServer({ port, onCallback }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end();
      return;
    }
    let ok = false;
    try {
      ok = (await onCallback(url.searchParams)) === true;
    } catch {
      ok = false;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(page(ok));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
