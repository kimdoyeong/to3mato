import {
  PROTOCOL_VERSION,
  prepareOperation,
  projectedState,
  projectedDocument,
  validateDocument,
  importOperation,
  extraOperation,
  applyServerChanges,
} from './protocol.mjs';

/** Platform-independent engine. Repository writes atomically include the view and outbox. */
export function createSyncEngine({
  repository,
  transport,
  clock = { now: Date.now, sample() {} },
  onChange = () => {},
  onStatus = () => {},
  intervalMs = 30000,
}) {
  let serial = Promise.resolve(),
    work = null,
    rerun = false,
    channel = null,
    stopped = false,
    generation = 0,
    retry = null;
  let connection = 'off',
    error = '',
    failures = 0;
  const status = () => ({
    enabled: repository.read().enabled,
    connection,
    pending: repository.read().pending.length,
    conflicts: repository.read().conflicts,
    error,
    owner: repository.read().owner,
    deviceId: repository.read().deviceId,
    timeZone: repository.read().confirmed.timeZone,
  });
  const report = () => onStatus(status());
  function exclusive(fn) {
    const result = serial.then(fn, fn);
    serial = result.catch(() => {});
    return result;
  }
  async function save(value, source = 'local') {
    await repository.write(value);
    onChange(projectedState(value), {
      source,
      document: projectedDocument(value),
      owner: value.owner,
      deviceId: value.deviceId,
    });
    report();
  }
  function request() {
    if (stopped || !repository.read().enabled) return Promise.resolve();
    rerun = true;
    if (work) return work;
    const runGeneration = generation;
    work = (async () => {
      do {
        rerun = false;
        if (
          stopped ||
          runGeneration !== generation ||
          !repository.read().enabled
        )
          break;
        try {
          if (!channel)
            channel = transport.subscribe(
              () => {
                void request();
              },
              (connected) => {
                if (runGeneration !== generation) return;
                connection = connected ? 'online' : 'offline';
                report();
                if (connected) void request();
              },
            );
          const before = clock.now();
          const local = repository.read();
          const response = await transport.pull({
            epoch: local.epoch,
            cursor: local.cursor,
            deviceId: local.deviceId,
            timeZone: local.confirmed.timeZone,
          });
          if (
            runGeneration !== generation ||
            stopped ||
            !repository.read().enabled
          )
            break;
          clock.sample(response.serverNow, before);
          await exclusive(async () => {
            if (
              runGeneration !== generation ||
              stopped ||
              !repository.read().enabled
            )
              return;
            const next = structuredClone(repository.read());
            if (
              response.version !== PROTOCOL_VERSION ||
              typeof response.cursor !== 'string' ||
              !/^\d+$/.test(response.cursor) ||
              typeof response.epoch !== 'string'
            )
              throw new Error('지원하지 않는 동기화 데이터입니다.');
            const remote = response.document
              ? validateDocument(response.document)
              : applyServerChanges(
                  next.confirmed,
                  response.changes,
                  next.cursor,
                );
            if (response.hasMore) rerun = true;
            if (
              next.epoch === response.epoch &&
              BigInt(response.cursor) < BigInt(next.cursor)
            )
              throw new Error('동기화 위치를 확인할 수 없습니다.');
            if (!next.initialized) {
              const localDoc = projectedDocument(next);
              next.backup ??= localDoc;
              next.confirmed = remote;
              next.pending = [
                importOperation(next, localDoc.state, clock.now()),
              ];
              next.localEvidence = {};
              for (const entity of ['rituals', 'assets', 'clips', 'deliveries'])
                for (const row of localDoc.extras[entity])
                  next.pending.push(extraOperation(next, entity, row.id, row));
              if (localDoc.state.timer) {
                if (!remote.state.timer)
                  next.pending.push(
                    prepareOperation(
                      next,
                      {
                        type: 'timer:adopt',
                        payload: { timer: localDoc.state.timer },
                      },
                      clock.now(),
                      true,
                    ),
                  );
                else
                  next.conflicts.push({
                    id: `initial:${next.deviceId}`,
                    reason: 'initial-timer',
                    document: localDoc,
                    at: clock.now(),
                  });
              }
              next.initialized = true;
            } else next.confirmed = remote;
            next.epoch = response.epoch;
            next.cursor = response.cursor;
            await save(next, 'remote');
          });
          let operation;
          while (
            (operation = repository.read().pending[0]) &&
            !stopped &&
            runGeneration === generation &&
            repository.read().enabled
          ) {
            const sent = clock.now();
            const result = await transport.push({
              operation,
              epoch: repository.read().epoch,
            });
            if (
              runGeneration !== generation ||
              stopped ||
              !repository.read().enabled
            )
              break;
            clock.sample(result.serverNow, sent);
            await exclusive(async () => {
              if (
                runGeneration !== generation ||
                stopped ||
                !repository.read().enabled
              )
                return;
              const next = structuredClone(repository.read());
              if (
                result.version !== PROTOCOL_VERSION ||
                typeof result.cursor !== 'string' ||
                !/^\d+$/.test(result.cursor) ||
                result.epoch !== next.epoch
              )
                throw new Error(
                  '동기화 상태가 변경되었습니다. 다시 연결하세요.',
                );
              const confirmed = validateDocument(result.document);
              const snapshot =
                next.localEvidence?.[operation.id] || projectedDocument(next);
              next.pending = next.pending.filter(
                (item) => item.id !== operation.id,
              );
              if (result.conflict) {
                next.conflicts.push({
                  id: operation.id,
                  operation,
                  document: snapshot,
                  reason: result.reason || 'timer',
                  at: clock.now(),
                });
                // Preserve descendants; never replay stale offline timer commands against a new session.
                const descendants = next.pending.filter(
                  (item) =>
                    item.kind === 'command' &&
                    (item.command.type.startsWith('timer:') ||
                      item.command.type.startsWith('checkin:')),
                );
                for (const item of descendants)
                  next.conflicts.push({
                    id: item.id,
                    operation: item,
                    document: next.localEvidence?.[item.id] || snapshot,
                    reason: 'dependent-timer',
                    at: clock.now(),
                  });
                const ids = new Set(descendants.map((item) => item.id));
                next.pending = next.pending.filter((item) => !ids.has(item.id));
                for (const id of ids)
                  if (next.localEvidence) delete next.localEvidence[id];
              }
              if (next.localEvidence) delete next.localEvidence[operation.id];
              if (BigInt(result.cursor) >= BigInt(next.cursor)) {
                next.confirmed = confirmed;
                next.cursor = result.cursor;
              }
              await save(next, 'remote');
            });
          }
          if (
            runGeneration !== generation ||
            stopped ||
            !repository.read().enabled
          )
            break;
          connection = 'online';
          error = '';
          failures = 0;
          report();
        } catch (failure) {
          if (runGeneration !== generation || stopped) break;
          connection =
            failure?.status === 401 || failure?.code === 'PGRST301'
              ? 'auth-required'
              : 'offline';
          error =
            connection === 'auth-required'
              ? '다시 로그인하세요.'
              : '동기화하지 못했습니다. 연결 상태를 확인하세요.';
          report();
          clearTimeout(retry);
          retry = setTimeout(
            () => void request(),
            Math.min(60000, 1000 * 2 ** Math.min(++failures, 6)),
          );
          retry.unref?.();
          break;
        }
      } while (rerun);
    })().finally(() => {
      work = null;
      if (
        rerun &&
        runGeneration !== generation &&
        !stopped &&
        repository.read().enabled
      )
        void request();
    });
    return work;
  }
  const interval = setInterval(() => void request(), intervalMs);
  interval.unref?.();
  return {
    status,
    state: () => projectedState(repository.read()),
    document: () => projectedDocument(repository.read()),
    syncNow: request,
    now: () => clock.now(),
    async enable() {
      stopped = false;
      await exclusive(async () => {
        const next = structuredClone(repository.read());
        next.enabled = true;
        await save(next);
      });
      void request();
    },
    async disable() {
      generation++;
      clearTimeout(retry);
      channel?.unsubscribe();
      channel = null;
      await exclusive(async () => {
        const next = structuredClone(repository.read());
        next.enabled = false;
        await save(next);
      });
      connection = 'off';
      report();
    },
    async dispatch(command) {
      await exclusive(async () => {
        const next = structuredClone(repository.read());
        if (command.type === 'settings:save' && command.payload?.trayDisplay)
          next.localSettings.trayDisplay = command.payload.trayDisplay;
        const operation = prepareOperation(
          next,
          command,
          clock.now(),
          connection !== 'online',
        );
        if (operation.kind !== 'patch' || operation.patches.length)
          next.pending.push(operation);
        // Keep the local result before a later pull rebases the optimistic view.
        // Conflicted offline sessions must remain exportable with their original records.
        if (operation.kind === 'command') {
          next.localEvidence ??= {};
          next.localEvidence[operation.id] = projectedDocument(next);
        }
        await save(next);
      });
      void request();
      return projectedState(repository.read());
    },
    async importData(raw) {
      await exclusive(async () => {
        const next = structuredClone(repository.read());
        next.pending.push(importOperation(next, raw, clock.now()));
        await save(next);
      });
      void request();
      return projectedState(repository.read());
    },
    async extra(entity, id, fields, deleted = false) {
      await exclusive(async () => {
        const next = structuredClone(repository.read());
        next.pending.push(extraOperation(next, entity, id, fields, deleted));
        await save(next);
      });
      void request();
    },
    async resolve(id, action) {
      if (!['keep', 'discard', 'timer'].includes(action))
        throw new Error('잘못된 요청입니다.');
      await exclusive(async () => {
        const next = structuredClone(repository.read());
        const conflict = next.conflicts.find((item) => item.id === id);
        if (!conflict) return;
        // Keep means retain in a separate archive, never silently count overlapping focus twice.
        if (action === 'timer') {
          if (!conflict.document.state.timer)
            throw new Error('타이머를 찾을 수 없습니다.');
          next.pending.push(
            prepareOperation(
              next,
              {
                type: 'timer:adopt',
                payload: { timer: conflict.document.state.timer },
              },
              clock.now(),
              connection !== 'online',
            ),
          );
          conflict.archived = true;
        } else if (action === 'keep') {
          conflict.archived = true;
        } else next.conflicts = next.conflicts.filter((item) => item.id !== id);
        await save(next);
      });
      void request();
    },
    destroy() {
      stopped = true;
      generation++;
      clearInterval(interval);
      clearTimeout(retry);
      channel?.unsubscribe();
      channel = null;
    },
  };
}

export function createClock({
  wall = Date.now,
  monotonic = () => performance.now(),
} = {}) {
  let base = wall(),
    start = monotonic(),
    correction = 0;
  return {
    now: () => base + (monotonic() - start),
    sample(serverNow, sentAt) {
      if (!Number.isFinite(serverNow)) return;
      const received = base + monotonic() - start;
      base = serverNow + Math.max(0, received - sentAt) / 2;
      correction = base - wall();
      start = monotonic();
    },
    resume() {
      base = wall() + correction;
      start = monotonic();
    },
  };
}
