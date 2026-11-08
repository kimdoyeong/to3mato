-- Public profiles for the microblog share link (me.to3mato.com/<slug>).
-- The app uploads only an aggregated snapshot of the sections the user turned on.
-- Anonymous visitors read through public_profile(); the table itself stays private.
create schema if not exists profile_private;
revoke all on schema profile_private from public, anon, authenticated;

create table public.public_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 slug text not null unique check (slug ~ '^[a-hjkmnp-z2-9]{10}$'),
 display_name text check (display_name is null or (char_length(display_name) between 1 and 20 and display_name !~ '[[:cntrl:]]' and display_name = btrim(display_name))),
 photo text check (photo is null or photo ~ '^[0-9a-f-]{36}/photo-[0-9a-f-]{36}\.jpg$'),
 visibility jsonb not null default '{"video":false,"focus":false,"projects":false,"tasks":false,"memo":false}'::jsonb,
 snapshot jsonb not null default '{}'::jsonb check (pg_column_size(snapshot) <= 65536),
 active boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.public_profiles enable row level security;
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to authenticated;
create policy own_profile_read on public.public_profiles for select to authenticated
 using (user_id = (select auth.uid()));

create function profile_private.assert(p_ok boolean, p_message text default 'invalid profile data') returns void
language plpgsql set search_path = '' as $$ begin
 if p_ok is distinct from true then raise exception '%', p_message using errcode='22023'; end if;
end $$;
create function profile_private.num(v jsonb, lo numeric, hi numeric) returns boolean
language plpgsql immutable set search_path = '' as $$ begin
 if jsonb_typeof(v) <> 'number' then return false; end if;
 return (v::text)::numeric between lo and hi;
