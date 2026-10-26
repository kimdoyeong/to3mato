import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncPostgres,
  USER_A,
  USER_B,
  DEVICE_A,
  DEVICE_B,
} from './helpers/sync-postgres.mjs';
import {
  createEnvelope,
  emptyState,
  importOperation,
  prepareOperation,
  reduceOperation,
  applyServerChanges,
  extraOperation,
} from '../src/lib/sync/protocol.mjs';

test('PostgreSQL Storage and private Broadcast isolate accounts and enforce file reservations', async (t) => {
  const server = await syncPostgres();
  t.after(() => server.db.close());
  const first = await server.pull(),
    env = createEnvelope(emptyState(), USER_A, DEVICE_A);
  env.confirmed = first.document;
  const asset = {
    path: `${USER_A}/clip.webm`,
    hash: 'a'.repeat(64),
    size: 10,
    mime: 'video/webm',
    status: 'pending',
    name: 'clip.webm',
  };
  async function extra(id, fields, deleted = false) {
    const result = await server.push(
      extraOperation(env, 'assets', id, fields, deleted),
      first.epoch,
    );
    env.confirmed = result.document;
    return result;
  }
  await extra('clip.webm', asset);
  const insert = (user, size) =>
    server.as(user, () =>
      server.db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('to3mato',$1,jsonb_build_object('size',$2::int))",
        [asset.path, size],
      ),
    );
  await assert.rejects(insert(USER_B, 10), /row-level security/);
  await assert.rejects(insert(USER_A, 11), /row-level security/);
  await insert(USER_A, 10);
  assert.equal(
    (
      await server.as(USER_A, () =>
        server.db.query('select * from storage.objects'),
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await server.as(USER_B, () =>
        server.db.query('select * from storage.objects'),
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await server.as(USER_A, () =>
        server.db.query("update storage.objects set metadata='{}' returning *"),
      )
    ).rows.length,
    0,
  );
  await extra('clip.webm', { status: 'ready' });
  await extra('clip.webm', {}, true);
  assert.equal(
    (
      await server.as(USER_A, () =>
        server.db.query('select * from storage.objects'),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(insert(USER_A, 10), /row-level security/);
  await extra('too-large.webm', {
    ...asset,
    path: `${USER_A}/too-large.webm`,
    size: 262144001,
  });
  assert.equal(
    (
      await server.as(USER_A, () =>
        server.db.query('select public.sync_can_upload($1) as allowed', [
          `${USER_A}/too-large.webm`,
        ]),
      )
    ).rows[0].allowed,
    false,
  );
  await server.db.exec("insert into realtime.messages values('notification')");
  await server.db.query("select set_config('realtime.topic',$1,false)", [
    `account:${USER_A}`,
  ]);
  assert.equal(
    (
      await server.as(USER_A, () =>
        server.db.query('select * from realtime.messages'),
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await server.as(USER_B, () =>
        server.db.query('select * from realtime.messages'),
      )
    ).rows.length,
    0,
  );
});

test('PostgreSQL protocol: isolation, field merge, timer concurrency, idempotence and deltas', async (t) => {
  const server = await syncPostgres();
  t.after(() => server.db.close());
  let snapshot = await server.pull();
  const envelope = createEnvelope(emptyState(), USER_A, DEVICE_A);
  envelope.confirmed = snapshot.document;
  const initial = emptyState();
  initial.projects.push({
    id: 'p',
    name: 'project',
    icon: 'folder',
    color: '#84956c',
    outcome: '',
    image: '',
  });
  initial.tasks.push({
    id: 't',
    title: 'task',
    estimate: 2,
    remaining: 2,
    followUpOf: '',
    project: 'p',
    date: '',
    done: false,
  });
  let op = importOperation(envelope, initial);
  snapshot = await server.push(op, snapshot.epoch);
  envelope.confirmed = snapshot.document;
  const original = structuredClone(snapshot);
  await t.test(
    'same operation is applied once; altered reuse is refused',
    async () => {
      const again = await server.push(op, snapshot.epoch);
      assert.equal(again.cursor, snapshot.cursor);
      await assert.rejects(
        server.push({ ...op, at: op.at + 1 }, snapshot.epoch),
        /operation id reused/,
      );
    },
  );
  await t.test(
    'RLS and direct writes cannot cross accounts or bypass RPC',
    async () => {
      await server.pull(USER_B);
      const other = await server.as(USER_B, () =>
        server.db.query('select * from public.tasks'),
      );
      assert.equal(other.rows.length, 0);
      await assert.rejects(
        server.as(USER_B, () =>
          server.db.exec(
            "insert into public.tasks(user_id,id,data,revision) values ('00000000-0000-4000-8000-000000000001','bad','{}',1)",
          ),
        ),
        /permission denied/,
      );
      await assert.rejects(
        server.as(USER_A, () =>
          server.db.exec("select sync_private.empty_document('UTC')"),
        ),
        /permission denied/,
      );
    },
  );
  const base = Date.now() - 7200000;
  async function command(type, payload, at) {
    op = prepareOperation(envelope, { type, payload }, at, true);
    const predicted = reduceOperation(envelope.confirmed, op, at).document;
    const result = await server.push(op, snapshot.epoch);
    assert.equal(result.conflict, false);
    assert.deepEqual(result.document, predicted, `JS/SQL mismatch for ${type}`);
    snapshot = result;
    envelope.confirmed = result.document;
    envelope.cursor = result.cursor;
    return op;
  }
  await t.test(
    'all shared timer transitions agree with the JS domain',
    async () => {
      await command('timer:play', { id: 't' }, base);
      const start = structuredClone(envelope);
      await command('timer:pause', {}, base + 15000);
      const stale = prepareOperation(
        start,
        { type: 'timer:end' },
        base + 20000,
        true,
      );
      const collision = await server.push(stale, snapshot.epoch);
      assert.equal(collision.conflict, true);
      assert.equal(collision.document.state.records.length, 0);
      await command('timer:toggle', {}, base + 30000);
      await command('timer:advance', {}, base + 2000000);
      assert.equal(snapshot.document.state.records.length, 1);
      assert.equal(snapshot.document.state.records[0].at, base + 1515000);
      const completed = op;
      await server.push(completed, snapshot.epoch);
      assert.equal((await server.pull()).document.state.records.length, 1);
      await command('checkin:followup', {}, base + 2100000);
      await command('timer:end', {}, base + 2110000);
      await command('timer:play', { id: 't' }, base + 2120000);
      await command('task:toggle', { id: 't' }, base + 2130000);
      await command('task:toggle', { id: 't' }, base + 2140000);
      assert.equal(snapshot.document.state.tickets[0].voided, true);
      await command('project:delete', { id: 'p' }, base + 2150000);
      assert.equal(snapshot.document.state.tasks[0].project, '');
    },
  );
  await t.test(
    'cursor deltas reproduce the snapshot without skipped revisions',
    async () => {
      const delta = await server.pull(
        USER_A,
        original.cursor,
        original.epoch,
        DEVICE_B,
      );
      const applied = applyServerChanges(
        original.document,
        delta.changes,
        original.cursor,
      );
      assert.deepEqual(applied, snapshot.document);
      await assert.rejects(
        server.push({ ...op, id: crypto.randomUUID() }, 'bad-epoch'),
        /sync epoch changed/,
      );
    },
  );
  await t.test(
    'adopting a local timer settles an overdue shared session at its deadline',
    async () => {
      await command('timer:play', { id: 't' }, base + 2160000);
      const desired = {
        taskId: 't',
        phase: 'focus',
        duration: 1500,
        elapsed: 30,
        startedAt: base + 2200000,
        running: false,
      };
      await command('timer:adopt', { timer: desired }, base + 4000000);
      assert.equal(snapshot.document.state.records.at(-1).at, base + 3660000);
      await command('timer:advance', {}, base + 4100000);
      assert.equal(snapshot.document.state.timer.running, false);
      assert.equal(snapshot.document.state.timer.elapsed, 30);
    },
  );
  await t.test(
    'imports add and update without deleting absent rows',
    async () => {
      const imported = emptyState();
      imported.tasks.push({
        ...snapshot.document.state.tasks[0],
        title: 'imported',
      });
      const count = snapshot.document.state.tasks.length;
      const result = await server.push(
        importOperation(envelope, imported),
        snapshot.epoch,
      );
      assert.equal(result.document.state.tasks.length, count);
    },
  );
});
