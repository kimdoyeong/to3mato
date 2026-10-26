import {
  applyCommand,
  advanceTimer,
  createInitialState,
  normalizeState,
  elapsedSeconds,
  settleTimer,
} from '../domain.mjs';

export const PROTOCOL_VERSION = 1;
export const COLLECTIONS = [
  'projects',
  'tasks',
  'records',
  'tickets',
  'templates',
];
export const EXTRAS = ['rituals', 'assets', 'clips', 'deliveries'];
export const SHARED_COMMANDS = new Set([
  'timer:play',
  'timer:toggle',
  'timer:pause',
  'timer:end',
  'timer:advance',
  'timer:adopt',
  'checkin:save',
  'checkin:done',
  'checkin:followup',
  'checkin:skip',
  'task:toggle',
  'task:delete',
  'project:delete',
  'task:reorder',
]);
const clone = (value) => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function emptyState() {
  const state = createInitialState();
  for (const key of COLLECTIONS) state[key] = [];
  return state;
}
export function documentFrom(
  state = emptyState(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const normalized = normalizeState(state);
  delete normalized.settings.trayDisplay;
  return {
    version: PROTOCOL_VERSION,
    state: normalized,
    extras: Object.fromEntries(EXTRAS.map((key) => [key, []])),
    timer: { sessionId: null, revision: '', controller: null },
    tombstones: {},
    timeZone,
  };
}
export function validateDocument(raw) {
  if (
    raw?.version !== PROTOCOL_VERSION ||
    !raw.extras ||
    !raw.timer ||
    typeof raw.timer.revision !== 'string' ||
    !raw.tombstones ||
    typeof raw.timeZone !== 'string'
  )
    throw new Error('지원하지 않는 동기화 데이터입니다.');
  new Intl.DateTimeFormat('en', { timeZone: raw.timeZone }).format();
  const state = normalizeState(raw.state);
  delete state.settings.trayDisplay;
  for (const key of EXTRAS) {
    if (
      !Array.isArray(raw.extras[key]) ||
      raw.extras[key].some((row) => !row || typeof row.id !== 'string')
    )
      throw new Error('잘못된 동기화 데이터입니다.');
    if (
      new Set(raw.extras[key].map((row) => row.id)).size !==
      raw.extras[key].length
    )
      throw new Error('동기화 항목 ID가 중복됩니다.');
  }
  return { ...clone(raw), state };
}
export function createEnvelope(
  state,
  owner = null,
  deviceId = crypto.randomUUID(),
) {
  return {
    version: PROTOCOL_VERSION,
    owner,
    deviceId,
    enabled: false,
    initialized: false,
    epoch: null,
    cursor: '0',
    confirmed: documentFrom(state),
    pending: [],
    conflicts: [],
    localSettings: { trayDisplay: state.settings.trayDisplay },
    backup: null,
  };
}
export function diffRows(before, after, entity) {
  const old = new Map(before.map((row) => [row.id, row]));
  const ids = new Set(after.map((row) => row.id));
  const patches = before
    .filter((row) => !ids.has(row.id))
    .map((row) => ({ entity, id: row.id, delete: true }));
  for (const row of after) {
    const previous = old.get(row.id);
    const fields = Object.fromEntries(
      Object.entries(row).filter(
        ([key, value]) => key !== 'id' && !same(previous?.[key], value),
      ),
    );
    if (!previous || Object.keys(fields).length)
      patches.push({ entity, id: row.id, fields, create: !previous });
  }
  return patches;
}
export function patchesBetween(before, after) {
  const patches = COLLECTIONS.flatMap((key) =>
    diffRows(before[key], after[key], key),
  );
  const fields = Object.fromEntries(
    Object.entries(after.settings).filter(
      ([key, value]) =>
        key !== 'trayDisplay' && !same(before.settings[key], value),
    ),
  );
  if (Object.keys(fields).length)
    patches.push({ entity: 'settings', id: 'settings', fields });
  return patches;
}
function applyPatches(doc, patches) {
  for (const patch of patches) {
    const { entity, id } = patch;
    if (entity === 'settings') {
      Object.assign(doc.state.settings, patch.fields);
      continue;
    }
    if (![...COLLECTIONS, ...EXTRAS].includes(entity))
      throw new Error('지원하지 않는 동기화 항목입니다.');
    const root = COLLECTIONS.includes(entity) ? doc.state : doc.extras;
    const key = `${entity}:${id}`;
    if (patch.delete) {
      root[entity] = root[entity].filter((row) => row.id !== id);
      doc.tombstones[key] = true;
      continue;
    }
    if (doc.tombstones[key]) continue;
    const row = root[entity].find((item) => item.id === id);
    if (row) {
      if (entity === 'deliveries' && row.assetId && patch.fields.assetId) {
        if (patch.fields.seen) row.seen = true;
      } else Object.assign(row, patch.fields);
    } else if (patch.create) root[entity].push({ id, ...patch.fields });
  }
  // A stale field patch cannot reattach a task to a deleted project.
  for (const task of doc.state.tasks)
    if (task.project && !doc.state.projects.some((p) => p.id === task.project))
      task.project = '';
}
function deterministicIds(before, next, operation, sessionId) {
  for (const key of COLLECTIONS) {
    let index = 0;
    const old = new Set(before[key].map((row) => row.id));
    for (const row of next[key])
      if (!old.has(row.id)) {
        row.id =
          key === 'records'
            ? `focus:${sessionId || operation.id}`
            : `${key}:${operation.id}:${index++}`;
      }
  }
  return next;
}
export function reduceOperation(
  input,
  operation,
  serverNow = operation.at,
  { optimistic = false } = {},
) {
  const doc = clone(input);
  if (operation.kind === 'patch') {
    if (
      doc.state.timer &&
      operation.patches.some(
        (p) =>
          p.entity === 'tasks' &&
          p.id === doc.state.timer.taskId &&
          (p.delete || p.fields?.done === true),
      )
    ) {
      const timer = doc.state.timer;
      const end = timer.running
        ? Math.min(
            serverNow,
            timer.startedAt + (timer.duration - timer.elapsed) * 1000,
          )
        : serverNow;
      const record = settleTimer(doc.state, end);
      if (record) record.id = `focus:${doc.timer.sessionId}`;
      doc.timer = {
        sessionId: null,
        revision: operation.id,
        controller: operation.deviceId,
      };
    }
    applyPatches(doc, operation.patches);
  } else if (operation.kind === 'command') {
    const { command } = operation;
    if (!SHARED_COMMANDS.has(command.type))
      throw new Error('지원하지 않는 동기화 명령입니다.');
    const guarded =
      command.type.startsWith('timer:') ||
      command.type.startsWith('checkin:') ||
      (['task:delete', 'task:toggle'].includes(command.type) &&
        doc.state.timer?.taskId === command.payload?.id);
    if (
      !optimistic &&
      guarded &&
      (operation.expectedTimer !== doc.timer.revision ||
        operation.sessionId !== doc.timer.sessionId)
    ) {
      const settled =
        ['timer:end', 'timer:advance'].includes(command.type) &&
        doc.state.records.some(
          (record) => record.id === `focus:${operation.sessionId}`,
        );
      return { conflict: !settled, document: doc };
    }
    let at = operation.offline ? Math.min(operation.at, serverNow) : serverNow;
    if (doc.state.timer) at = Math.max(at, doc.state.timer.startedAt);
    const before = clone(doc.state);
    let next;
    if (command.type === 'timer:adopt') {
      next = clone(before);
      if (
        next.timer?.running &&
        elapsedSeconds(next.timer, at) >= next.timer.duration
      ) {
        const deadline =
          next.timer.startedAt +
          (next.timer.duration - next.timer.elapsed) * 1000;
        advanceTimer(next, deadline);
      }
      settleTimer(next, at);
      const desired = normalizeState({
        ...next,
        timer: command.payload.timer,
      }).timer;
      desired.elapsed = elapsedSeconds(desired, at);
      desired.startedAt = at;
      next.timer = desired;
    } else if (command.type === 'timer:advance') {
      next = clone(before);
      if (
        next.timer?.running &&
        elapsedSeconds(next.timer, at) >= next.timer.duration
      ) {
        at =
          next.timer.startedAt +
          (next.timer.duration - next.timer.elapsed) * 1000;
        advanceTimer(next, at);
      }
    } else {
      // Mirror the existing completion-before-command behavior, using the actual deadline.
      const prepared = clone(before);
      if (
        prepared.timer?.running &&
        elapsedSeconds(prepared.timer, at) >= prepared.timer.duration
      ) {
        const deadline =
          prepared.timer.startedAt +
          (prepared.timer.duration - prepared.timer.elapsed) * 1000;
        advanceTimer(prepared, deadline);
      }
      next = applyCommand(prepared, command, at, { advance: false });
    }
    doc.state = deterministicIds(before, next, operation, doc.timer.sessionId);
    for (const entity of COLLECTIONS)
      for (const row of before[entity])
        if (!next[entity].some((r) => r.id === row.id))
          doc.tombstones[`${entity}:${row.id}`] = true;
    if (!same(before.timer, next.timer)) {
      const newSession =
        next.timer &&
        (command.type === 'timer:adopt' ||
          !before.timer ||
          before.timer.taskId !== next.timer.taskId ||
          (before.timer.phase !== next.timer.phase &&
            next.timer.phase !== 'checkin'));
      doc.timer = {
        sessionId: next.timer
          ? newSession
            ? operation.id
            : doc.timer.sessionId || operation.id
          : null,
        revision: operation.id,
        controller:
          command.type === 'timer:advance'
            ? doc.timer.controller
            : operation.deviceId,
      };
    }
  } else throw new Error('지원하지 않는 동기화 명령입니다.');
  delete doc.state.settings.trayDisplay;
  const references = (d) =>
    new Set(
      [
        ...d.state.projects.map((p) => p.image),
        ...d.extras.clips.flatMap((c) => [c.assetId, c.thumbnailId]),
        ...d.extras.deliveries.map((c) => c.assetId),
      ].filter(Boolean),
    );
  const oldRefs = references(input),
    newRefs = references(doc);
  for (const id of oldRefs)
    if (!newRefs.has(id)) {
      doc.extras.assets = doc.extras.assets.filter((row) => row.id !== id);
      doc.tombstones[`assets:${id}`] = true;
    }
  return { document: validateDocument(doc), conflict: false };
}
export function projectedDocument(envelope) {
  let doc = clone(envelope.confirmed);
  for (const operation of envelope.pending) {
    try {
      doc = reduceOperation(doc, operation, operation.at, {
        optimistic: true,
      }).document;
    } catch {
      /* preserved for conflict resolution after server acknowledgement */
    }
  }
  return doc;
}
export function projectedState(envelope) {
  const state = normalizeState(projectedDocument(envelope).state);
  return {
    ...state,
    settings: { ...state.settings, ...envelope.localSettings },
  };
}
export function prepareOperation(envelope, command, at, offline = false) {
  const doc = projectedDocument(envelope);
  const base = {
    id: crypto.randomUUID(),
    deviceId: envelope.deviceId,
    version: PROTOCOL_VERSION,
    at,
    offline,
    expectedTimer: doc.timer.revision,
    sessionId: doc.timer.sessionId,
    baseCursor: envelope.cursor,
  };
  if (SHARED_COMMANDS.has(command.type)) {
    const operation = { ...base, kind: 'command', command: clone(command) };
    reduceOperation(doc, operation, at, { optimistic: true }); // validate before committing the queue
    return operation;
  }
  const next = applyCommand(normalizeState(doc.state), command, at, {
    advance: false,
  });
  return { ...base, kind: 'patch', patches: patchesBetween(doc.state, next) };
}
export function importOperation(envelope, raw, at = Date.now()) {
  const incoming = normalizeState(raw);
  const doc = projectedDocument(envelope);
  const merged = clone(doc.state);
  for (const key of COLLECTIONS) {
    const rows = new Map(merged[key].map((row) => [row.id, row]));
    for (const row of incoming[key]) rows.set(row.id, row);
    merged[key] = [...rows.values()];
  }
  merged.settings = incoming.settings;
  // Imports never replace the active shared timer or delete omitted rows.
  return {
    id: crypto.randomUUID(),
    deviceId: envelope.deviceId,
    version: PROTOCOL_VERSION,
    at,
    kind: 'patch',
    patches: patchesBetween(doc.state, merged),
    baseCursor: envelope.cursor,
  };
}
export function extraOperation(envelope, entity, id, fields, deleted = false) {
  if (
    !EXTRAS.includes(entity) ||
    typeof id !== 'string' ||
    !id ||
    id.length > 160
  )
    throw new Error('잘못된 동기화 항목입니다.');
  const { id: _id, ...data } = fields || {};
  return {
    id: crypto.randomUUID(),
    deviceId: envelope.deviceId,
    version: PROTOCOL_VERSION,
    at: Date.now(),
    kind: 'patch',
    baseCursor: envelope.cursor,
    patches: [{ entity, id, fields: data, create: true, delete: deleted }],
  };
}
export function applyServerChanges(input, changes, cursor) {
  let doc = clone(input),
    previous = BigInt(cursor);
  for (const change of changes) {
    if (
      typeof change.cursor !== 'string' ||
      BigInt(change.cursor) !== previous + 1n ||
      !change.delta
    )
      throw new Error('동기화 변경이 누락되었습니다.');
    const delta = change.delta;
    applyPatches(doc, delta.patches);
    for (const [entity, order] of Object.entries(delta.orders)) {
      const root = COLLECTIONS.includes(entity) ? doc.state : doc.extras;
      if (!root[entity] || !Array.isArray(order))
        throw new Error('잘못된 동기화 데이터입니다.');
      const map = new Map(root[entity].map((row) => [row.id, row]));
      if (
        order.length !== map.size ||
        new Set(order).size !== order.length ||
        order.some((id) => !map.has(id))
      )
        throw new Error('잘못된 동기화 순서입니다.');
      root[entity] = order.map((id) => map.get(id));
    }
    doc.timer = delta.timer;
    doc.state.timer = delta.timerState;
    doc.timeZone = delta.timeZone;
    doc.tombstones = delta.tombstones;
    doc = validateDocument(doc);
    previous = BigInt(change.cursor);
  }
  return doc;
}
