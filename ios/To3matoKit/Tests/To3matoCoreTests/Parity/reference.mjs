// Swift 대조 시험용: Mac의 protocol.mjs로 같은 입력을 계산해 결과 JSON을 출력한다.
// 입력(stdin): { step: 'reduce' | 'changes' | 'prepare', ... }
import { readFileSync } from 'node:fs';
const root = new URL('../../../../../src/lib/', import.meta.url);
const protocol = await import(new URL('sync/protocol.mjs', root));
const { normalizeState } = await import(new URL('domain.mjs', root));
// Swift는 키를 정렬해 넘긴다. Mac은 JSON.stringify로 비교하므로 Mac 키 순서로 맞춘다.
const canonical = (doc) => {
  const state = normalizeState(doc.state);
  delete state.settings.trayDisplay;
  return { ...doc, state };
};
let counter = 0;
globalThis.crypto.randomUUID = () =>
  `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const input = JSON.parse(readFileSync(0, 'utf8'));
const out = [];
for (const job of input) {
  counter = job.idStart ?? 0;
  try {
    if (job.step === 'reduce') {
      let doc = canonical(job.document);
      const results = [];
      for (const { operation, serverNow, optimistic } of job.operations) {
        const r = protocol.reduceOperation(doc, operation, serverNow, { optimistic });
        doc = r.document;
        results.push({ conflict: r.conflict, document: doc });
      }
      out.push({ results });
    } else if (job.step === 'changes') {
      out.push({ document: protocol.applyServerChanges(canonical(job.document), job.changes, job.cursor) });
    } else if (job.step === 'prepare') {
      out.push({ operation: protocol.prepareOperation({ ...job.envelope, confirmed: canonical(job.envelope.confirmed) }, job.command, job.at, job.offline) });
    }
  } catch (error) {
    out.push({ error: error.message });
  }
}
process.stdout.write(JSON.stringify(out));
