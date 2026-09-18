const HOUR = 60 * 60 * 1000;

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function formatKst(value) {
  const time = timestamp(value);
  if (time === null) return '-';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(time).toISOString().slice(0, 10) === value ? value : '-';
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

const presentations = {
  success: { label: '분석 완료', canShowNarrative: true, notice: '' },
  partial: { label: '부분 분석', canShowNarrative: true, notice: '일부 근거만 분석했습니다. 판단에 필요한 근거를 함께 확인하세요.' },
  stale: { label: '갱신 필요', canShowNarrative: true, notice: '과거 분석을 참고용으로 표시합니다. 최신 업무 상황을 다시 확인하세요.' },
  failed: { label: '분석 실패', canShowNarrative: false, notice: '분석을 완료하지 못했습니다. 수집 상태와 분석 실행 결과를 확인하세요.' },
  not_run: { label: '분석 전', canShowNarrative: false, notice: '아직 분석 결과가 없습니다. 결정이나 병목이 없다는 뜻은 아닙니다.' },
  legacy: { label: '이전 형식 분석', canShowNarrative: false, notice: '이전 형식의 결과입니다. 현재 기준의 분석이 필요합니다.' },
  unknown: { label: '최신성 확인 필요', canShowNarrative: false, notice: '분석 상태나 시각을 확인할 수 없습니다. 최신 분석인지 확인하세요.' },
};

export function analysisPresentation(dashboard, now = new Date().toISOString()) {
  const ai = dashboard?.ai;
  const originalStatus = ai?.analysisStatus || 'not_run';
  let status = Object.hasOwn(presentations, originalStatus) ? originalStatus : 'unknown';
  const hasNarrativeStatus = ['success', 'partial', 'stale'].includes(originalStatus);
  if (['success', 'partial'].includes(status)) {
    const analyzedAt = timestamp(ai.generatedAt);
    const inputAt = timestamp(dashboard.agentHandoff?.generatedAt || dashboard.generatedAt);
    const currentTime = timestamp(now);
    if (analyzedAt !== null && ((currentTime !== null && currentTime - analyzedAt > 36 * HOUR)
      || (inputAt !== null && analyzedAt < inputAt))) {
      status = 'stale';
    } else if (analyzedAt === null || inputAt === null || currentTime === null) {
      status = 'unknown';
    }
  }
  return {
    status,
    ...presentations[status],
    canShowNarrative: hasNarrativeStatus,
  };
}

export function projectAnalysisPresentation(dashboard, project, now = new Date().toISOString()) {
  const presentation = analysisPresentation(dashboard, now);
  const agentProject = dashboard?.ai?.projects?.find(item => item.name === project?.name);
  if (presentation.canShowNarrative && agentProject?.summary) {
    return {
      label: `에이전트 통합 분석 · ${presentation.label}`,
      text: agentProject.summary,
      status: presentation.status,
    };
  }
  if (project?.notionSummary?.summary) {
    return {
      label: '업무현황 요약 DB',
      text: project.notionSummary.summary,
      status: presentation.status,
    };
  }
  return null;
}
