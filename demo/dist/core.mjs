export const roundedPomodoros = (elapsed, duration) => Math.min(1, Math.max(0, Math.floor((elapsed / duration) * 2 + 0.5) / 2));
export const elapsedSeconds = (timer, now = Date.now()) => Math.min(timer.duration, Math.max(0, timer.elapsed + (timer.running ? (now - timer.startedAt) / 1000 : 0)));
export function settleTimer(state, now = Date.now()) {
  const timer = state.timer;
  if (!timer) return null;
  const elapsed = elapsedSeconds(timer, now);
  let record = null;
  if (timer.phase === 'focus' && timer.taskId && elapsed > 0) {
    record = { taskId: timer.taskId, seconds: elapsed, pomodoros: roundedPomodoros(elapsed, timer.duration), duration: timer.duration, at: now };
    state.records.push(record);
  }
  state.timer = null;
  return record;
}
export function startTask(state, taskId, duration, now = Date.now()) {
  if (state.timer?.phase === 'focus' && state.timer.taskId === taskId) {
    if (!state.timer.running) { state.timer.startedAt = now; state.timer.running = true; }
    return null;
  }
  const previous = settleTimer(state, now);
  state.timer = { taskId, duration, elapsed: 0, startedAt: now, running: true, phase: 'focus' };
  return previous;
}

export function getTodoSections(tasks, today) {
  const dayAfter = (n) => {
    const date = new Date(today+'T12:00:00');
    date.setDate(date.getDate()+n);
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  };
  const tomorrow = dayAfter(1);
  const upcoming = [...new Set([...Array.from({length:7},(_,i)=>dayAfter(i)), ...tasks.map(t=>t.date).filter(d=>d>=today)])].sort();
  const past = [...new Set(tasks.map(t=>t.date).filter(d=>d&&d<today))].sort().reverse();
  return ['', ...upcoming, ...past].map(date=>({
    date,
    label: !date?'미지정':date===today?'오늘':date===tomorrow?'내일':
      (date.slice(0,4)!==today.slice(0,4)?Number(date.slice(0,4))+'년 ':'')+Number(date.slice(5,7))+'월 '+Number(date.slice(8,10))+'일',
    tasks: tasks.filter(t=>(t.date||'')===date)
  }));
}
