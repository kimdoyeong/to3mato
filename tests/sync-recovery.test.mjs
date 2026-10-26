import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  syncPostgres,
  USER_A,
  USER_B,
  DEVICE_A,
} from './helpers/sync-postgres.mjs';
import { createSyncEngine, createClock } from '../src/lib/sync/engine.mjs';
import {
  createEnvelope,
  emptyState,
  projectedState,
  prepareOperation,
} from '../src/lib/sync/protocol.mjs';
import { openAccountRepository } from '../electron/sync-repository.mjs';
import {
  secureSessionStorage,
  supabaseConfiguration,
} from '../electron/auth.mjs';
import {
  setCalendarTimeZone,
  dateInZone,
  calendarWeek,
} from '../src/lib/calendar-time.mjs';

test('overlapping offline sessions retain their original local records in the conflict archive', async (t) => {
  const server = await syncPostgres();
  t.after(() => server.db.close());
  let value = createEnvelope(emptyState(), USER_A, DEVICE_A),
    time = Date.now() - 120000;
  const engine = createSyncEngine({
    repository: {
      read: () => structuredClone(value),
      write: (next) => {
        value = structuredClone(next);
      },
    },
    clock: { now: () => time, sample() {} },
    intervalMs: 3600000,
    transport: {
      subscribe: () => ({ unsubscribe() {} }),
      pull: ({ epoch, cursor }) => server.pull(USER_A, cursor, epoch),
      push: ({ operation, epoch }) => server.push(operation, epoch),
    },
  });
  t.after(() => engine.destroy());
  await engine.enable();
  await engine.syncNow();
  await engine.dispatch({
    type: 'task:save',
    payload: { title: 'local focus', estimate: 1, date: '', project: '' },
  });
  await engine.syncNow();
  const id = engine.state().tasks[0].id;
  await engine.disable();
  await engine.dispatch({ type: 'timer:play', payload: { id } });
  time += 30000;
  await engine.dispatch({ type: 'timer:end' });
  assert.equal(engine.state().records[0].seconds, 30);
  const snapshot = await server.pull(),
    other = createEnvelope(emptyState(), USER_A, DEVICE_A);
  other.confirmed = snapshot.document;
  await server.push(
    prepareOperation(
      other,
      { type: 'timer:play', payload: { id } },
      time + 1000,
      true,
    ),
    snapshot.epoch,
  );
  await engine.enable();
  await engine.syncNow();
  assert.equal(engine.state().records.length, 0);
  assert.equal(engine.status().pending, 0);
  assert.equal(value.conflicts.length, 2);
  assert.equal(
    value.conflicts.find((c) => c.operation.command.type === 'timer:end')
      .document.state.records[0].seconds,
    30,
  );
  assert.deepEqual(value.localEvidence, {});
});

test('durable outbox survives lost acknowledgements, disconnect, bad data and epoch recovery', async (t) => {
  const server = await syncPostgres();
  t.after(() => server.db.close());
  let value = createEnvelope(emptyState(), USER_A, DEVICE_A),
    lost = false,
    invalid = false;
  const repo = {
    read: () => structuredClone(value),
    write: (next) => {
      value = structuredClone(next);
    },
  };
  const transport = {
    subscribe: () => ({ unsubscribe() {} }),
    async pull({ epoch, cursor }) {
      const response = await server.pull(USER_A, cursor, epoch);
      return invalid ? { ...response, version: 99 } : response;
    },
    async push({ operation, epoch }) {
      const response = await server.push(operation, epoch);
      if (lost) {
        lost = false;
        throw new Error('lost acknowledgement');
      }
      return response;
    },
  };
  const engine = createSyncEngine({
    repository: repo,
    transport,
    intervalMs: 3600000,
  });
  t.after(() => engine.destroy());
  await engine.enable();
  await engine.syncNow();
  lost = true;
  await engine.dispatch({
    type: 'task:save',
    payload: { title: 'persisted', estimate: 1, date: '', project: '' },
  });
  await engine.syncNow();
  assert.equal(repo.read().pending.length, 1);
  await engine.syncNow();
  assert.equal(repo.read().pending.length, 0);
  assert.equal(engine.state().tasks.length, 1);
  await engine.disable();
  await engine.dispatch({ type: 'project:save', payload: { name: 'offline' } });
  const pending = repo.read().pending;
  assert.equal(pending.length, 1);
  assert.equal((await server.pull()).document.state.projects.length, 0);
  const cursor = repo.read().cursor;
  invalid = true;
  await engine.enable();
  await engine.syncNow();
  assert.equal(repo.read().cursor, cursor);
  assert.deepEqual(repo.read().pending, pending);
  invalid = false;
  await server.db.exec(
    `update public.account_sync_state set epoch=gen_random_uuid() where user_id='${USER_A}'`,
  );
  await engine.syncNow();
  assert.equal(engine.state().projects[0].name, 'offline');
  assert.equal(engine.status().pending, 0);
  assert.equal(engine.state().tasks[0].title, 'persisted');
});

