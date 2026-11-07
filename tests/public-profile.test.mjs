import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignSnapshot,
  buildSnapshot,
  cleanName,
  escapeHtml,
  formatFocus,
  gradientIndex,
  lastWeekStart,
  normalizeVisibility,
  renderProfile,
} from '../src/lib/public-profile.mjs';

const TZ = 'Asia/Seoul';
// 2026-11-08 15:00 KST (Sunday)
const NOW = new Date('2026-11-08T06:00:00Z');
const at = (iso) => Date.parse(iso);
const state = {
  version: 1,
  settings: {},
  timer: null,
  templates: [],
  projects: [
    { id: 'p1', name: '포트폴리오', color: '#e58a6b', icon: '', outcome: '', image: '' },
    { id: 'p2', name: '영어', color: 'not-a-color', icon: '', outcome: '', image: '' },
  ],
  tasks: [
    { id: 't1', title: '랜딩', project: 'p1', estimate: 2, remaining: 0, followUpOf: '', date: '', done: true },
    { id: 't2', title: '회화', project: 'p2', estimate: 1, remaining: 0, followUpOf: '', date: '', done: true },
  ],
  records: [
    { id: 'r1', taskId: 't1', seconds: 1500, pomodoros: 1, duration: 1500, at: at('2026-11-08T01:00:00Z') },
    { id: 'r2', taskId: 't1', seconds: 750, pomodoros: 0.5, duration: 1500, at: at('2026-11-08T02:00:00Z') },
    { id: 'r3', taskId: 't2', seconds: 1500, pomodoros: 1, duration: 1500, at: at('2026-11-07T01:00:00Z') },
    // 15:30 UTC on the 7th is 00:30 KST on the 8th.
    { id: 'r4', taskId: 'gone', seconds: 1500, pomodoros: 1, duration: 1500, at: at('2026-11-07T15:30:00Z') },
    // Outside the 140-day window.
    { id: 'r5', taskId: 't1', seconds: 1500, pomodoros: 3, duration: 1500, at: at('2026-01-01T01:00:00Z') },
  ],
  tickets: [
    { id: 'k1', taskId: 't1', title: '랜딩', projectId: 'p1', completedAt: at('2026-11-08T02:05:00Z'), estimate: 2, used: 1.5, clipId: '', note: '<b>메모</b>', highlight: false, sticker: '', voided: false },
    { id: 'k2', taskId: 't2', title: '회화', projectId: 'p2', completedAt: at('2026-11-07T01:05:00Z'), estimate: 1, used: 1, clipId: '', note: '', highlight: false, sticker: '', voided: false },
    { id: 'k3', taskId: 't2', title: '취소', projectId: 'p2', completedAt: at('2026-11-08T03:00:00Z'), estimate: 1, used: 1, clipId: '', note: '', highlight: false, sticker: '', voided: true },
  ],
};

test('snapshot keeps only common sections when every switch is off', () => {
  const snapshot = buildSnapshot({ state, visibility: {}, now: NOW, timeZone: TZ });
  assert.deepEqual(Object.keys(snapshot).sort(), ['date', 'days', 'timeZone', 'today', 'v']);
  assert.equal(snapshot.date, '2026-11-08');
  assert.equal(snapshot.days.length, 140);
  // r1 + r2 + r4 (00:30 KST) fall on the 8th; r3 on the 7th.
  assert.equal(snapshot.today, 2.5);
  assert.equal(snapshot.days[139], 2.5);
  assert.equal(snapshot.days[138], 1);
  assert.equal(snapshot.days.reduce((a, b) => a + b, 0), 3.5);
  assert.ok(!JSON.stringify(snapshot).includes('랜딩'));
});

