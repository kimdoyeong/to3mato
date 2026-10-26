import fs from 'node:fs';
import path from 'node:path';
import { createAuth, supabaseConfiguration } from './auth.mjs';
import { openAccountRepository, accountDirectory } from './sync-repository.mjs';
import { createSyncEngine, createClock } from '../src/lib/sync/engine.mjs';
import { createSupabaseTransport } from '../src/lib/sync/transport.mjs';
import { createAssetManager } from './sync-assets.mjs';

export function createAccountSync({
  directory,
  safeStorage,
  getLocalState,
  onState,
  onStatus,
  bundled = {},
  env = process.env,
}) {
  let auth,
    engine,
    repository,
    assets,
    user = null,
    active = false,
    timerBusy = false,
    error = '';
  const clock = createClock();
  let config;
  try {
    config = supabaseConfiguration(env, bundled);
  } catch (failure) {
    error = failure.message;
    config = null;
  }
  const bindingFile = path.join(directory, 'account-binding.json');
  let binding = null;
  if (fs.existsSync(bindingFile)) {
    try {
      binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
      if (
        !binding ||
        typeof binding.owner !== 'string' ||
        typeof binding.mediaAdopted !== 'boolean'
      )
        throw new Error('invalid binding');
      accountDirectory(directory, binding.owner);
    } catch {
      binding = { owner: 'unavailable', mediaAdopted: true };
      error = '계정 연결 기록을 읽지 못했습니다.';
    }
  }
  function saveBinding() {
    fs.writeFileSync(bindingFile + '.tmp', JSON.stringify(binding), {
      mode: 0o600,
    });
    fs.renameSync(bindingFile + '.tmp', bindingFile);
  }
  const status = () => ({
    configured: !!config,
    adoptLocalMedia:
      !binding || (binding.owner === user?.id && !binding.mediaAdopted),
    user: user ? { id: user.id, email: user.email } : null,
    scope: active && repository ? repository.read().owner : 'local',
    ...(engine?.status() || {
      enabled: false,
      connection: 'off',
      pending: 0,
      conflicts: [],
    }),
    ...assets?.status(),
    error: error || engine?.status().error || '',
  });
  const report = () => onStatus(status());
  const contextState = (state, meta) => ({
    ...state,
    syncContext: {
      owner: repository.read().owner,
      deviceId: repository.read().deviceId,
      controller: meta.document.timer.controller,
      sessionId: meta.document.timer.sessionId,
      source: meta.source,
      offset: clock.now() - Date.now(),
      timeZone: meta.document.timeZone,
      extras: meta.document.extras,
    },
  });
  function connect(seed) {
    if (repository?.read().owner === user.id) return;
    engine?.destroy();
    assets?.destroy();
    repository?.close();
    repository = openAccountRepository(directory, user.id, { seed });
    engine = createSyncEngine({
      repository,
      transport: createSupabaseTransport(auth.client, user.id),
      clock,
      onChange: (state, meta) => {
        if (!active) return;
        onState(contextState(state, meta));
        void assets?.flush();
      },
      onStatus: report,
    });
    assets = createAssetManager({
      repository,
      engine,
      client: auth.client,
      directory: repository.directory,
      userId: user.id,
      onStatus: report,
    });
  }
  async function ensureAuth() {
    if (!config)
      throw new Error('이 실행 환경에서는 계정 기능을 사용할 수 없습니다.');
    if (!auth)
      auth = createAuth({
        config,
        directory,
        safeStorage,
        onChange: (next) => {
          user = next;
          report();
        },
      });
    return auth;
  }
  return {
    status,
    active: () => active,
    directory: () => (active && repository ? repository.directory : directory),
    state: () =>
      active
        ? contextState(engine.state(), {
            document: engine.document(),
            source: 'remote',
          })
        : getLocalState(),
    async restore() {
      if (!config || !fs.existsSync(path.join(directory, 'session.bin'))) {
        report();
        return;
      }
      try {
        user = await (await ensureAuth()).restore();
        if (
          user &&
          fs.existsSync(
            path.join(accountDirectory(directory, user.id), 'to3mato.sqlite3'),
          )
        ) {
          connect();
          active = true;
          onState(this.state());
          if (repository.read().enabled) {
            void engine.syncNow();
            void assets.flush();
          }
        }
      } catch {
        error = '다시 로그인하세요.';
      }
      report();
    },
    async requestCode(email, mode) {
      return (await ensureAuth()).requestCode(email, mode);
    },
    async verify(email, code) {
      if (user) throw new Error('로그아웃 후 로그인하세요.');
      const previousOwner = repository?.read().owner;
      const wasEnabled = repository?.read().enabled;
      // Stop transport before replacing authentication credentials.
      await engine?.disable();
      user = await (await ensureAuth()).verify(email, code);
      if (previousOwner && previousOwner !== user.id) {
        engine?.destroy();
        assets?.destroy();
        repository?.close();
        engine = repository = assets = null;
        active = false;
        onState(getLocalState());
      } else if (wasEnabled) await engine?.enable();
      error = '';
      report();
      return status();
    },
    async enable() {
      if (!user) throw new Error('로그인하세요.');
      // The local-only dataset may be adopted once. A different account never inherits it.
      const seed = !binding ? getLocalState() : undefined;
      connect(seed);
      if (!binding) {
        const sourceImages = path.join(directory, 'project-images');
        if (fs.existsSync(sourceImages))
          fs.cpSync(
            sourceImages,
            path.join(repository.directory, 'project-images'),
            { recursive: true },
          );
        binding = { owner: user.id, mediaAdopted: false };
        saveBinding();
        const ritualFile = path.join(directory, 'rituals.json');
        if (fs.existsSync(ritualFile)) {
          const done =
            JSON.parse(fs.readFileSync(ritualFile, 'utf8')).done || {};
          for (const kind of ['plan', 'review'])
            if (/^\d{4}-\d{2}-\d{2}$/.test(done[kind]))
              await engine.extra('rituals', `${done[kind]}:${kind}`, {
                kind,
                date: done[kind],
              });
        }
      }
      repository.backup();
      active = true;
      await engine.enable();
      onState(this.state());
      await assets.importProjectImages();
      report();
      return status();
    },
    async disable() {
      await engine?.disable();
      report();
      return status();
    },
    async mediaAdopted() {
      if (binding?.owner === user?.id) {
        binding.mediaAdopted = true;
        saveBinding();
      }
      report();
    },
    async logout() {
      await engine?.disable();
      engine?.destroy();
      assets?.destroy();
      repository?.close();
      engine = repository = assets = null;
      active = false;
      await auth?.logout();
      user = null;
      error = '';
      onState(getLocalState());
      report();
      return status();
    },
    async dispatch(command) {
      await engine.dispatch(command);
      if (command.type === 'project:save')
        void assets.importProjectImages().catch(() => {});
      return this.state();
    },
    async importData(raw) {
      repository.store.snapshot(repository.store.importBackup);
      await engine.importData(raw);
      return this.state();
    },
    async syncNow() {
      await engine?.syncNow();
      await assets?.flush();
      return status();
    },
    async tick() {
      if (!active || timerBusy) return;
      const state = engine.state(),
        timer = state.timer;
      if (
        !timer?.running ||
        timer.elapsed + (clock.now() - timer.startedAt) / 1000 < timer.duration
      )
        return;
      timerBusy = true;
      try {
        await engine.dispatch({ type: 'timer:advance' });
      } finally {
        timerBusy = false;
      }
    },
    resume() {
      clock.resume();
      void engine?.syncNow();
    },
    now: () => (active ? clock.now() : Date.now()),
    extra: (entity, id, fields, deleted) =>
      engine.extra(entity, id, fields, deleted),
    assetPut: (...args) => assets.put(...args),
    assetRead: (id) => assets.read(id),
    importProjectImages: () => assets?.importProjectImages(),
    resolve: (id, action) => engine.resolve(id, action),
    async remove() {
      if (!user) throw new Error('로그인하세요.');
      const { data, error: failure } = await auth.client.functions.invoke(
        'delete-account',
        { body: {} },
      );
      if (failure || data?.deleted !== true)
        throw new Error('계정을 삭제하지 못했습니다. 다시 시도하세요.');
      return this.logout();
    },
    destroy() {
      engine?.destroy();
      assets?.destroy();
      auth?.destroy();
      repository?.close();
      active = false;
    },
  };
}
