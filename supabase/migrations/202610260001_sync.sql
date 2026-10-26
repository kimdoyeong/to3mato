-- All writes take the account row lock. Revisions are allocated under that lock,
-- so a lower revision can never commit after a higher revision for the same user.
create schema if not exists sync_private;
revoke all on schema sync_private from public, anon, authenticated;

create function sync_private.empty_document(p_timezone text) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_build_object('version',1,'timeZone',p_timezone,'tombstones','{}'::jsonb,
 'timer',jsonb_build_object('sessionId',null,'revision','','controller',null),
 'extras','{"rituals":[],"assets":[],"clips":[],"deliveries":[]}'::jsonb,
 'state','{"version":1,"projects":[],"tasks":[],"records":[],"tickets":[],"templates":[],"timer":null,"settings":{"focus":1500,"rest":300,"dailyCapacity":8,"planAt":"","reviewAt":"","remindDays":[1,2,3,4,5]}}'::jsonb)
$$;
create table public.account_sync_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 epoch uuid not null default gen_random_uuid(), revision bigint not null default 0,
 document jsonb not null, deleting boolean not null default false
);
create table public.devices (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, last_sync_at timestamptz not null default now(), primary key(user_id,id)
);
create table public.processed_operations (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, operation jsonb not null, conflict boolean not null,
 reason text, revision bigint not null, primary key(user_id,id)
);
create table public.sync_changes (
 user_id uuid not null references auth.users(id) on delete cascade,
 revision bigint not null, operation_id uuid not null, delta jsonb not null,
 created_at timestamptz not null default now(), primary key(user_id,revision)
);
do $$ declare name text; begin
 foreach name in array array['projects','tasks','focus_records','tickets','templates','user_settings','ritual_completions','timer_sessions','assets','clips','deliveries'] loop
 execute format('create table public.%I (user_id uuid not null references auth.users(id) on delete cascade, id text not null, data jsonb not null, position integer not null default 0, deleted boolean not null default false, revision bigint not null, created_at timestamptz not null default now(), primary key(user_id,id))', name);
 end loop;
 foreach name in array array['account_sync_state','devices','processed_operations','sync_changes','projects','tasks','focus_records','tickets','templates','user_settings','ritual_completions','timer_sessions','assets','clips','deliveries'] loop
 execute format('alter table public.%I enable row level security',name);
 execute format('revoke all on public.%I from anon, authenticated',name);
 execute format('grant select on public.%I to authenticated',name);
 execute format('grant all on public.%I to service_role',name);
 execute format('create policy own_read on public.%I for select to authenticated using (user_id = (select auth.uid()))',name);
 end loop;
end $$;

create function sync_private.assert(p_ok boolean, p_message text default 'invalid sync data') returns void
language plpgsql set search_path = '' as $$ begin
 if p_ok is distinct from true then raise exception '%', p_message using errcode='22023'; end if;
end $$;
create function sync_private.num(v jsonb, lo numeric, hi numeric, integral boolean default false) returns boolean
language plpgsql immutable set search_path = '' as $$ begin
 if jsonb_typeof(v) <> 'number' then return false; end if;
 return (v::text)::numeric between lo and hi and (not integral or trunc((v::text)::numeric)=(v::text)::numeric);
