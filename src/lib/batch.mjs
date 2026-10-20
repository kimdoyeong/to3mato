import { localDate, offsetDate, MAX_TASK_ESTIMATE } from './domain.mjs';

export const MAX_BATCH_SIZE = 500;
export function tokenizeTemplate(template) {
  const pieces = [];
  const matcher = /%[^%\r\n]*%|%[^%\r\n]*$/g;
  let last = 0;
  for (const match of template.matchAll(matcher)) {
    if (match.index > last)
      pieces.push({ text: template.slice(last, match.index), kind: 'text' });
    const token = match[0];
    pieces.push({
      text: token,
      kind:
        token === '%n%'
          ? 'number'
          : token === '%date%'
            ? 'date'
            : token.length > 1 && token.endsWith('%')
              ? 'invalid'
              : 'incomplete',
    });
    last = match.index + token.length;
  }
  if (last < template.length)
    pieces.push({ text: template.slice(last), kind: 'text' });
  return pieces;
}
export function renderTaskTemplate(template, sequence, date) {
  if (typeof template !== 'string' || !template.trim())
    throw new Error('할 일 이름 규칙을 입력하세요.');
  const pieces = tokenizeTemplate(template);
  if (pieces.some((piece) => ['invalid', 'incomplete'].includes(piece.kind)))
    throw new Error('템플릿은 %n%과 %date%만 사용할 수 있습니다.');
  const title = template
    .replaceAll('%n%', String(sequence))
    .replaceAll('%date%', date)
    .trim();
  if (title.length > 120)
    throw new Error('생성된 할 일 이름은 120자 이하여야 합니다.');
  return title;
}
function positiveInteger(value, max, label) {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${label}: 1부터 ${max}까지의 정수를 입력하세요.`);
  return value;
}
/** Generates drafts only. Persisted tasks have no reference to a template or recurrence rule. */
export function generateTaskBatch({
  template,
  count,
  estimate,
  startDate,
  weekdays,
  perDay,
  overrides = {},
}) {
  positiveInteger(count, MAX_BATCH_SIZE, '생성 개수');
  positiveInteger(estimate, MAX_TASK_ESTIMATE, '예상 포모도로');
  positiveInteger(perDay, MAX_BATCH_SIZE, '하루 기본 개수');
  if (
    typeof startDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    localDate(new Date(startDate + 'T12:00:00')) !== startDate
  )
    throw new Error('시작 날짜를 확인하세요.');
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    throw new Error('배치할 요일을 하나 이상 선택하세요.');
  for (const day of weekdays) {
    if (overrides[day] !== undefined)
      positiveInteger(overrides[day], MAX_BATCH_SIZE, '요일별 개수');
  }
  const drafts = [];
  let date = startDate;
  while (drafts.length < count) {
    const weekday = new Date(date + 'T12:00:00').getDay();
    if (weekdays.includes(weekday)) {
      const amount = Math.min(
        overrides[weekday] ?? perDay,
        count - drafts.length,
      );
      for (let i = 0; i < amount; i++)
        drafts.push({
          title: renderTaskTemplate(template, drafts.length + 1, date),
          estimate,
          date,
        });
    }
    if (drafts.length < count) {
      date = offsetDate(1, date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error('배치 날짜가 지원 범위를 벗어났습니다.');
    }
  }
  return drafts;
}
