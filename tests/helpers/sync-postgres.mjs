import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';

export const USER_A = '00000000-0000-4000-8000-000000000001';
export const USER_B = '00000000-0000-4000-8000-000000000002';
export const DEVICE_A = '10000000-0000-4000-8000-000000000001';
export const DEVICE_B = '10000000-0000-4000-8000-000000000002';
export async function syncPostgres() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema realtime; create schema storage;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table realtime.messages (topic text); alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
    create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$ select $$;
    create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    grant usage on schema storage,realtime to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on realtime.messages to authenticated;
    insert into auth.users values('${USER_A}'),('${USER_B}');
  `);
  await db.exec(
    await fs.readFile(
      new URL(
        '../../supabase/migrations/202610260001_sync.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  async function as(user, fn) {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }
  return {
    db,
    as,
    async pull(user = USER_A, cursor = '0', epoch = null, device = DEVICE_A) {
      return as(
        user,
        async () =>
          (
            await db.query('select public.sync_pull($1,$2,$3,$4) as result', [
              epoch,
              cursor,
              device,
              'UTC',
            ])
          ).rows[0].result,
      );
    },
    async push(operation, epoch, user = USER_A) {
      return as(
        user,
        async () =>
          (
            await db.query('select public.sync_push($1::jsonb,$2) as result', [
              JSON.stringify(operation),
              epoch,
            ])
          ).rows[0].result,
      );
    },
  };
}
