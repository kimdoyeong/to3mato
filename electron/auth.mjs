import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

export function supabaseConfiguration(env = process.env, bundled = {}) {
  const url = env.TO3MATO_SUPABASE_URL || bundled.url;
  const key = env.TO3MATO_SUPABASE_PUBLISHABLE_KEY || bundled.publishableKey;
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Supabase 연결 설정이 없습니다.');
  const parsed = new URL(url);
  const local = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  if (
    (!local &&
      (parsed.protocol !== 'https:' ||
        !parsed.hostname.endsWith('.supabase.co'))) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  )
    throw new Error('Supabase 주소가 올바르지 않습니다.');
  if (
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) &&
    !(local && env.TO3MATO_SYNC_TEST === '1')
  )
    throw new Error('Supabase 공개 키가 올바르지 않습니다.');
  return { url: parsed.origin, key };
}
export function secureSessionStorage(directory, safeStorage) {
  const file = path.join(directory, 'session.bin');
  const available = () => {
    if (
      !safeStorage.isEncryptionAvailable() ||
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    )
      throw new Error(
        '이 컴퓨터에서는 로그인 정보를 안전하게 저장할 수 없습니다.',
      );
  };
  const read = () => {
    if (!fs.existsSync(file)) return {};
    available();
    const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    if (data.version !== 1 || !data.items || typeof data.items !== 'object')
      throw new Error('로그인 정보를 읽지 못했습니다.');
    return data.items;
  };
  const write = (items) => {
    available();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = file + '.tmp';
    try {
      fs.writeFileSync(
        temp,
        safeStorage.encryptString(JSON.stringify({ version: 1, items })),
        { mode: 0o600 },
      );
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  };
  return {
    getItem(key) {
      return read()[key] ?? null;
    },
    setItem(key, value) {
      write({ ...read(), [key]: value });
    },
    removeItem(key) {
      if (key === undefined) {
        fs.rmSync(file, { force: true });
        return;
      }
      const items = read();
      delete items[key];
      if (Object.keys(items).length) write(items);
      else fs.rmSync(file, { force: true });
    },
  };
}
export function createAuth({
  config,
  directory,
  safeStorage,
  onChange = () => {},
}) {
  if (!config) return null;
  const storage = secureSessionStorage(directory, safeStorage);
  const client = createClient(config.url, config.key, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  let user = null;
  const subscription = client.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    queueMicrotask(() => onChange(user));
  }).data.subscription;
  const unwrap = (result) => {
    if (result.error)
      throw new Error(
        result.error.status === 429
          ? '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'
          : '인증 코드가 올바르지 않거나 만료되었습니다. 다시 요청하세요.',
      );
    return result.data;
  };
  return {
    client,
    user: () => user,
    async restore() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      user = data.session?.user || null;
      return user;
    },
    /** A first-time address gets its account when the code is verified. */
    async requestCode(email) {
      if (
        typeof email !== 'string' ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      )
        throw new Error('이메일 주소를 확인하세요.');
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          '이 컴퓨터에서는 로그인 정보를 안전하게 저장할 수 없습니다.',
        );
      unwrap(
        await client.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        }),
      );
    },
    async verify(email, code) {
      if (
        typeof email !== 'string' ||
        typeof code !== 'string' ||
        !/^\d{6,10}$/.test(code)
      )
        throw new Error(
          '인증 코드가 올바르지 않거나 만료되었습니다. 다시 요청하세요.',
        );
      user = unwrap(
        await client.auth.verifyOtp({ email, token: code, type: 'email' }),
      ).user;
      return user;
    },
    async logout() {
      await client.auth.signOut({ scope: 'local' });
      storage.removeItem();
      user = null;
    },
    destroy() {
      subscription.unsubscribe();
      client.auth.stopAutoRefresh();
      void client.removeAllChannels();
    },
  };
}
