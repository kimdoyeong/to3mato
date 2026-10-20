import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  normalizeState,
  createInitialState,
  settleTimer,
  validateProjectRow,
  validateTaskRow,
  validateRecordRow,
  validateSettings,
} from '../src/lib/domain.mjs';

export const SCHEMA_VERSION = 3;
const TOMBSTONE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

// Kept so v1 databases can be read during migration and recreated in tests.
export const SCHEMA_V1 = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL,
    name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL
  ) STRICT;
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL, title TEXT NOT NULL,
    estimate INTEGER NOT NULL CHECK(estimate BETWEEN 1 AND 48),
    project_id TEXT REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
    date TEXT NOT NULL, done INTEGER NOT NULL CHECK(done IN (0,1))
  ) STRICT;
  -- History intentionally keeps task_id even after a task has been deleted.
  CREATE TABLE focus_records (
    id INTEGER PRIMARY KEY, task_id TEXT NOT NULL,
    seconds REAL NOT NULL CHECK(seconds >= 0),
    pomodoros REAL NOT NULL CHECK(pomodoros BETWEEN 0 AND 1),
    duration REAL NOT NULL CHECK(duration > 0), at REAL NOT NULL
  ) STRICT;
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    focus REAL NOT NULL CHECK(focus > 0), rest REAL NOT NULL CHECK(rest > 0)
  ) STRICT;
  CREATE TABLE timer (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    task_id TEXT REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
    phase TEXT NOT NULL CHECK(phase IN ('focus','rest')),
    duration REAL NOT NULL CHECK(duration > 0),
    elapsed REAL NOT NULL CHECK(elapsed >= 0 AND elapsed <= duration),
    started_at REAL NOT NULL, running INTEGER NOT NULL CHECK(running IN (0,1)),
    CHECK((phase = 'focus' AND task_id IS NOT NULL) OR (phase = 'rest' AND task_id IS NULL))
  ) STRICT;
  CREATE INDEX tasks_date_idx ON tasks(date, position);
  CREATE INDEX tasks_project_idx ON tasks(project_id, position);
  CREATE INDEX records_task_idx ON focus_records(task_id, at);
  CREATE INDEX records_date_idx ON focus_records(at);
`;
// Rows are never removed directly. `deleted = 1` keeps a tombstone so an older
// synced copy cannot bring the row back. updated_at holds the row's HLC.
const SCHEMA_V3 = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL,
    name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
    updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
  ) STRICT;
  -- No foreign key to projects: a synced task can arrive before its project.
  -- A task whose project is missing or deleted loads without a project.
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL, title TEXT NOT NULL,
    estimate INTEGER NOT NULL CHECK(estimate BETWEEN 1 AND 48),
    project_id TEXT, date TEXT NOT NULL, done INTEGER NOT NULL CHECK(done IN (0,1)),
    updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
  ) STRICT;
  -- History intentionally keeps task_id even after a task has been deleted.
  CREATE TABLE focus_records (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
    seconds REAL NOT NULL CHECK(seconds >= 0),
    pomodoros REAL NOT NULL CHECK(pomodoros BETWEEN 0 AND 1),
    duration REAL NOT NULL CHECK(duration > 0), at REAL NOT NULL,
    updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
  ) STRICT;
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    focus REAL NOT NULL CHECK(focus > 0), rest REAL NOT NULL CHECK(rest > 0),
    updated_at TEXT NOT NULL,
    tray_display TEXT NOT NULL DEFAULT 'clock' CHECK(tray_display IN ('clock','bar','ring','hourglass'))
  ) STRICT;
  CREATE TABLE timer (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    task_id TEXT REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
    phase TEXT NOT NULL CHECK(phase IN ('focus','rest')),
    duration REAL NOT NULL CHECK(duration > 0),
    elapsed REAL NOT NULL CHECK(elapsed >= 0 AND elapsed <= duration),
    started_at REAL NOT NULL, running INTEGER NOT NULL CHECK(running IN (0,1)),
    CHECK((phase = 'focus' AND task_id IS NOT NULL) OR (phase = 'rest' AND task_id IS NULL))
  ) STRICT;
  -- Local changes waiting to be pushed. Written only while sync is on.
  CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL CHECK(entity IN ('project','task','record','settings')),
    id TEXT NOT NULL, data TEXT, hlc TEXT NOT NULL
  ) STRICT;
  CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    device_id TEXT NOT NULL,
    logging INTEGER NOT NULL DEFAULT 0 CHECK(logging IN (0,1)),
    cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor >= 0),
    last_sync_at REAL
  ) STRICT;
  CREATE INDEX projects_order_idx ON projects(deleted, position, id);
  CREATE INDEX tasks_order_idx ON tasks(deleted, position, id);
  CREATE INDEX tasks_date_idx ON tasks(date, position);
  CREATE INDEX tasks_project_idx ON tasks(project_id, position);
  CREATE INDEX records_order_idx ON focus_records(deleted, at, id);
  CREATE INDEX records_task_idx ON focus_records(task_id, at);
  CREATE INDEX changes_row_idx ON changes(entity, id);
`;

