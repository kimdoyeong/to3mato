import { createClient } from 'npm:@supabase/supabase-js@2';

// Deployment secrets are read by the function only, never embedded in a client.
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('', { status: 405 });
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!bearer)
    return Response.json({ error: 'authentication required' }, { status: 401 });
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('TO3MATO_ADMIN_KEY') ||
      JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default ||
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(bearer);
  if (error || !user)
    return Response.json({ error: 'authentication required' }, { status: 401 });
  // Serialize with sync_push and reject new file reservations while deletion runs.
  const locked = await admin
    .from('account_sync_state')
    .update({ deleting: true })
    .eq('user_id', user.id);
  if (locked.error) return Response.json({ deleted: false }, { status: 503 });
  for (;;) {
    const files = await admin.storage
      .from('to3mato')
      .list(user.id, { limit: 100 });
    if (files.error) return Response.json({ deleted: false }, { status: 503 });
    if (!files.data.length) break;
    const removed = await admin.storage
      .from('to3mato')
      .remove(files.data.map((file) => `${user.id}/${file.name}`));
    if (removed.error)
      return Response.json({ deleted: false }, { status: 503 });
  }
  const deleted = await admin.auth.admin.deleteUser(user.id);
  return Response.json(
    { deleted: !deleted.error },
    { status: deleted.error ? 503 : 200 },
  );
});