end $$;
create function profile_private.str(v jsonb, lo integer, hi integer) returns boolean
language sql immutable set search_path = '' as $$ select jsonb_typeof(v)='string' and char_length(v #>> '{}') between lo and hi $$;
create function profile_private.color(v jsonb) returns boolean
language sql immutable set search_path = '' as $$ select jsonb_typeof(v)='string' and (v #>> '{}') ~ '^#[0-9a-fA-F]{6}$' $$;

create function profile_private.validate_visibility(v jsonb) returns void
language plpgsql set search_path = '' as $$
declare k text; begin
 perform profile_private.assert(jsonb_typeof(v)='object');
 for k in select jsonb_object_keys(v) loop
  perform profile_private.assert(k in ('video','focus','projects','tasks','memo') and jsonb_typeof(v->k)='boolean');
 end loop;
end $$;

-- Mirrors buildSnapshot() in src/lib/public-profile.mjs.
create function profile_private.validate_snapshot(s jsonb, p_user uuid) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; k text; begin
 perform profile_private.assert(jsonb_typeof(s)='object' and s->'v'='1'::jsonb);
 for k in select jsonb_object_keys(s) loop
  perform profile_private.assert(k in ('v','date','timeZone','days','today','focusSeconds','projects','tasks','video'));
 end loop;
 perform profile_private.assert(jsonb_typeof(s->'date')='string' and (s->>'date') ~ '^\d{4}-\d{2}-\d{2}$');
 perform profile_private.assert(profile_private.str(s->'timeZone',1,64));
 perform profile_private.assert(jsonb_typeof(s->'days')='array' and jsonb_array_length(s->'days') between 1 and 140);
 for item in select value from jsonb_array_elements(s->'days') loop
  perform profile_private.assert(profile_private.num(item,0,500));
 end loop;
 perform profile_private.assert(profile_private.num(s->'today',0,500));
 if s ? 'focusSeconds' then perform profile_private.assert(profile_private.num(s->'focusSeconds',0,86400)); end if;
 if s ? 'projects' then
  perform profile_private.assert(jsonb_typeof(s->'projects')='array' and jsonb_array_length(s->'projects') <= 20);
  for item in select value from jsonb_array_elements(s->'projects') loop
   perform profile_private.assert(jsonb_typeof(item)='object' and profile_private.str(item->'name',1,80) and profile_private.color(item->'color') and profile_private.num(item->'count',0,100000));
  end loop;
 end if;
 if s ? 'tasks' then
  perform profile_private.assert(jsonb_typeof(s->'tasks')='array' and jsonb_array_length(s->'tasks') <= 30);
  for item in select value from jsonb_array_elements(s->'tasks') loop
   perform profile_private.assert(jsonb_typeof(item)='object' and profile_private.str(item->'title',1,120)
    and profile_private.num(item->'used',0,100) and profile_private.num(item->'estimate',0,100)
    and profile_private.num(item->'at',0,9007199254740991)
    and (not item ? 'note' or profile_private.str(item->'note',1,500))
    and (not item ? 'project' or (jsonb_typeof(item->'project')='object' and profile_private.str(item->'project'->'name',1,80) and profile_private.color(item->'project'->'color'))));
  end loop;
 end if;
 if s ? 'video' then
  perform profile_private.assert(jsonb_typeof(s->'video')='object'
   and jsonb_typeof(s->'video'->'path')='string'
   and (s->'video'->>'path') ~ ('^'||p_user::text||'/video-[A-Za-z0-9_-]{1,80}\.(mp4|webm)$')
   and jsonb_typeof(s->'video'->'weekStart')='string' and (s->'video'->>'weekStart') ~ '^\d{4}-\d{2}-\d{2}$');
 end if;
end $$;
revoke all on all functions in schema profile_private from public, anon, authenticated;

create function profile_private.new_slug() returns text
language plpgsql volatile set search_path = '' as $$
declare alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; bytes bytea; result text; i integer; begin
 loop
  bytes := uuid_send(gen_random_uuid());
  result := '';
  for i in 0..9 loop result := result || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1); end loop;
  exit when not exists(select 1 from public.public_profiles where slug = result);
 end loop;
 return result;
end $$;
revoke all on function profile_private.new_slug() from public, anon, authenticated;

-- Saves the owner's profile. p_activate starts or restarts sharing and needs a name.
-- Without it a stopped profile keeps only its name, photo and visibility; no activity is stored.
create function public.profile_save(p_name text, p_photo text, p_visibility jsonb, p_snapshot jsonb, p_activate boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); row public.public_profiles; begin
 perform profile_private.assert(uid is not null, 'authentication required');
 perform profile_private.validate_visibility(p_visibility);
 if p_photo is not null then
  perform profile_private.assert(p_photo ~ ('^'||uid::text||'/photo-[0-9a-f-]{36}\.jpg$'));
 end if;
 if p_snapshot is not null then perform profile_private.validate_snapshot(p_snapshot, uid); end if;
 insert into public.public_profiles(user_id, slug) values (uid, profile_private.new_slug()) on conflict (user_id) do nothing;
 select * into row from public.public_profiles where user_id = uid for update;
 if p_name is not null then row.display_name := btrim(p_name); end if;
 if p_activate then
  perform profile_private.assert(row.display_name is not null and char_length(row.display_name) > 0, 'display name required');
  perform profile_private.assert(p_snapshot is not null, 'snapshot required');
  row.active := true;
 end if;
 update public.public_profiles set
  display_name = row.display_name,
  photo = p_photo,
  visibility = p_visibility,
  snapshot = case when row.active and p_snapshot is not null then p_snapshot when row.active then snapshot else '{}'::jsonb end,
  active = row.active,
  updated_at = now()
 where user_id = uid returning * into row;
 return jsonb_build_object('slug', row.slug, 'active', row.active, 'name', row.display_name, 'photo', row.photo, 'visibility', row.visibility);
end $$;
revoke all on function public.profile_save(text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.profile_save(text, text, jsonb, jsonb, boolean) to authenticated;

-- Stops sharing. The link returns 404 and the stored activity is cleared.
-- Slug, name, photo and visibility stay so sharing again reuses the same link.
create function public.profile_stop() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); row public.public_profiles; begin
 perform profile_private.assert(uid is not null, 'authentication required');
 update public.public_profiles set active = false, snapshot = '{}'::jsonb, updated_at = now()
 where user_id = uid returning * into row;
 if not found then return null; end if;
 return jsonb_build_object('slug', row.slug, 'active', row.active, 'name', row.display_name, 'photo', row.photo, 'visibility', row.visibility);
end $$;
revoke all on function public.profile_stop() from public, anon;
grant execute on function public.profile_stop() to authenticated;

-- The only anonymous entry point. Returns nothing for unknown or stopped profiles.
create function public.public_profile(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('slug', p.slug, 'name', p.display_name, 'photo', p.photo, 'snapshot', p.snapshot)
 from public.public_profiles p
 where p_slug ~ '^[a-hjkmnp-z2-9]{10}$' and p.slug = p_slug and p.active and p.display_name is not null
$$;
revoke all on function public.public_profile(text) from public;
grant execute on function public.public_profile(text) to anon, authenticated;

-- Public files: the processed profile photo and the latest weekly video.
-- Paths are unguessable and owners delete them when they are replaced or sharing stops.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('profiles','profiles',true,52428800,array['image/jpeg','video/webm','video/mp4']) on conflict(id) do nothing;
create policy profile_file_read on storage.objects for select to authenticated using (
 bucket_id='profiles' and (storage.foldername(name))[1]=(select auth.uid())::text
);
create policy profile_file_upload on storage.objects for insert to authenticated with check (
 bucket_id='profiles' and (storage.foldername(name))[1]=(select auth.uid())::text
 and (name ~ '/photo-[0-9a-f-]{36}\.jpg$' or name ~ '/video-[A-Za-z0-9_-]{1,80}\.(mp4|webm)$')
);
create policy profile_file_delete on storage.objects for delete to authenticated using (
 bucket_id='profiles' and (storage.foldername(name))[1]=(select auth.uid())::text
);
