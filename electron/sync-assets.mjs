import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  webm: 'video/webm',
  mp4: 'video/mp4',
};
const SAFE_ID = /^[A-Za-z0-9_.-]{1,160}$/;
const LIMIT = 250 * 1024 * 1024;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function createAssetManager({
  repository,
  engine,
  client,
  directory,
  userId,
  maxBytes = LIMIT,
  onStatus = () => {},
}) {
  const folder = path.join(directory, 'assets');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  let busy = null,
    stopped = false,
    lastError = '';
  const target = (id) => {
    if (
      typeof id !== 'string' ||
      !SAFE_ID.test(id) ||
      id === '.' ||
      id === '..'
    )
      throw new Error('잘못된 파일 ID입니다.');
    return path.join(folder, id);
  };
  async function read(id) {
    const file = target(id);
    const row = engine.document().extras.assets.find((item) => item.id === id);
    if (!row) return null;
    if (fs.existsSync(file)) {
      const bytes = await fs.promises.readFile(file);
      if (hash(bytes) === row.hash)
        return { bytes: new Uint8Array(bytes), mime: row.mime };
    }
    if (!repository.read().enabled || row.status !== 'ready' || stopped)
      return null;
    const { data, error } = await client.storage
      .from('to3mato')
      .download(row.path);
    if (error) throw new Error('파일을 다운로드하지 못했습니다.');
    const bytes = Buffer.from(await data.arrayBuffer());
    if (hash(bytes) !== row.hash || bytes.length !== row.size)
      throw new Error('파일 검증에 실패했습니다.');
    if (stopped) return null;
    await fs.promises.writeFile(file + '.tmp', bytes, { mode: 0o600 });
    await fs.promises.rename(file + '.tmp', file);
    return { bytes: new Uint8Array(bytes), mime: row.mime };
  }
  async function put(id, mime, input) {
    const file = target(id),
      bytes = Buffer.from(input);
    if (
      !Object.values(TYPES).includes(mime) ||
      !bytes.length ||
      bytes.length > 512 * 1024 * 1024
    )
      throw new Error('파일 형식 또는 크기를 확인하세요.');
    const rows = engine.document().extras.assets;
    const existing = rows.find((item) => item.id === id),
      digest = hash(bytes);
    if (existing) {
      if (existing.hash !== digest)
        throw new Error('기존 파일과 내용이 다릅니다.');
      return id;
    }
    if (
      rows.reduce((total, row) => total + row.size, 0) + bytes.length >
      maxBytes
    )
      throw new Error('파일 저장 용량을 초과했습니다.');
    await fs.promises.writeFile(file + '.tmp', bytes, { mode: 0o600 });
    await fs.promises.rename(file + '.tmp', file);
    await engine.extra('assets', id, {
      path: `${userId}/${id}`,
      hash: digest,
      size: bytes.length,
      mime,
      status: 'pending',
      name: id,
    });
    void flush();
    return id;
  }
  function flush() {
    if (busy || stopped || !repository.read().enabled)
      return busy || Promise.resolve();
    busy = (async () => {
      await engine.syncNow();
      if (
        Object.keys(engine.document().tombstones).some((key) =>
          key.startsWith('assets:'),
        )
      )
        await client.functions.invoke('purge-assets', { body: {} });
      for (const row of repository.read().confirmed.extras.assets) {
        if (stopped || !repository.read().enabled) break;
        const file = target(row.id);
        if (row.status !== 'pending' || !fs.existsSync(file)) continue;
        const bytes = await fs.promises.readFile(file);
        if (hash(bytes) !== row.hash) continue;
        const uploaded = await client.storage
          .from('to3mato')
          .upload(row.path, bytes, { contentType: row.mime, upsert: false });
        if (uploaded.error) {
          // An upload may have succeeded before its acknowledgement was lost.
          const existing = await client.storage
            .from('to3mato')
            .download(row.path);
          if (
            existing.error ||
            hash(Buffer.from(await existing.data.arrayBuffer())) !== row.hash
          ) {
            lastError =
              '파일을 업로드하지 못했습니다. 연결 상태와 저장 용량을 확인하세요.';
            onStatus();
            continue;
          }
        }
        if (stopped || !repository.read().enabled) break;
        await engine.extra('assets', row.id, { status: 'ready' });
      }
      await engine.syncNow();
      if (
        !engine.document().extras.assets.some((row) => row.status === 'pending')
      )
        lastError = '';
    })()
      .catch(() => {
        if (!stopped) lastError = '파일을 동기화하지 못했습니다.';
      })
      .finally(() => {
        busy = null;
        if (!stopped) onStatus();
      });
    return busy;
  }
  const retry = setInterval(() => void flush(), 30000);
  retry.unref?.();
  return {
    put,
    read,
    flush,
    status: () => ({
      mediaPending: engine
        .document()
        .extras.assets.filter((row) => row.status === 'pending').length,
      mediaError: lastError,
    }),
    async importProjectImages() {
      for (const project of engine.state().projects) {
        if (
          !project.image ||
          engine
            .document()
            .extras.assets.some((row) => row.id === project.image)
        )
          continue;
        const file = path.join(directory, 'project-images', project.image);
        if (SAFE_ID.test(project.image) && fs.existsSync(file))
          await put(
            project.image,
            TYPES[path.extname(file).slice(1)],
            await fs.promises.readFile(file),
          );
      }
    },
    destroy() {
      stopped = true;
      clearInterval(retry);
    },
  };
}
