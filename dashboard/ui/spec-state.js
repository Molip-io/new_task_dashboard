const START_BEFORE = '시작전';
const PLANNED = '진행예정';
const COMPLETE = '완료';
const ACTIVE_PRIORITY = [
  ['진행중', '진행 중'],
  ['확인요청', '확인 요청'],
  ['검토중', '검토중'],
  ['추가진행', '추가 진행'],
];

function normalizedStatus(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function deriveSpecStatus(tasks = []) {
  const statuses = tasks.map(task => normalizedStatus(task?.status));
  if (!statuses.length) return '시작 전';
  if (statuses.every(status => status === COMPLETE)) return '완료';

  const active = ACTIVE_PRIORITY.find(([status]) => statuses.includes(status));
  if (active) return active[1];

  if (statuses.includes(PLANNED)) return '진행 예정';

  if (statuses.includes(COMPLETE)) return '완료';

  if (statuses.every(status => status === START_BEFORE)) return '시작 전';

  return '진행 중';
}