// Hybrid logical clock: `${wall ms, 15 digits}-${counter, 4 digits}-${device}`.
// String order equals time order, and the device suffix breaks ties.
export const HLC_PATTERN = /^(\d{15})-(\d{4})-([0-9a-f-]{36})$/;
export function formatHLC(wall, counter, device) {
  return `${String(wall).padStart(15, '0')}-${String(counter).padStart(4, '0')}-${device}`;
}
export function parseHLC(value) {
  const match = typeof value === 'string' && HLC_PATTERN.exec(value);
  return match
    ? { wall: Number(match[1]), counter: Number(match[2]), device: match[3] }
    : null;
}

// Row shapes match the domain row validators so changes can be synced as is.
const ENTITIES = {
  project: {
    table: 'projects',
    columns: ['position', 'name', 'icon', 'color'],
    values: (row) => [row.position, row.name, row.icon, row.color],
    select: 'id, name, icon, color, position',
    row: (r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      color: r.color,
      position: r.position,
    }),
    placeholder: [0, '', 'folder', '#000000'],
    validate: validateProjectRow,
    ordered: true,
  },
  task: {
    table: 'tasks',
    columns: ['position', 'title', 'estimate', 'project_id', 'date', 'done'],
    values: (row) => [
      row.position,
      row.title,
      row.estimate,
      row.project || null,
      row.date,
      Number(row.done),
    ],
    select: 'id, title, estimate, project_id, date, done, position',
    row: (r) => ({
      id: r.id,
      title: r.title,
      estimate: r.estimate,
      project: r.project_id ?? '',
      date: r.date,
      done: !!r.done,
      position: r.position,
    }),
    placeholder: [0, '', 1, null, '', 0],
    validate: validateTaskRow,
    ordered: true,
  },
  record: {
    table: 'focus_records',
    columns: ['task_id', 'seconds', 'pomodoros', 'duration', 'at'],
    values: (row) => [
      row.taskId,
      row.seconds,
      row.pomodoros,
      row.duration,
      row.at,
    ],
    select: 'id, task_id, seconds, pomodoros, duration, at',
    row: (r) => ({
      id: r.id,
      taskId: r.task_id,
      seconds: r.seconds,
      pomodoros: r.pomodoros,
      duration: r.duration,
      at: r.at,
    }),
    placeholder: ['', 0, 0, 1, 0],
    validate: validateRecordRow,
    ordered: false,
  },
};
const ENTITY_ORDER = { project: 0, task: 1, record: 2, settings: 3 };
const SETTINGS_ID = 'settings';

