import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { syncPostgres, USER_A, USER_B } from './sync-postgres.mjs';

/** HTTP/Auth/Realtime adapter around real PostgreSQL for isolated app integration. */
export async function syncHttpServer() {
  const pg = await syncPostgres();
  const files = new Map(),
    subscribers = new Map(),
    events = [],
    // Sign-in links: the last request per email, and issued one-time codes.
    links = new Map(),
    codes = new Map();
  const userByEmail = (email) =>
    email === 'b@example.test' ? USER_B : USER_A;
  let sequence = Promise.resolve(),
    disconnected = false;
  const serialize = (fn) => {
    const next = sequence.then(fn, fn);
    sequence = next.catch(() => {});
    return next;
  };
  const token = (user) =>
    [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: user,
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url'),
      'test',
    ].join('.');
  const userFrom = (authorization) => {
    try {
      return JSON.parse(
        Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url'),
      ).sub;
    } catch {
      return null;
    }
  };
  const session = (id) => ({
    access_token: token(id),
    refresh_token: `refresh-${id}`,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: id === USER_A ? 'a@example.test' : 'b@example.test',
    },
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,DELETE,OPTIONS',
    );
    if (req.method === 'OPTIONS') {
      res.end();
      return;
    }
    if (disconnected) {
      res.writeHead(503);
      res.end('{}');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks),
      url = new URL(req.url, 'http://localhost');
    let body;
    try {
      body = bytes.length ? JSON.parse(bytes.toString()) : {};
    } catch {
      body = {};
    }
    const reply = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      if (url.pathname === '/auth/v1/otp') {
        // The app always lets a first-time address create its account.
        if (body.create_user !== true)
          return reply({ error_code: 'validation_failed', msg: 'create_user expected' }, 400);
        // A link request carries the PKCE challenge and where to return.
        if (body.code_challenge)
          links.set(body.email, {
            challenge: body.code_challenge,
            method: body.code_challenge_method,
            redirect: url.searchParams.get('redirect_to'),
          });
        return reply({});
      }
      if (
        url.pathname === '/auth/v1/token' &&
        url.searchParams.get('grant_type') === 'pkce'
      ) {
        const issued = codes.get(body.auth_code);
        codes.delete(body.auth_code);
        const expected =
          issued?.method?.toLowerCase() === 's256'
            ? crypto
                .createHash('sha256')
                .update(body.code_verifier || '')
                .digest('base64url')
            : body.code_verifier;
        if (!issued || expected !== issued.challenge)
          return reply(
            { error_code: 'bad_code_verifier', msg: 'code challenge does not match' },
            400,
          );
        return reply(session(userByEmail(issued.email)));
      }
      if (url.pathname === '/auth/v1/verify')
        return reply(
          session(body.email === 'b@example.test' ? USER_B : USER_A),
        );
      if (url.pathname === '/auth/v1/token')
        return reply(
          session(body.refresh_token?.includes(USER_B) ? USER_B : USER_A),
        );
      if (url.pathname === '/auth/v1/logout') return reply({});
      const user = userFrom(req.headers.authorization || '');
      if (!user) return reply({ message: 'authentication required' }, 401);
      if (url.pathname === '/auth/v1/user') return reply(session(user).user);
      if (url.pathname === '/rest/v1/rpc/sync_pull')
        return reply(
          await serialize(() =>
            pg.pull(user, body.p_cursor, body.p_epoch, body.p_device),
          ),
        );
      if (url.pathname === '/rest/v1/rpc/sync_push') {
        const result = await serialize(() =>
          pg.push(body.p_operation, body.p_epoch, user),
        );
        reply(result);
        for (const [socket, channels] of subscribers)
          for (const channel of channels)
            if (channel.user === user && socket.readyState === 1)
              socket.send(
                JSON.stringify([
                  null,
                  null,
                  channel.topic,
                  'broadcast',
                  {
                    event: 'changed',
                    payload: { revision: result.cursor },
                    type: 'broadcast',
                  },
                ]),
              );
        return;
      }
      const objectPath = url.pathname.replace(
        /^\/storage\/v1\/object\/(?:authenticated\/)?to3mato\//,
        '',
      );
      if (objectPath !== url.pathname) {
        if (!objectPath.startsWith(user + '/'))
          return reply({ message: 'denied' }, 403);
        if (req.method === 'POST') {
          if (files.has(objectPath))
            return reply({ message: 'already exists' }, 409);
          files.set(objectPath, { bytes, mime: req.headers['content-type'] });
          await serialize(() =>
            pg.db.query(
              "insert into storage.objects(bucket_id,name,metadata) values ('to3mato',$1,$2::jsonb)",
              [objectPath, JSON.stringify({ size: bytes.length })],
            ),
          );
          return reply({ Key: `to3mato/${objectPath}` });
        }
        const file = files.get(objectPath);
        if (!file) return reply({ message: 'not found' }, 404);
        res.writeHead(200, { 'Content-Type': file.mime });
        res.end(file.bytes);
        return;
      }
      reply({ message: 'not found' }, 404);
    } catch (error) {
      events.push({
        path: url.pathname,
        error: error.message,
        details: error.where,
      });
      reply({ message: error.message, code: error.code }, 400);
    }
  });
  const ws = new WebSocketServer({ server });
  ws.on('connection', (socket) => {
    subscribers.set(socket, []);
    socket.on('message', (raw) => {
      const [join_ref, ref, topic, event, payload] = JSON.parse(raw.toString());
      const msg = { join_ref, ref, topic, event, payload };
      events.push({
        event: msg.event,
        topic: msg.topic,
        hasToken: !!msg.payload?.access_token,
      });
      if (msg.event === 'phx_join') {
        const user = userFrom(`Bearer ${msg.payload.access_token}`);
        const allowed = msg.topic === `realtime:account:${user}`;
        if (allowed) subscribers.get(socket).push({ topic: msg.topic, user });
        socket.send(
          JSON.stringify([
            msg.join_ref,
            msg.ref,
            msg.topic,
            'phx_reply',
            {
              status: allowed ? 'ok' : 'error',
              response: { postgres_changes: [] },
            },
          ]),
        );
      } else if (msg.event === 'heartbeat' || msg.event === 'phx_leave')
        socket.send(
          JSON.stringify([
            msg.join_ref,
            msg.ref,
            msg.topic,
            'phx_reply',
            { status: 'ok', response: {} },
          ]),
        );
    });
    socket.on('close', () => subscribers.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    pg,
    events,
    /** The callback URL a click on the last emailed link would open. */
    linkFor(email) {
      const link = links.get(email);
      if (!link?.redirect) throw new Error(`no sign-in link for ${email}`);
      const code = crypto.randomUUID();
      codes.set(code, { ...link, email });
      const target = new URL(link.redirect);
      target.searchParams.set('code', code);
      return target.toString();
    },
    offline(value) {
      disconnected = value;
      if (value) for (const socket of subscribers.keys()) socket.close();
    },
    async close() {
      for (const socket of subscribers.keys()) socket.terminate();
      ws.close();
      await new Promise((resolve) => server.close(resolve));
      await pg.db.close();
    },
  };
}