exception when others then return false; end $$;
create function sync_private.str(v jsonb, lo integer, hi integer) returns boolean
language sql immutable set search_path = '' as $$ select jsonb_typeof(v)='string' and char_length(v #>> '{}') between lo and hi $$;

create function sync_private.validate_document(d jsonb) returns void
language plpgsql set search_path = '' as $$
declare s jsonb:=d->'state'; r jsonb; item jsonb; k text; t jsonb:=s->'timer'; settings jsonb:=s->'settings';
begin
 perform sync_private.assert(d->>'version'='1' and s->>'version'='1');
 perform sync_private.assert(exists(select 1 from pg_timezone_names where name=d->>'timeZone'));
 foreach k in array array['projects','tasks','records','tickets','templates'] loop
   perform sync_private.assert(jsonb_typeof(s->k)='array');
   perform sync_private.assert(jsonb_array_length(s->k) <= case k when 'records' then 100000 when 'templates' then 500 else 20000 end);
   perform sync_private.assert((select count(*)=count(distinct value->>'id') from jsonb_array_elements(s->k)));
   for r in select value from jsonb_array_elements(s->k) loop
     perform sync_private.assert(sync_private.str(r->'id',1,120));
     if k='projects' then
       perform sync_private.assert(sync_private.str(r->'name',1,80) and sync_private.str(r->'outcome',0,120) and sync_private.str(r->'image',0,110));
       perform sync_private.assert(r->>'icon' in ('folder','book','leaf') and r->>'color' ~ '^#[0-9A-Fa-f]{6}$');
       perform sync_private.assert(r->>'image'='' or r->>'image' ~ '^[A-Za-z0-9_-]{1,100}\.(png|jpe?g|webp|gif)$');
     elsif k='tasks' then
       perform sync_private.assert(sync_private.str(r->'title',1,120) and sync_private.num(r->'estimate',1,48,true) and sync_private.num(r->'remaining',0,48,true));
       perform sync_private.assert(jsonb_typeof(r->'done')='boolean' and sync_private.str(r->'followUpOf',0,120));
       perform sync_private.assert(r->>'project'='' or exists(select 1 from jsonb_array_elements(s->'projects') p where p->>'id'=r->>'project'));
       perform sync_private.assert(r->>'date'='' or (r->>'date' ~ '^\d{4}-\d{2}-\d{2}$' and to_char((r->>'date')::date,'YYYY-MM-DD')=r->>'date'));
     elsif k='records' then
       perform sync_private.assert(sync_private.str(r->'taskId',1,120) and sync_private.num(r->'seconds',0,86400) and sync_private.num(r->'duration',1,86400) and sync_private.num(r->'pomodoros',0,1) and sync_private.num(r->'at',0,8640000000000000));
     elsif k='tickets' then
       perform sync_private.assert(sync_private.str(r->'taskId',1,120) and sync_private.str(r->'title',1,120) and sync_private.str(r->'projectId',0,120) and sync_private.str(r->'note',0,200) and sync_private.str(r->'clipId',0,160));
       perform sync_private.assert(sync_private.num(r->'completedAt',0,8640000000000000) and sync_private.num(r->'estimate',1,48,true) and sync_private.num(r->'used',0,100000));
       perform sync_private.assert(jsonb_typeof(r->'highlight')='boolean' and jsonb_typeof(r->'voided')='boolean' and r->>'sticker' in ('','star','heart','leaf'));
     else
       perform sync_private.assert(sync_private.str(r->'name',1,80) and jsonb_typeof(r->'steps')='array' and jsonb_array_length(r->'steps') between 1 and 20);
       for item in select value from jsonb_array_elements(r->'steps') loop perform sync_private.assert(sync_private.str(item->'title',1,120) and sync_private.num(item->'estimate',1,2,true)); end loop;
     end if;
   end loop;
 end loop;
 perform sync_private.assert(sync_private.num(settings->'focus',1,86400) and sync_private.num(settings->'rest',1,86400) and sync_private.num(settings->'dailyCapacity',1,16,true));
 foreach k in array array['planAt','reviewAt'] loop perform sync_private.assert(settings->>k='' or settings->>k ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'); end loop;
 perform sync_private.assert(jsonb_typeof(settings->'remindDays')='array' and jsonb_array_length(settings->'remindDays') <= 7);
 for item in select value from jsonb_array_elements(settings->'remindDays') loop perform sync_private.assert(sync_private.num(item,0,6,true)); end loop;
 if t <> 'null'::jsonb then
   perform sync_private.assert(t->>'phase' in ('focus','rest','checkin') and sync_private.num(t->'duration',1,86400) and sync_private.num(t->'elapsed',0,(t->>'duration')::numeric) and sync_private.num(t->'startedAt',0,8640000000000000) and jsonb_typeof(t->'running')='boolean');
   perform sync_private.assert(t->>'phase'='rest' or exists(select 1 from jsonb_array_elements(s->'tasks') x where x->>'id'=t->>'taskId' and x->>'done'='false'));
   perform sync_private.assert(t->>'phase'<>'checkin' or t->>'running'='false');
 end if;
 foreach k in array array['rituals','assets','clips','deliveries'] loop
   perform sync_private.assert(jsonb_typeof(d->'extras'->k)='array' and jsonb_array_length(d->'extras'->k)<=100000);
   perform sync_private.assert((select count(*)=count(distinct value->>'id') from jsonb_array_elements(d->'extras'->k)));
   for r in select value from jsonb_array_elements(d->'extras'->k) loop
     perform sync_private.assert(sync_private.str(r->'id',1,160) and octet_length(r::text)<=16384);
     if k='rituals' then perform sync_private.assert(r->>'kind' in ('plan','review') and r->>'date' ~ '^\d{4}-\d{2}-\d{2}$');
     elsif k='assets' then
       perform sync_private.assert(r->>'status' in ('pending','ready') and sync_private.num(r->'size',1,536870912,true) and r->>'hash' ~ '^[0-9a-f]{64}$');
       perform sync_private.assert(r->>'mime' in ('image/png','image/jpeg','image/webp','image/gif','video/webm','video/mp4'));
       perform sync_private.assert(r->>'path' = auth.uid()::text || '/' || (r->>'id'));
       if r->>'status'='ready' then perform sync_private.assert(exists(select 1 from storage.objects o where o.bucket_id='to3mato' and o.name=r->>'path' and (o.metadata->>'size')::bigint=(r->>'size')::bigint),'asset upload incomplete'); end if;
     elsif k='clips' then
       perform sync_private.assert(sync_private.str(r->'taskTitle',1,120) and sync_private.num(r->'at',0,8640000000000000) and sync_private.num(r->'focusSeconds',0,86400) and sync_private.num(r->'duration',0,86400000));
       perform sync_private.assert(exists(select 1 from jsonb_array_elements(d->'extras'->'assets') a where a->>'id'=r->>'assetId') and exists(select 1 from jsonb_array_elements(d->'extras'->'assets') a where a->>'id'=r->>'thumbnailId'));
     elsif k='deliveries' then
       perform sync_private.assert(sync_private.num(r->'start',0,8640000000000000) and sync_private.num(r->'end',(r->>'start')::numeric,8640000000000000) and sync_private.num(r->'deliveredAt',0,8640000000000000) and sync_private.num(r->'clipCount',1,100000,true) and sync_private.num(r->'duration',0,86400000) and jsonb_typeof(r->'seen')='boolean');
       perform sync_private.assert(exists(select 1 from jsonb_array_elements(d->'extras'->'assets') a where a->>'id'=r->>'assetId'));
     end if;
   end loop;
 end loop;
end $$;

create function sync_private.patch(d jsonb, patches jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare p jsonb; entity text; root text; rows jsonb; row jsonb; found boolean; result jsonb; key text; allowed text[];
begin
 perform sync_private.assert(jsonb_typeof(patches)='array' and jsonb_array_length(patches)<=150000);
 for p in select value from jsonb_array_elements(patches) loop
   entity:=p->>'entity';
   perform sync_private.assert(entity in ('projects','tasks','records','tickets','templates','settings','rituals','assets','clips','deliveries') and sync_private.str(p->'id',1,160));
   root:=case when entity in ('rituals','assets','clips','deliveries') then 'extras' else 'state' end;
   if entity='settings' then
     perform sync_private.assert(not exists(select 1 from jsonb_object_keys(p->'fields') f where f not in ('focus','rest','dailyCapacity','planAt','reviewAt','remindDays')));
     d:=jsonb_set(d,'{state,settings}',d->'state'->'settings'||(p->'fields')); continue;
   end if;
   key:=entity||':'||(p->>'id');
   if coalesce((p->>'delete')::boolean,false) then
     d:=jsonb_set(d,array[root,entity],coalesce((select jsonb_agg(v) from jsonb_array_elements(d->root->entity) v where v->>'id'<>p->>'id'),'[]'::jsonb));
     d:=jsonb_set(d,array['tombstones',key],'true'); continue;
   end if;
   if d->'tombstones' ? key then continue; end if;
   perform sync_private.assert(jsonb_typeof(p->'fields')='object' and not (p->'fields' ? 'id'));
   allowed:=case entity
     when 'projects' then array['name','icon','color','outcome','image']
     when 'tasks' then array['title','estimate','remaining','followUpOf','project','date','done']
     when 'records' then array['taskId','seconds','pomodoros','duration','at']
     when 'tickets' then array['taskId','title','projectId','completedAt','estimate','used','clipId','note','highlight','sticker','voided']
     when 'templates' then array['name','steps']
     when 'rituals' then array['kind','date']
     when 'assets' then array['path','hash','size','mime','status','name']
     when 'clips' then array['taskTitle','at','focusSeconds','duration','assetId','thumbnailId']
     when 'deliveries' then array['start','end','deliveredAt','clipCount','duration','seen','assetId','generation'] end;
   perform sync_private.assert(not exists(select 1 from jsonb_object_keys(p->'fields') f where not(f=any(allowed))));
   rows:=d->root->entity; result:='[]'; found:=false;
   for row in select value from jsonb_array_elements(rows) loop
     if row->>'id'=p->>'id' then
       -- A weekly delivery is published once; concurrent generators cannot replace it.
       if entity='deliveries' and row ? 'assetId' and p->'fields' ? 'assetId' then
         if p->'fields'->>'seen'='true' then row:=row||'{"seen":true}'::jsonb; end if;
       else row:=row||(p->'fields'); end if;
       found:=true;
     end if;
     result:=result||jsonb_build_array(row);
   end loop;
   if not found and coalesce((p->>'create')::boolean,false) then result:=result||jsonb_build_array(jsonb_build_object('id',p->>'id')||(p->'fields')); end if;
   d:=jsonb_set(d,array[root,entity],result);
 end loop;
 -- Deleted projects do not reappear through a stale task patch.
 d:=jsonb_set(d,'{state,tasks}',coalesce((select jsonb_agg(case when t->>'project'<>'' and not exists(select 1 from jsonb_array_elements(d->'state'->'projects') project_row where project_row->>'id'=t->>'project') then t||'{"project":""}'::jsonb else t end) from jsonb_array_elements(d->'state'->'tasks') t),'[]'));
 return d;
end $$;

create function sync_private.elapsed(t jsonb, at_ms numeric) returns numeric
language sql immutable set search_path = '' as $$ select least((t->>'duration')::numeric,greatest(0,(t->>'elapsed')::numeric + case when t->>'running'='true' then greatest(0,at_ms-(t->>'startedAt')::numeric)/1000 else 0 end)) $$;
create function sync_private.settle(d jsonb, at_ms numeric) returns jsonb
language plpgsql set search_path = '' as $$
declare t jsonb:=d->'state'->'timer'; seconds numeric; record_id text; rec jsonb;
begin
 if t is null or t='null'::jsonb then return d; end if;
 seconds:=sync_private.elapsed(t,at_ms);
 if t->>'phase'='focus' and seconds>0 then
   record_id:='focus:'||(d->'timer'->>'sessionId');
   rec:=jsonb_build_object('id',record_id,'taskId',t->>'taskId','seconds',seconds,'duration',(t->>'duration')::numeric,'at',at_ms,'pomodoros',least(1,floor(seconds/(t->>'duration')::numeric*2+0.5)/2));
   if not exists(select 1 from jsonb_array_elements(d->'state'->'records') r where r->>'id'=record_id) then d:=jsonb_set(d,'{state,records}',(d->'state'->'records')||jsonb_build_array(rec)); end if;
 end if;
 return jsonb_set(d,'{state,timer}','null');
end $$;
create function sync_private.ticket(d jsonb, task jsonb, op jsonb, at_ms numeric, clip text default '') returns jsonb
language sql set search_path = '' as $$ select jsonb_set(d,'{state,tickets}',(d->'state'->'tickets')||jsonb_build_array(jsonb_build_object('id','tickets:'||(op->>'id')||':0','taskId',task->>'id','title',task->>'title','projectId',task->>'project','completedAt',at_ms,'estimate',task->'estimate','used',coalesce((select sum((r->>'pomodoros')::numeric) from jsonb_array_elements(d->'state'->'records') r where r->>'taskId'=task->>'id'),0),'clipId',clip,'note','','highlight',false,'sticker','','voided',false))) $$;

create function sync_private.command(d jsonb, op jsonb, server_ms numeric) returns jsonb
language plpgsql set search_path = '' as $$
declare cmd text:=op->'command'->>'type'; p jsonb:=coalesce(op->'command'->'payload','{}');
 t jsonb:=d->'state'->'timer'; before_timer jsonb:=t; task jsonb; rows jsonb; r jsonb; at_ms numeric:=server_ms;
 session_id text:=d->'timer'->>'sessionId'; deadline numeric; ix integer; before_ix integer; ticket_id text; next_task jsonb;
begin
 perform sync_private.assert(cmd in ('timer:play','timer:toggle','timer:pause','timer:end','timer:advance','timer:adopt','checkin:save','checkin:done','checkin:followup','checkin:skip','task:delete','task:toggle','project:delete','task:reorder'));
 if op->>'offline'='true' then at_ms:=least((op->>'at')::numeric,server_ms); end if;
 if t<>'null'::jsonb then at_ms:=greatest(at_ms,(t->>'startedAt')::numeric); end if;
 if t->>'running'='true' and sync_private.elapsed(t,at_ms)>=(t->>'duration')::numeric then
   deadline:=(t->>'startedAt')::numeric+((t->>'duration')::numeric-(t->>'elapsed')::numeric)*1000;
   d:=sync_private.settle(d,deadline);
   if t->>'phase'='focus' then d:=jsonb_set(d,'{state,timer}',t||jsonb_build_object('phase','checkin','elapsed',t->'duration','startedAt',deadline,'running',false)); end if;
 end if;
 t:=d->'state'->'timer';
 select value into task from jsonb_array_elements(d->'state'->'tasks') where value->>'id'=case when cmd like 'checkin:%' then t->>'taskId' else p->>'id' end;
 if cmd='timer:adopt' then
   d:=sync_private.settle(d,at_ms); t:=p->'timer';
   perform sync_private.assert(jsonb_typeof(t)='object');
   t:=t||jsonb_build_object('elapsed',sync_private.elapsed(t,at_ms),'startedAt',at_ms);
   session_id:=op->>'id'; d:=jsonb_set(d,'{state,timer}',t);
 elsif cmd='timer:play' then
   perform sync_private.assert(task is not null and task->>'done'='false','task unavailable');
   if t->>'phase'='focus' and t->>'taskId'=task->>'id' then
     if t->>'running'='false' then t:=t||jsonb_build_object('running',true,'startedAt',at_ms); end if;
   else
     d:=sync_private.settle(d,at_ms); session_id:=op->>'id';
     t:=jsonb_build_object('taskId',task->>'id','phase','focus','duration',d->'state'->'settings'->'focus','elapsed',0,'startedAt',at_ms,'running',true);
   end if;
   d:=jsonb_set(d,'{state,timer}',t);
 elsif cmd in ('timer:toggle','timer:pause') and t<>'null'::jsonb and t->>'phase'<>'checkin' then
   if t->>'running'='true' then t:=t||jsonb_build_object('elapsed',sync_private.elapsed(t,at_ms),'running',false);
   elsif cmd='timer:toggle' then t:=t||jsonb_build_object('startedAt',at_ms,'running',true); end if;
   d:=jsonb_set(d,'{state,timer}',t);
 elsif cmd='timer:end' then d:=sync_private.settle(d,at_ms);
 elsif cmd like 'checkin:%' then
   perform sync_private.assert(t->>'phase'='checkin' and task is not null,'checkin unavailable');
   if cmd='checkin:save' then
     perform sync_private.assert(sync_private.num(p->'remaining',0,48,true)); task:=task||jsonb_build_object('remaining',p->'remaining');
   elsif cmd='checkin:done' then
     task:=task||'{"done":true}'; d:=sync_private.ticket(d,task,op,at_ms,coalesce(p->>'clipId',''));
   elsif cmd='checkin:followup' then
     next_task:=task||jsonb_build_object('id','tasks:'||(op->>'id')||':0','title',coalesce(p->>'title',task->>'title'),'estimate',1,'remaining',1,'followUpOf',task->>'id','done',false);
     task:=task||'{"remaining":0}';
   end if;
   rows:='[]';
   for r in select value from jsonb_array_elements(d->'state'->'tasks') loop
     if r->>'id'=task->>'id' then rows:=rows||jsonb_build_array(task); if next_task is not null then rows:=rows||jsonb_build_array(next_task); end if;
     else rows:=rows||jsonb_build_array(r); end if;
   end loop;
   d:=jsonb_set(d,'{state,tasks}',rows); session_id:=op->>'id';
   d:=jsonb_set(d,'{state,timer}',jsonb_build_object('taskId',null,'phase','rest','duration',d->'state'->'settings'->'rest','elapsed',0,'startedAt',at_ms,'running',true));
 elsif cmd in ('task:delete','task:toggle') then
   perform sync_private.assert(task is not null,'task unavailable');
   if t->>'taskId'=task->>'id' then d:=sync_private.settle(d,at_ms); end if;
   if cmd='task:delete' then
     d:=jsonb_set(d,'{state,tasks}',coalesce((select jsonb_agg(v) from jsonb_array_elements(d->'state'->'tasks') v where v->>'id'<>task->>'id'),'[]'));
     d:=jsonb_set(d,array['tombstones','tasks:'||(task->>'id')],'true');
   else
     if task->>'done'='false' then task:=task||'{"done":true}'; d:=sync_private.ticket(d,task,op,at_ms);
     else
       task:=task||'{"done":false}';
       select v->>'id' into ticket_id from jsonb_array_elements(d->'state'->'tickets') with ordinality as x(v,n) where v->>'taskId'=task->>'id' and v->>'voided'='false' order by n desc limit 1;
       d:=jsonb_set(d,'{state,tickets}',coalesce((select jsonb_agg(case when v->>'id'=ticket_id then v||'{"voided":true}'::jsonb else v end) from jsonb_array_elements(d->'state'->'tickets') v),'[]'));
     end if;
     d:=jsonb_set(d,'{state,tasks}',(select jsonb_agg(case when v->>'id'=task->>'id' then task else v end) from jsonb_array_elements(d->'state'->'tasks') v));
   end if;
 elsif cmd='project:delete' then
   d:=sync_private.patch(d,jsonb_build_array(jsonb_build_object('entity','projects','id',p->>'id','delete',true)));
 elsif cmd='task:reorder' then
   perform sync_private.assert(task is not null,'task unavailable');
   if p->>'before' is distinct from p->>'id' then
     rows:='[]';
     for r in select value from jsonb_array_elements(d->'state'->'tasks') loop
       if r->>'id'=p->>'id' then continue; end if;
       if r->>'id'=p->>'before' then rows:=rows||jsonb_build_array(task); end if;
       rows:=rows||jsonb_build_array(r);
     end loop;
     if coalesce(p->>'before','')='' or not exists(select 1 from jsonb_array_elements(rows) v where v->>'id'=task->>'id') then rows:=rows||jsonb_build_array(task); end if;
     d:=jsonb_set(d,'{state,tasks}',rows);
   end if;
 end if;
 if d->'state'->'timer' is distinct from before_timer then
   d:=jsonb_set(d,'{timer}',jsonb_build_object('sessionId',case when d->'state'->'timer'='null'::jsonb then null else session_id end,'revision',op->>'id','controller',case when cmd='timer:advance' then d->'timer'->>'controller' else op->>'deviceId' end));
 end if;
 return d;
end $$;

-- Delta contains only changed rows and an explicit authoritative order. It never
-- includes another user's data, and it is applied before replaying the local outbox.
create function sync_private.delta(old jsonb, new jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare k text; root text; rows jsonb; patches jsonb:='[]'; orders jsonb:='{}'; r jsonb; previous jsonb;
begin
 foreach k in array array['projects','tasks','records','tickets','templates','rituals','assets','clips','deliveries'] loop
   root:=case when k in ('rituals','assets','clips','deliveries') then 'extras' else 'state' end;
   for r in select value from jsonb_array_elements(new->root->k) loop
     select value into previous from jsonb_array_elements(old->root->k) where value->>'id'=r->>'id';
     if previous is distinct from r then patches:=patches||jsonb_build_array(jsonb_build_object('entity',k,'id',r->>'id','fields',r-'id','create',true)); end if;
   end loop;
   for r in select value from jsonb_array_elements(old->root->k) loop
     if not exists(select 1 from jsonb_array_elements(new->root->k) v where v->>'id'=r->>'id') then patches:=patches||jsonb_build_array(jsonb_build_object('entity',k,'id',r->>'id','delete',true)); end if;
   end loop;
   if new->root->k is distinct from old->root->k then orders:=jsonb_set(orders,array[k],coalesce((select jsonb_agg(v->'id') from jsonb_array_elements(new->root->k) v),'[]')); end if;
 end loop;
 if old->'state'->'settings' is distinct from new->'state'->'settings' then patches:=patches||jsonb_build_array(jsonb_build_object('entity','settings','id','settings','fields',new->'state'->'settings')); end if;
 return jsonb_build_object('patches',patches,'orders',orders,'timer',new->'timer','timerState',new->'state'->'timer','timeZone',new->'timeZone','tombstones',new->'tombstones');
end $$;

create function sync_private.persist_rows(uid uuid, d jsonb, rev bigint) returns void
language plpgsql set search_path = '' as $$
declare k text; root text; tab text; r jsonb; n integer; ids text[];
begin
 foreach k in array array['projects','tasks','records','tickets','templates','rituals','assets','clips','deliveries'] loop
   root:=case when k in ('rituals','assets','clips','deliveries') then 'extras' else 'state' end;
   tab:=case k when 'records' then 'focus_records' when 'rituals' then 'ritual_completions' else k end;
   n:=0; ids:=array[]::text[];
   for r in select value from jsonb_array_elements(d->root->k) loop
     ids:=array_append(ids,r->>'id');
     execute format('insert into public.%I (user_id,id,data,position,revision) values ($1,$2,$3,$4,$5) on conflict(user_id,id) do update set data=excluded.data,position=excluded.position,revision=excluded.revision,deleted=false where %I.data is distinct from excluded.data or %I.position<>excluded.position or %I.deleted',tab,tab,tab,tab) using uid,r->>'id',r,n,rev;
     n:=n+1;
   end loop;
   execute format('update public.%I set deleted=true,revision=$3 where user_id=$1 and not(id=any($2)) and not deleted',tab) using uid,ids,rev;
 end loop;
 insert into public.user_settings(user_id,id,data,revision) values(uid,'settings',d->'state'->'settings',rev) on conflict(user_id,id) do update set data=excluded.data,revision=excluded.revision;
 update public.timer_sessions set deleted=true,revision=rev where user_id=uid and not deleted and id is distinct from d->'timer'->>'sessionId';
 if d->'timer'->>'sessionId' is not null then
 insert into public.timer_sessions(user_id,id,data,revision) values(uid,d->'timer'->>'sessionId',jsonb_build_object('state',d->'state'->'timer','meta',d->'timer'),rev) on conflict(user_id,id) do update set data=excluded.data,revision=excluded.revision,deleted=false;
 end if;
end $$;

create function sync_private.asset_references(d jsonb) returns setof text
language sql immutable set search_path = '' as $$
 select value->>'image' from jsonb_array_elements(d->'state'->'projects')
 union select value->>'assetId' from jsonb_array_elements(d->'extras'->'clips')
 union select value->>'thumbnailId' from jsonb_array_elements(d->'extras'->'clips')
 union select value->>'assetId' from jsonb_array_elements(d->'extras'->'deliveries')
$$;
create function sync_private.prune_assets(old jsonb, d jsonb) returns jsonb
language plpgsql set search_path = '' as $$ declare id text; begin
 for id in select * from sync_private.asset_references(old) except select * from sync_private.asset_references(d) loop
   if id is null or id='' then continue; end if;
   d:=jsonb_set(d,'{extras,assets}',coalesce((select jsonb_agg(v) from jsonb_array_elements(d->'extras'->'assets') v where v->>'id'<>id),'[]'));
   d:=jsonb_set(d,array['tombstones','assets:'||id],'true');
 end loop;
 return d;
end $$;

create function public.sync_pull(p_epoch text, p_cursor text, p_device uuid, p_timezone text default 'UTC') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); a public.account_sync_state; result jsonb; changes jsonb; cursor_value bigint; last_rev bigint;
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 perform sync_private.assert(p_cursor ~ '^\d+$' and exists(select 1 from pg_timezone_names where name=p_timezone));
 insert into public.account_sync_state(user_id,document) values(uid,sync_private.empty_document(p_timezone)) on conflict do nothing;
 select * into a from public.account_sync_state where user_id=uid for update;
 if a.deleting then raise exception 'account deleting' using errcode='42501'; end if;
 insert into public.devices(user_id,id) values(uid,p_device) on conflict(user_id,id) do update set last_sync_at=now();
 cursor_value:=p_cursor::bigint;
 result:=jsonb_build_object('version',1,'epoch',a.epoch::text,'cursor',a.revision::text,'serverNow',extract(epoch from clock_timestamp())*1000);
 if p_epoch is distinct from a.epoch::text or cursor_value=0 or cursor_value>a.revision then return result||jsonb_build_object('document',a.document); end if;
 select jsonb_agg(jsonb_build_object('cursor',revision::text,'delta',delta) order by revision), max(revision) into changes,last_rev from (select revision,delta from public.sync_changes where user_id=uid and revision>cursor_value order by revision limit 100) c;
 if last_rev is null and cursor_value<a.revision then return result||jsonb_build_object('document',a.document); end if;
 return result||jsonb_build_object('changes',coalesce(changes,'[]'),'cursor',coalesce(last_rev,cursor_value)::text,'hasMore',coalesce(last_rev,cursor_value)<a.revision);
end $$;

create function public.sync_push(p_operation jsonb, p_epoch text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); a public.account_sync_state; previous public.processed_operations; d jsonb; delta jsonb; op_id uuid; conflict boolean:=false; reason text; guarded boolean; now_ms numeric:=extract(epoch from clock_timestamp())*1000;
begin
 if uid is null then raise exception 'authentication required' using errcode='42501'; end if;
 perform sync_private.assert(p_operation->>'version'='1' and octet_length(p_operation::text)<=20971520 and sync_private.num(p_operation->'at',0,8640000000000000));
 op_id:=(p_operation->>'id')::uuid;
 perform sync_private.assert(op_id is not null and (p_operation->>'deviceId')::uuid is not null);
 select * into a from public.account_sync_state where user_id=uid for update;
 perform sync_private.assert(found and a.epoch::text=p_epoch and not a.deleting,'sync epoch changed');
 select * into previous from public.processed_operations where user_id=uid and id=op_id;
 if found then
   perform sync_private.assert(previous.operation=p_operation,'operation id reused'); conflict:=previous.conflict; reason:=previous.reason;
 else
   d:=a.document;
   if p_operation->>'kind'='patch' then
     if exists(select 1 from jsonb_array_elements(p_operation->'patches') p where p->>'entity'='tasks' and p->>'id'=d->'state'->'timer'->>'taskId' and (p->>'delete'='true' or p->'fields'->>'done'='true')) then
       d:=sync_private.settle(d,case when d->'state'->'timer'->>'running'='true' then least(now_ms,(d->'state'->'timer'->>'startedAt')::numeric+((d->'state'->'timer'->>'duration')::numeric-(d->'state'->'timer'->>'elapsed')::numeric)*1000) else now_ms end);
       d:=jsonb_set(d,'{timer}',jsonb_build_object('sessionId',null,'revision',p_operation->>'id','controller',p_operation->>'deviceId'));
     end if;
     d:=sync_private.patch(d,p_operation->'patches');
   elsif p_operation->>'kind'='command' then
     guarded:=p_operation->'command'->>'type' like 'timer:%' or p_operation->'command'->>'type' like 'checkin:%' or (p_operation->'command'->>'type' in ('task:delete','task:toggle') and d->'state'->'timer'->>'taskId'=p_operation->'command'->'payload'->>'id');
     if guarded and (p_operation->>'expectedTimer' is distinct from d->'timer'->>'revision' or p_operation->>'sessionId' is distinct from d->'timer'->>'sessionId') then
       if not (p_operation->'command'->>'type' in ('timer:end','timer:advance') and exists(select 1 from jsonb_array_elements(d->'state'->'records') r where r->>'id'='focus:'||(p_operation->>'sessionId'))) then conflict:=true; reason:='timer'; end if;
     else
       begin d:=sync_private.command(d,p_operation,now_ms);
       exception when sqlstate '22023' then conflict:=true; reason:='data'; d:=a.document;
       end;
     end if;
   else raise exception 'invalid operation' using errcode='22023'; end if;
   if not conflict then
     d:=sync_private.prune_assets(a.document,d);
     perform sync_private.validate_document(d);
     a.revision:=a.revision+1;
     delta:=sync_private.delta(a.document,d);
     perform sync_private.persist_rows(uid,d,a.revision);
     update public.account_sync_state set document=d,revision=a.revision where user_id=uid;
     insert into public.sync_changes(user_id,revision,operation_id,delta) values(uid,a.revision,op_id,delta);
     a.document:=d;
     perform realtime.send(jsonb_build_object('revision',a.revision::text),'changed','account:'||uid::text,true);
   end if;
   insert into public.processed_operations(user_id,id,operation,conflict,reason,revision) values(uid,op_id,p_operation,conflict,reason,a.revision);
 end if;
 return jsonb_build_object('version',1,'epoch',a.epoch::text,'cursor',a.revision::text,'document',a.document,'conflict',conflict,'reason',reason,'serverNow',extract(epoch from clock_timestamp())*1000);
end $$;

revoke all on function public.sync_pull(text,text,uuid,text) from public, anon;
revoke all on function public.sync_push(jsonb,text) from public, anon;
grant execute on function public.sync_pull(text,text,uuid,text), public.sync_push(jsonb,text) to authenticated;
revoke all on all functions in schema sync_private from public, anon, authenticated;

create policy account_broadcast_read on realtime.messages for select to authenticated
 using (realtime.topic() = 'account:'||(select auth.uid())::text);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('to3mato','to3mato',false,536870912,array['image/png','image/jpeg','image/webp','image/gif','video/webm','video/mp4']) on conflict(id) do nothing;
create policy asset_read on storage.objects for select to authenticated using (
 bucket_id='to3mato' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.assets a where a.user_id=(select auth.uid()) and not a.deleted and a.data->>'path'=name)
);
create function public.sync_can_upload(p_name text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare a public.account_sync_state; begin
 if auth.uid() is null then return false; end if;
 select * into a from public.account_sync_state where user_id=auth.uid() for share;
 if not found or a.deleting then return false; end if;
 return exists(select 1 from public.assets x where x.user_id=auth.uid() and not x.deleted and x.data->>'path'=p_name and x.data->>'status'='pending')
 and (select coalesce(sum((x.data->>'size')::bigint),0) from public.assets x where x.user_id=auth.uid() and not x.deleted)<=262144000;
end $$;
revoke all on function public.sync_can_upload(text) from public, anon;
grant execute on function public.sync_can_upload(text) to authenticated;
create policy asset_upload on storage.objects for insert to authenticated with check (
 bucket_id='to3mato' and (storage.foldername(name))[1]=(select auth.uid())::text
 and public.sync_can_upload(name)
 -- Storage probes authorization with contentLength before upload, then size after upload.
 and exists(select 1 from public.assets a where a.user_id=(select auth.uid()) and not a.deleted and a.data->>'path'=name and (a.data->>'size')::bigint=coalesce(metadata->>'size',metadata->>'contentLength')::bigint)
);
-- Immutable objects: no client UPDATE or DELETE policy. Cleanup goes through the
-- authenticated Edge Function so metadata tombstones and object removal agree.
