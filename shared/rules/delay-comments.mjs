// Delay records live in comments on the overdue work item's own page, not in
// dedicated Notion properties. These helpers only read and classify those comments;
// whether a reason is *sufficient* stays with the analysis agent.
import { kstDate } from './business-days.mjs';

// Comments written this many days before the current due date still count, so a
// heads-up sent just before the deadline is recognised. Tunable.
export const DELAY_COMMENT_WINDOW_DAYS = 7;
export const DELAY_GUIDANCE = '작업 페이지 댓글에 지연 사유와 변경 전·후 날짜를 적고 PD를 태그하세요. 지연 댓글은 해결 처리하지 마세요.';

const CLOSED = new Set(['완료', '중단']);
const dayOf = value => String(value || '').slice(0, 10);

export function isDelayCommentTarget(task, now = new Date()) {
  const due = dayOf(task?.due);
  return Boolean(due) && !CLOSED.has(task?.status) && due < kstDate(now);
}

function shiftDay(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function delayCommentWindowStart(due, windowDays = DELAY_COMMENT_WINDOW_DAYS) {
  return shiftDay(dayOf(due), -windowDays);
}

export function delayCommentFrom(raw) {
  const richText = raw.rich_text || [];
  return {
    id: raw.id,
    createdAt: raw.created_time,
    text: richText.map(item => item.plain_text ?? item.text?.content ?? '').join('').trim(),
    mentionUserIds: [...new Set(richText
      .filter(item => item.type === 'mention' && item.mention?.type === 'user')
      .map(item => item.mention.user?.id)
      .filter(Boolean))],
  };
}

// Only comments in the recognition window count, oldest first. `raw` comes from
// the page comments endpoint, which already includes thread replies.
export function recognizedDelayComments(rawComments, due, windowDays = DELAY_COMMENT_WINDOW_DAYS) {
  const start = delayCommentWindowStart(due, windowDays);
  return rawComments.map(delayCommentFrom)
    .filter(comment => comment.text || comment.mentionUserIds.length)
    .filter(comment => (kstDate(comment.createdAt) || '') >= start)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

const validDay = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const iso = (year, month, day) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

// Recognises 2026-10-15, 2026.10.15, 2026/10/15, 10/15, 10.15 and 10월 15일. A date
// without a year takes the year (previous, same or next one) that lands closest to
// the due date. Anything that is not a real calendar date is ignored.
export function extractDates(text, due) {
  const dueDay = dayOf(due);
  const dueYear = Number(dueDay.slice(0, 4)) || new Date().getUTCFullYear();
  const found = new Set();
  let rest = String(text || '');
  const take = (pattern, build) => {
    rest = rest.replace(pattern, (...match) => {
      const value = build(match);
      if (value) found.add(value);
      return ' '.repeat(match[0].length);
    });
  };
  const nearest = (month, day) => [dueYear - 1, dueYear, dueYear + 1]
    .filter(year => validDay(year, month, day))
    .map(year => iso(year, month, day))
    .sort((left, right) => Math.abs(Date.parse(left) - Date.parse(dueDay)) - Math.abs(Date.parse(right) - Date.parse(dueDay)))[0] || null;
  take(/(?<![\d])(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?![\d])/g, ([, year, month, day]) => (validDay(+year, +month, +day) ? iso(+year, +month, +day) : null));
  take(/(?<![\d])(\d{1,2})\s*월\s*(\d{1,2})\s*일?/g, ([, month, day]) => nearest(+month, +day));
  take(/(?<![\d./])(\d{1,2})[/.](\d{1,2})(?![\d/.]|\.\d)/g, ([, month, day]) => nearest(+month, +day));
  return [...found];
}

// A comment records the schedule change when it names two different dates and one
// of them is the item's current due date (old date -> new date).
export function recordsDateChange(comment, due) {
  const dates = extractDates(comment.text, due);
  return dates.length >= 2 && dates.includes(dayOf(due));
}

export function mentionsAny(comment, userIds) {
  return comment.mentionUserIds.some(id => userIds.has(id));
}
