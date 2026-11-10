// Swift 대조 시험용: Mac의 analytics.mjs로 같은 입력을 계산해 결과 JSON을 출력한다.
// 입력(stdin): { step: 'command', command, before } | { step: 'records', previous, next } | { step: 'config' }
import { readFileSync } from 'node:fs';
const analytics = await import(
  new URL('../../../../../src/lib/analytics.mjs', import.meta.url)
);
const input = JSON.parse(readFileSync(0, 'utf8'));
const out = input.map((job) => {
  if (job.step === 'command')
    return { event: analytics.commandEvent(job.command, job.before) };
  if (job.step === 'records')
    return { events: analytics.recordEvents(job.previous, job.next) };
  return {
    key: analytics.POSTHOG_KEY,
    host: analytics.POSTHOG_HOST,
    screens: analytics.SCREENS,
  };
});
process.stdout.write(JSON.stringify(out));