test('account SQLite storage isolates identities and commits state with outbox atomically', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-account-'));
  let a = openAccountRepository(directory, USER_A, { seed: emptyState() }),
    b;
  t.after(() => {
    a?.close();
    b?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const next = a.read();
  next.pending.push({
    id: crypto.randomUUID(),
    version: 1,
    deviceId: next.deviceId,
    at: Date.now(),
    kind: 'patch',
    patches: [
      {
        entity: 'projects',
        id: 'p',
        create: true,
        fields: {
          name: 'private',
          icon: 'folder',
          color: '#84956c',
          outcome: '',
          image: '',
        },
      },
    ],
  });
  a.write(next);
  a.close();
  a = openAccountRepository(directory, USER_A);
  assert.equal(a.read().pending.length, 1);
  assert.equal(projectedState(a.read()).projects[0].name, 'private');
  b = openAccountRepository(directory, USER_B);
  assert.deepEqual(projectedState(b.read()).projects, []);
  assert.throws(() => b.write(a.read()), /계정 저장소/);
  const failed = a.read();
  failed.pending[0].patches[0].fields.name = 'must roll back';
  a.store.db.exec(
    "create trigger fail_sync before update on sync_document begin select raise(abort,'disk failure'); end",
  );
  assert.throws(() => a.write(failed), /disk failure/);
  assert.equal(a.store.readState().projects[0].name, 'private');
  assert.equal(
    a.store.readEnvelope().pending[0].patches[0].fields.name,
    'private',
  );
});

test('session storage requires real encryption and rejects secret application keys', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'to3mato-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const unsafe = secureSessionStorage(directory, {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text',
  });
  assert.throws(() => unsafe.setItem('session', 'do not store'), /안전하게/);
  assert.equal(fs.existsSync(path.join(directory, 'session.bin')), false);
  assert.throws(
    () =>
      supabaseConfiguration({
        TO3MATO_SUPABASE_URL: 'https://example.supabase.co',
        TO3MATO_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_not-for-client',
      }),
    /공개 키/,
  );
  assert.equal(supabaseConfiguration({}), null);
});

test('clock and calendar stay stable across device wall-clock and timezone changes', () => {
  let wall = 10000,
    mono = 0;
  const clock = createClock({ wall: () => wall, monotonic: () => mono });
  wall += 1000000;
  mono = 500;
  assert.equal(clock.now(), 10500);
  clock.sample(20000, 10400);
  assert.equal(clock.now(), 20050);
  wall += 30000;
  clock.resume();
  assert.equal(clock.now(), 50050);
  setCalendarTimeZone('America/New_York');
  assert.equal(dateInZone(new Date('2026-03-09T03:30:00Z')), '2026-03-08');
  const week = calendarWeek(0, new Date('2026-03-08T12:00:00Z'));
  assert.equal(week.start.toISOString(), '2026-03-02T05:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-03-09T04:00:00.000Z');
  setCalendarTimeZone(undefined);
});