function stateRows(state) {
  return {
    project: (state?.projects ?? []).map((project, position) => ({
      id: project.id,
      name: project.name,
      icon: project.icon,
      color: project.color,
      position,
    })),
    task: (state?.tasks ?? []).map((task, position) => ({
      id: task.id,
      title: task.title,
      estimate: task.estimate,
      project: task.project,
      date: task.date,
      done: task.done,
      position,
    })),
    record: (state?.records ?? []).map((record) => ({
      id: record.id,
      taskId: record.taskId,
      seconds: record.seconds,
      pomodoros: record.pomodoros,
      duration: record.duration,
      at: record.at,
    })),
  };
}
/** Validate a remote change. Returns null when the change must be skipped. */
function validChange(change) {
  try {
    if (!change || typeof change !== 'object') return null;
    const { entity, id, hlc, data } = change;
    if (!parseHLC(hlc)) return null;
    if (entity === 'settings') {
      if (id !== SETTINGS_ID || !data || typeof data !== 'object') return null;
      return { entity, id, hlc, data: validateSettings(data) };
    }
    const definition = ENTITIES[entity];
    if (!definition || typeof id !== 'string' || !id || id.length > 120)
      return null;
    if (data === null) return { entity, id, hlc, data: null };
    if (typeof data !== 'object') return null;
    const row = definition.validate(data);
    return row.id === id ? { entity, id, hlc, data: row } : null;
  } catch {
    return null;
  }
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class SQLiteStore {
  constructor(directory, { now = Date.now } = {}) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'to3mato.sqlite3');
    this.legacyFile = path.join(directory, 'state.json');
    this.migrationBackup = path.join(directory, 'state.pre-sqlite.json');
    this.importBackup = path.join(directory, 'to3mato.pre-import.sqlite3');
    this.v2Backup = path.join(directory, 'to3mato.pre-v2.sqlite3');
    this.now = now;
    this.db = null;
    this.previous = null;
    this.statements = new Map();
    this.deviceId = null;
    this.logging = false;
    this.clock = { wall: 0, counter: 0 };
  }
  statement(sql) {
    if (!this.statements.has(sql))
      this.statements.set(sql, this.db.prepare(sql));
    return this.statements.get(sql);
  }
  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Copy the committed database, including WAL content, without replacing an existing file. */
  snapshot(target, replace = true) {
    if (!replace && fs.existsSync(target)) return;
    const temporary = target + '.tmp';
    try {
      fs.rmSync(temporary, { force: true });
      this.db.prepare('VACUUM INTO ?').run(temporary);
      fs.chmodSync(temporary, 0o600);
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  load() {
    if (!this.db) {
      try {
        this.db = new DatabaseSync(this.file);
        fs.chmodSync(this.file, 0o600);
        this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        const check = this.db.prepare('PRAGMA quick_check').all();
        if (check.some((row) => row.quick_check !== 'ok'))
          throw new Error('SQLite 데이터 무결성 검사에 실패했습니다.');
        const version = this.db
          .prepare('PRAGMA user_version')
          .get().user_version;
        if (![0, 1, 2, SCHEMA_VERSION].includes(version))
          throw new Error(`지원하지 않는 DB 버전입니다: ${version}`);
        if (version === 0) this.create();
        else if (version === 1) this.migrateV1();
        else if (version === 2) this.migrateV2();
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
        this.openSyncState();
        this.transaction(() => this.removeOldTombstones());
      } catch (error) {
        this.close();
        throw error;
      }
    }
    try {
      const state = this.readState();
      this.previous = structuredClone(state);
      return state;
    } catch (error) {
      this.close();
      throw error;
    }
  }
  create() {
    if (
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        )
        .all().length
    )
      throw new Error('알 수 없는 데이터베이스입니다.');
    const legacy = fs.existsSync(this.legacyFile);
    // Invalid JSON stops initialization. Never silently replace it with demo data.
    const initial = legacy
      ? normalizeState(JSON.parse(fs.readFileSync(this.legacyFile, 'utf8')))
      : createInitialState();
    if (legacy && !fs.existsSync(this.migrationBackup)) {
      fs.copyFileSync(
        this.legacyFile,
        this.migrationBackup,
        fs.constants.COPYFILE_EXCL,
      );
    }
    this.transaction(() => {
      this.db.exec(SCHEMA_V3);
      this.initSyncState();
      this.writeChanges(initial, null);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }
  migrateV2() {
    this.snapshot(
      path.join(path.dirname(this.file), 'to3mato.pre-v3.sqlite3'),
      false,
    );
    this.transaction(() => {
      this.db.exec(
        "ALTER TABLE settings ADD COLUMN tray_display TEXT NOT NULL DEFAULT 'clock' CHECK(tray_display IN ('clock','bar','ring','hourglass'))",
      );
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }
  migrateV1() {
    // VACUUM cannot run inside a transaction. Keep the first backup if a retry happens.
    this.snapshot(this.v2Backup, false);
    this.transaction(() => {
      const state = this.readStateV1();
      // Children first so the implicit deletes never violate a foreign key.
      this.db.exec(
        'DROP TABLE timer; DROP TABLE focus_records; DROP TABLE tasks; DROP TABLE settings; DROP TABLE projects;',
      );
      this.statements.clear();
      this.db.exec(SCHEMA_V3);
      this.initSyncState();
      this.writeChanges(state, null);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }
  readStateV1() {
    if (this.db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('데이터 참조 검사에 실패했습니다.');
    const projects = this.db
      .prepare('SELECT id, name, icon, color FROM projects ORDER BY position')
      .all();
    const tasks = this.db
      .prepare(
        'SELECT id, title, estimate, project_id, date, done FROM tasks ORDER BY position',
      )
      .all()
      .map(({ project_id, done, ...task }) => ({
        ...task,
        project: project_id ?? '',
        done: !!done,
      }));
    // normalizeState gives these records their deterministic legacy IDs.
    const records = this.db
      .prepare(
        'SELECT task_id AS taskId, seconds, pomodoros, duration, at FROM focus_records ORDER BY id',
      )
      .all();
    return normalizeState({
      version: 1,
      projects,
      tasks,
      records,
      settings: this.db
        .prepare('SELECT focus, rest FROM settings WHERE id = 1')
        .get(),
      timer: this.readTimer(),
    });
  }
  readTimer() {
    const row = this.db
      .prepare(
        'SELECT task_id AS taskId, phase, duration, elapsed, started_at AS startedAt, running FROM timer WHERE id = 1',
      )
      .get();
    return row ? { ...row, running: !!row.running } : null;
  }
  readState() {
    if (this.db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('데이터 참조 검사에 실패했습니다.');
    const projects = this.statement(
      'SELECT id, name, icon, color FROM projects WHERE deleted = 0 ORDER BY position, id',
    ).all();
    const live = new Set(projects.map((project) => project.id));
    const tasks = this.statement(
      'SELECT id, title, estimate, project_id, date, done FROM tasks WHERE deleted = 0 ORDER BY position, id',
    )
      .all()
      .map(({ project_id, done, ...task }) => ({
        ...task,
        project: project_id && live.has(project_id) ? project_id : '',
        done: !!done,
      }));
    const records = this.statement(
      'SELECT id, task_id AS taskId, seconds, pomodoros, duration, at FROM focus_records WHERE deleted = 0 ORDER BY at, id',
    ).all();
    const settings = this.statement(
      'SELECT focus, rest, tray_display AS trayDisplay FROM settings WHERE id = 1',
    ).get();
    return normalizeState({
      version: 1,
      projects,
      tasks,
      records,
      settings,
      timer: this.readTimer(),
    });
  }
  initSyncState() {
    this.deviceId = crypto.randomUUID();
    this.logging = false;
    this.clock = { wall: 0, counter: 0 };
    this.db
      .prepare('INSERT INTO sync_state (id, device_id) VALUES (1, ?)')
      .run(this.deviceId);
  }
  openSyncState() {
    const row = this.db
      .prepare('SELECT device_id, logging FROM sync_state WHERE id = 1')
      .get();
    if (!row) throw new Error('동기화 상태를 찾을 수 없습니다.');
    this.deviceId = row.device_id;
    this.logging = !!row.logging;
    // The clock resumes after the newest HLC stored in any row or pending change.
    const latest = this.db
      .prepare(
        `SELECT max(value) AS value FROM (
          SELECT max(updated_at) AS value FROM projects
          UNION ALL SELECT max(updated_at) FROM tasks
          UNION ALL SELECT max(updated_at) FROM focus_records
          UNION ALL SELECT max(updated_at) FROM settings
          UNION ALL SELECT max(hlc) FROM changes)`,
      )
      .get().value;
    const parsed = parseHLC(latest);
    this.clock = parsed
      ? { wall: parsed.wall, counter: parsed.counter }
      : { wall: 0, counter: 0 };
  }
  advanceClock(wall, counter) {
    // Four counter digits. Overflow moves the logical wall forward by 1 ms.
    if (counter > 9999) {
      wall += 1;
      counter = 0;
    }
    this.clock = { wall, counter };
  }
  /** Next HLC for a local change. */
  tick() {
    const last = this.clock;
    const wall = Math.max(this.now(), last.wall);
    this.advanceClock(wall, wall === last.wall ? last.counter + 1 : 0);
    return formatHLC(this.clock.wall, this.clock.counter, this.deviceId);
  }
  /** Merge a remote HLC so later local changes order after it. */
  receive(hlc) {
    const remote = parseHLC(hlc),
      last = this.clock;
    const wall = Math.max(this.now(), last.wall, remote.wall);
    let counter = 0;
    if (wall === last.wall && wall === remote.wall)
      counter = Math.max(last.counter, remote.counter) + 1;
    else if (wall === last.wall) counter = last.counter + 1;
    else if (wall === remote.wall) counter = remote.counter + 1;
    this.advanceClock(wall, counter);
  }
  log(entity, id, data, hlc) {
    if (!this.logging) return;
    this.statement(
      'INSERT INTO changes (entity, id, data, hlc) VALUES (?, ?, ?, ?)',
    ).run(entity, id, data === null ? null : JSON.stringify(data), hlc);
  }
  putRow(entity, row, hlc, log = true) {
    const { table, columns, values } = ENTITIES[entity];
    const all = ['id', ...columns, 'updated_at', 'deleted'];
    this.statement(
      `INSERT INTO ${table} (${all.join(',')}) VALUES (${all.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${[...columns, 'updated_at'].map((column) => `${column}=excluded.${column}`).join(',')}, deleted=0`,
    ).run(row.id, ...values(row), hlc, 0);
    if (log) this.log(entity, row.id, row, hlc);
  }
  deleteRow(entity, id, hlc, log = true) {
    const { table, columns, placeholder } = ENTITIES[entity];
    const result = this.statement(
      `UPDATE ${table} SET deleted = 1, updated_at = ? WHERE id = ?`,
    ).run(hlc, id);
    // A delete for an unknown row still leaves a tombstone so an older copy cannot win.
    if (result.changes === 0) {
      const all = ['id', ...columns, 'updated_at', 'deleted'];
      this.statement(
        `INSERT INTO ${table} (${all.join(',')}) VALUES (${all.map(() => '?').join(',')})`,
      ).run(id, ...placeholder, hlc, 1);
    }
    if (log) this.log(entity, id, null, hlc);
  }
  putSettings(settings, hlc, log = true) {
    this.statement(
      'INSERT INTO settings (id, focus, rest, tray_display, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET focus=excluded.focus, rest=excluded.rest, tray_display=excluded.tray_display, updated_at=excluded.updated_at',
    ).run(settings.focus, settings.rest, settings.trayDisplay ?? 'clock', hlc);
    if (log)
      this.log(
        'settings',
        SETTINGS_ID,
        {
          focus: settings.focus,
          rest: settings.rest,
          trayDisplay: settings.trayDisplay,
        },
        hlc,
      );
  }
  readRow(entity, id) {
    const { table, select, row } = ENTITIES[entity];
    return row(
      this.statement(`SELECT ${select} FROM ${table} WHERE id = ?`).get(id),
    );
  }
  writeChanges(next, previous) {
    const before = stateRows(previous),
      after = stateRows(next);
    for (const entity of Object.keys(ENTITIES)) {
      const old = new Map(before[entity].map((row) => [row.id, row]));
      const ids = new Set(after[entity].map((row) => row.id));
      for (const row of before[entity])
        if (!ids.has(row.id)) this.deleteRow(entity, row.id, this.tick());
      for (const row of after[entity])
        if (!equal(old.get(row.id), row)) this.putRow(entity, row, this.tick());
    }
    if (!equal(previous?.settings, next.settings))
      this.putSettings(next.settings, this.tick());
    if (!equal(previous?.timer ?? null, next.timer)) {
      if (!next.timer) this.statement('DELETE FROM timer WHERE id = 1').run();
      else {
        const t = next.timer;
        this.statement(
          'INSERT INTO timer (id, task_id, phase, duration, elapsed, started_at, running) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, phase=excluded.phase, duration=excluded.duration, elapsed=excluded.elapsed, started_at=excluded.started_at, running=excluded.running',
        ).run(
          t.taskId,
          t.phase,
          t.duration,
          t.elapsed,
          t.startedAt,
          Number(t.running),
        );
      }
    }
  }
  removeOldTombstones() {
    const cutoff = formatHLC(
      Math.max(0, this.now() - TOMBSTONE_DAYS * DAY),
      0,
      '',
    );
    for (const [entity, { table }] of Object.entries(ENTITIES)) {
      this.statement(
        `DELETE FROM ${table} WHERE deleted = 1 AND updated_at < ? AND NOT EXISTS (SELECT 1 FROM changes WHERE changes.entity = ? AND changes.id = ${table}.id)`,
      ).run(cutoff, entity);
    }
  }
  /** Dense positions keep the load order stable after remote rows share a position. */
  renumber(entity) {
    const { table } = ENTITIES[entity];
    const rows = this.statement(
      `SELECT id, position FROM ${table} WHERE deleted = 0 ORDER BY position, id`,
    ).all();
    rows.forEach((row, index) => {
      if (row.position === index) return;
      const hlc = this.tick();
      this.statement(
        `UPDATE ${table} SET position = ?, updated_at = ? WHERE id = ?`,
      ).run(index, hlc, row.id);
      this.log(entity, row.id, this.readRow(entity, row.id), hlc);
    });
  }
  wins(change) {
    const sql =
      change.entity === 'settings'
        ? 'SELECT updated_at FROM settings WHERE id = 1'
        : `SELECT updated_at FROM ${ENTITIES[change.entity].table} WHERE id = ?`;
    const local =
      change.entity === 'settings'
        ? this.statement(sql).get()
        : this.statement(sql).get(change.id);
    return !local || change.hlc > local.updated_at;
  }
  save(raw) {
    const next = normalizeState(raw);
    if (!this.db) this.load();
    this.transaction(() => this.writeChanges(next, this.previous));
    this.previous = structuredClone(next);
  }
  replace(raw) {
    const next = normalizeState(raw);
    if (!this.db) this.load();
    // VACUUM INTO includes committed WAL content. Copying only the DB file does not.
    this.snapshot(this.importBackup);
    // Rows missing from the file become tombstones, so the import also syncs.
    this.save(next);
  }
  /**
   * Apply changes pulled from the server. Later HLC wins per row.
   * Invalid changes are skipped. The result is validated before commit,
   * so a bad batch can never leave a database that fails to load.
   */
  applyRemote(changes, { cursor } = {}) {
    if (!this.db) this.load();
    if (!Array.isArray(changes)) throw new Error('잘못된 동기화 데이터입니다.');
    const valid = [];
    let skipped = 0;
    for (const change of changes) {
      const checked = validChange(change);
      if (checked) valid.push(checked);
      else skipped++;
    }
    valid.sort(
      (a, b) =>
        ENTITY_ORDER[a.entity] - ENTITY_ORDER[b.entity] ||
        (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0),
    );
    let applied = 0,
      next;
    this.transaction(() => {
      // A remote delete or completion of the focused task settles the timer first,
      // like the local task:delete and task:toggle commands.
      const timer = this.previous.timer;
      if (timer?.phase === 'focus') {
        const last = valid
          .filter((c) => c.entity === 'task' && c.id === timer.taskId)
          .at(-1);
        if (last && (last.data === null || last.data.done) && this.wins(last)) {
          const settled = structuredClone(this.previous);
          settleTimer(settled, this.now());
          this.writeChanges(settled, this.previous);
        }
      }
      for (const change of valid) {
        this.receive(change.hlc);
        if (!this.wins(change)) continue;
        if (change.entity === 'settings')
          this.putSettings(change.data, change.hlc, false);
        else if (change.data === null)
          this.deleteRow(change.entity, change.id, change.hlc, false);
        else this.putRow(change.entity, change.data, change.hlc, false);
        applied++;
      }
      for (const [entity, { ordered }] of Object.entries(ENTITIES))
        if (ordered) this.renumber(entity);
      if (cursor !== undefined) {
        if (!Number.isSafeInteger(cursor) || cursor < 0)
          throw new Error('잘못된 동기화 데이터입니다.');
        this.statement('UPDATE sync_state SET cursor = ? WHERE id = 1').run(
          cursor,
        );
      }
      next = this.readState();
    });
    this.previous = structuredClone(next);
    return { state: next, applied, skipped };
  }
  syncState() {
    if (!this.db) this.load();
    const row = this.statement(
      'SELECT device_id, logging, cursor, last_sync_at FROM sync_state WHERE id = 1',
    ).get();
    return {
      deviceId: row.device_id,
      logging: !!row.logging,
      cursor: row.cursor,
      lastSyncAt: row.last_sync_at,
    };
  }
  saveSyncState({ cursor, lastSyncAt } = {}) {
    if (!this.db) this.load();
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0))
      throw new Error('잘못된 동기화 데이터입니다.');
    this.transaction(() => {
      if (cursor !== undefined)
        this.statement('UPDATE sync_state SET cursor = ? WHERE id = 1').run(
          cursor,
        );
      if (lastSyncAt !== undefined)
        this.statement(
          'UPDATE sync_state SET last_sync_at = ? WHERE id = 1',
        ).run(lastSyncAt);
    });
  }
  pendingChanges(limit = 500) {
    if (!this.db) this.load();
    return this.statement(
      'SELECT seq, entity, id, data, hlc FROM changes ORDER BY seq LIMIT ?',
    )
      .all(limit)
      .map((row) => ({
        seq: row.seq,
        entity: row.entity,
        id: row.id,
        data: row.data === null ? null : JSON.parse(row.data),
        hlc: row.hlc,
      }));
  }
  /** Pushed changes are on the server, so the local copy is removed. */
  markPushed(seqs) {
    if (!this.db) this.load();
    this.transaction(() => {
      for (const seq of seqs)
        this.statement('DELETE FROM changes WHERE seq = ?').run(seq);
    });
  }
  /** Start logging and queue every row, including tombstones, for the first push. */
  resetSync() {
    if (!this.db) this.load();
    this.transaction(() => {
      this.db.exec('DELETE FROM changes');
      this.statement(
        'UPDATE sync_state SET logging = 1, cursor = 0, last_sync_at = NULL WHERE id = 1',
      ).run();
      this.logging = true;
      for (const [entity, { table, select, row }] of Object.entries(ENTITIES)) {
        const order = ENTITIES[entity].ordered ? 'position, id' : 'at, id';
        for (const r of this.statement(
          `SELECT ${select}, updated_at, deleted FROM ${table} ORDER BY deleted, ${order}`,
        ).all())
          this.log(entity, r.id, r.deleted ? null : row(r), r.updated_at);
      }
      const settings = this.statement(
        'SELECT focus, rest, tray_display AS trayDisplay, updated_at FROM settings WHERE id = 1',
      ).get();
      this.log(
        'settings',
        SETTINGS_ID,
        {
          focus: settings.focus,
          rest: settings.rest,
          trayDisplay: settings.trayDisplay,
        },
        settings.updated_at,
      );
    });
  }
  /** Stop logging after sign-out. Unsent changes are dropped; resetSync resends everything. */
  disableSync() {
    if (!this.db) this.load();
    this.transaction(() => {
      this.db.exec('DELETE FROM changes');
      this.statement(
        'UPDATE sync_state SET logging = 0, cursor = 0, last_sync_at = NULL WHERE id = 1',
      ).run();
      this.logging = false;
    });
  }
  close() {
    this.statements.clear();
    if (this.db) this.db.close();
    this.db = null;
    this.previous = null;
    this.deviceId = null;
    this.logging = false;
    this.clock = { wall: 0, counter: 0 };
  }
}
