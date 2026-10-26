import { createClient } from 'npm:@supabase/supabase-js@2';
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('', { status: 405 });
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return new Response('', { status: 401 });
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('TO3MATO_ADMIN_KEY') ||
      JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default ||
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return new Response('', { status: 401 });
  // Only durable tombstones permit removal. An interrupted upload can be retried
  // without letting an old client resurrect an asset after this cleanup.
  let after = '';
  for (;;) {
    const rows = await admin
      .from('assets')
      .select('id,data')
      .eq('user_id', user.id)
      .eq('deleted', true)
      .gt('id', after)
      .order('id')
      .limit(100);
    if (rows.error) return Response.json({ removed: false }, { status: 503 });
    if (!rows.data.length) break;
    const paths = rows.data
      .map((row) => row.data.path)
      .filter(
        (name) => typeof name === 'string' && name.startsWith(user.id + '/'),
      );
    if (paths.length) {
      const result = await admin.storage.from('to3mato').remove(paths);
      if (result.error)
        return Response.json({ removed: false }, { status: 503 });
    }
    after = rows.data.at(-1)!.id;
  }
  return Response.json({ removed: true });
});
