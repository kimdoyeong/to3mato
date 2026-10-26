import { generateTaskBatch, MAX_BATCH_SIZE } from './batch.mjs';

/** One round occupies one selected day; steps stay in their saved order. */
export function generateTemplateBatch({ steps, count, startDate, weekdays }) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 20)
    throw new Error('템플릿 단계는 1~20개여야 합니다.');
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count * steps.length > MAX_BATCH_SIZE
  )
    throw new Error(
      `생성 개수: 1부터 ${MAX_BATCH_SIZE}까지의 정수를 입력하세요.`,
    );
  const batches = steps.map(({ title, estimate }) =>
    generateTaskBatch({
      template: title,
      estimate,
      count,
      startDate,
      weekdays,
      perDay: 1,
    }),
  );
  return Array.from({ length: count }, (_, round) =>
    batches.map((batch) => batch[round]),
  ).flat();
}
