import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncPostgres, USER_A, USER_B } from './helpers/sync-postgres.mjs';

const migration = new URL(
  '../supabase/migrations/202611080001_public_profiles.sql',
  import.meta.url,
);
const snapshot = (extra = {}) => ({
  v: 1,
  date: '2026-11-08',
  timeZone: 'Asia/Seoul',
  days: [0, 1, 2.5],
  today: 2.5,
  ...extra,
});
const visibility = { video: false, focus: false, projects: false, tasks: false, memo: false };

async function setup(t) {
  const server = await syncPostgres();
  t.after(() => server.db.close());
  await server.db.exec(await fs.readFile(migration, 'utf8'));
  const call = (user, sql, params) =>
    server.as(user, async () => (await server.db.query(sql, params)).rows[0]?.result);
  const save = (user, { name = null, photo = null, vis = visibility, snap = snapshot(), activate = false } = {}) =>
    call(user, 'select public.profile_save($1,$2,$3::jsonb,$4::jsonb,$5) as result', [
      name,
      photo,
      JSON.stringify(vis),
      snap === null ? null : JSON.stringify(snap),
      activate,
    ]);
  const anon = async (slug) => {
    await server.db.exec('set role anon');
    try {
      return (await server.db.query('select public.public_profile($1) as result', [slug])).rows[0].result;
    } finally {
      await server.db.exec('reset role');
    }
  };
  return { server, call, save, anon };
}

test('sharing publishes, stopping hides and sharing again reuses the link', async (t) => {
  const { save, anon, call } = await setup(t);
  await assert.rejects(save(USER_A, { activate: true }), /display name required/);
  const draft = await save(USER_A, { vis: { ...visibility, tasks: true } });
  assert.equal(draft.active, false);
  assert.match(draft.slug, /^[a-hjkmnp-z2-9]{10}$/);
  assert.equal(await anon(draft.slug), null, 'never shared');

  const shared = await save(USER_A, { name: ' 토마토 ', activate: true });
  assert.equal(shared.slug, draft.slug);
  assert.equal(shared.name, '토마토');
  const page = await anon(shared.slug);
  assert.equal(page.name, '토마토');
  assert.equal(page.snapshot.today, 2.5);
  assert.equal(page.photo, null);

  await save(USER_A, { snap: snapshot({ today: 3 }) });
  assert.equal((await anon(shared.slug)).snapshot.today, 3, 'automatic updates while shared');

  const stopped = await call(USER_A, 'select public.profile_stop() as result');
  assert.equal(stopped.active, false);
  assert.equal(await anon(shared.slug), null);
  await save(USER_A, { snap: snapshot({ today: 9 }) });
  const row = await call(USER_A, 'select to_jsonb(p) as result from public.public_profiles p');
  assert.deepEqual(row.snapshot, {}, 'no activity is stored while stopped');
  assert.equal(row.display_name, '토마토');

  const again = await save(USER_A, { activate: true });
  assert.equal(again.slug, shared.slug, 'same link');
  assert.equal((await anon(shared.slug)).snapshot.today, 2.5);
});

test('profiles are isolated and inputs are validated', async (t) => {
  const { save, call, server, anon } = await setup(t);
  const a = await save(USER_A, { name: 'a', activate: true });
  const b = await save(USER_B, { name: 'b', activate: true });
  assert.notEqual(a.slug, b.slug);
  const seen = await call(USER_A, 'select count(*)::int as result from public.public_profiles');
  assert.equal(seen, 1, 'owners read only their row');
  await assert.rejects(
    server.as(USER_A, () => server.db.query("update public.public_profiles set active=false")),
    /permission denied/,
  );
  await server.db.exec('set role anon');
  await assert.rejects(server.db.query('select * from public.public_profiles'), /permission denied/);
  await assert.rejects(server.db.query("select public.profile_stop()"), /permission denied/);
  await server.db.exec('reset role');

  await assert.rejects(save(USER_A, { name: 'x'.repeat(21) }), /check constraint|violates/);
  await assert.rejects(save(USER_A, { vis: { secret: true } }), /invalid profile data/);
  await assert.rejects(save(USER_A, { photo: `${USER_B}/photo-${USER_B}.jpg` }), /invalid profile data/);
  await assert.rejects(save(USER_A, { snap: snapshot({ extra: 1 }) }), /invalid profile data/);
  await assert.rejects(save(USER_A, { snap: snapshot({ days: new Array(141).fill(0) }) }), /invalid profile data/);
  await assert.rejects(
    save(USER_A, { snap: snapshot({ video: { path: `${USER_B}/video-x.webm`, weekStart: '2026-10-26' } }) }),
    /invalid profile data/,
  );
  await assert.rejects(
    save(USER_A, { snap: snapshot({ tasks: [{ title: '', used: 1, estimate: 1, at: 1 }] }) }),
    /invalid profile data/,
  );
  const ok = await save(USER_A, {
    photo: `${USER_A}/photo-${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.jpg`,
    snap: snapshot({
      focusSeconds: 3600,
      projects: [{ name: 'p', color: '#aabbcc', count: 2 }],
      tasks: [{ title: 't', used: 1.5, estimate: 2, at: 1, note: 'n', project: { name: 'p', color: '#aabbcc' } }],
      video: { path: `${USER_A}/video-abc_1.webm`, weekStart: '2026-10-26' },
    }),
  });
  assert.ok(ok.photo.endsWith('.jpg'));
  assert.equal((await anon(a.slug)).snapshot.tasks[0].note, 'n');
  assert.equal(await anon('../etc'), null);
});