test('snapshot adds each section only when its switch is on', () => {
  const all = normalizeVisibility({ video: true, focus: true, projects: true, tasks: true, memo: true });
  const snapshot = buildSnapshot({
    state,
    visibility: all,
    now: NOW,
    timeZone: TZ,
    video: { path: 'u/video-d1.webm', weekStart: '2026-10-26' },
  });
  assert.equal(snapshot.focusSeconds, 1500 + 750 + 1500);
  assert.deepEqual(snapshot.projects, [
    { name: '포트폴리오', color: '#e58a6b', count: 1.5 },
    { name: '영어', color: '#9ba580', count: 1 },
  ]);
  assert.equal(snapshot.tasks.length, 1, 'only today, voided tickets excluded');
  assert.deepEqual(snapshot.tasks[0], {
    title: '랜딩',
    used: 1.5,
    estimate: 2,
    at: at('2026-11-08T02:05:00Z'),
    project: { name: '포트폴리오', color: '#e58a6b' },
    note: '<b>메모</b>',
  });
  assert.deepEqual(snapshot.video, { path: 'u/video-d1.webm', weekStart: '2026-10-26' });

  const noMemo = buildSnapshot({ state, visibility: { tasks: true }, now: NOW, timeZone: TZ });
  assert.equal(noMemo.tasks[0].note, undefined);
  assert.equal(noMemo.tasks[0].project, undefined, 'project chip follows the projects switch');
  assert.equal(noMemo.video, undefined);
});

test('aligning an old snapshot moves history and clears today', () => {
  const snapshot = buildSnapshot({ state, visibility: { tasks: true, focus: true }, now: NOW, timeZone: TZ });
  const same = alignSnapshot(snapshot, NOW);
  assert.equal(same.count, 2.5);
  assert.equal(same.tasks.length, 1);
  const later = alignSnapshot(snapshot, new Date('2026-11-10T06:00:00Z'));
  assert.equal(later.today, '2026-11-10');
  assert.equal(later.count, 0);
  assert.equal(later.focusSeconds, 0);
  assert.deepEqual(later.tasks, []);
  assert.equal(later.days[137], 2.5);
  assert.equal(later.days[139], 0);
});

test('weekly video shows only for the latest finished week', () => {
  assert.equal(lastWeekStart('2026-11-08'), '2026-10-26');
  assert.equal(lastWeekStart('2026-11-09'), '2026-11-02');
  const snapshot = { v: 1, date: '2026-11-08', timeZone: TZ, days: [0], today: 0, video: { path: 'x', weekStart: '2026-10-26' } };
  assert.ok(alignSnapshot(snapshot, NOW).video);
  assert.equal(alignSnapshot(snapshot, new Date('2026-11-09T06:00:00Z')).video, null);
});

test('render escapes user text and picks a gradient without video', () => {
  const snapshot = buildSnapshot({ state, visibility: { tasks: true, memo: true, projects: true }, now: NOW, timeZone: TZ });
  const html = renderProfile({ slug: 'k7m2qx9abc', name: '<script>x</script>', snapshot }, { now: NOW });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;메모&lt;/b&gt;'));
  assert.ok(html.includes(`pp-cover plain g${gradientIndex('k7m2qx9abc')}`));
  assert.ok(!html.includes('<video'));
  assert.ok(html.includes('aria-label="11월 8일 2.5"'));
  assert.ok(html.includes('오늘 완료한 포모도로'));
  assert.ok(html.includes('완료한 할 일'));
  assert.ok(!html.includes('집중 시간'));
});

test('render shows video and photo only when given', () => {
  const snapshot = { v: 1, date: '2026-11-08', timeZone: TZ, days: [1], today: 1, video: { path: 'p', weekStart: '2026-10-26' } };
  const html = renderProfile({ slug: 'aaaaaaaaaa', name: 'a', snapshot, videoUrl: 'https://x/v.webm', photoUrl: 'data:image/jpeg;base64,AA' }, { now: NOW });
  assert.ok(html.includes('<video class="pp-video" src="https://x/v.webm"'));
  assert.ok(html.includes('class="avatar"'));
  assert.ok(html.includes('aria-label="영상 정지"'));
});

test('names, gradients and focus labels', () => {
  assert.equal(cleanName('  토마토러버 '), '토마토러버');
  assert.equal(cleanName('a'.repeat(21)), '');
  assert.equal(cleanName('가'.repeat(20)), '가'.repeat(20));
  assert.equal(cleanName('a\u0007b'), 'ab');
  assert.equal(gradientIndex('pf_8c2e1a'), 0);
  assert.equal(gradientIndex('pf_3b7d90'), 3);
  assert.equal(formatFocus(125 * 60), '2시간 5분');
  assert.equal(formatFocus(50 * 60), '50분');
  assert.equal(formatFocus(7200), '2시간');
  assert.equal(escapeHtml(`"'&`), '&quot;&#39;&amp;');
});
