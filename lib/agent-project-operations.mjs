import { fitRemoteEvidenceBudget } from './agent-packet-budget.mjs';

const CLOSED = new Set(['완료', '일시 정지', '정지', '중단']);

function operationRows(project) {
  return (project.projectOperations?.evidence || []).map(item => [
    null,
    item.source || 'slack',
    item.timestamp || null,
    item.title || '프로젝트 운영 상태',
    String(item.excerpt || ''),
    item.url || null,
    item.attentionType || null,
    'project_operation',
  ]);
}

function specCatalog(project, sprintRequired) {
  return (project.specs || [])
    .filter(spec => !CLOSED.has(spec.status) || (spec.tasks || []).some(task => !CLOSED.has(task.status)))
    .map(spec => [
      spec.id || null,
      spec.title || '',
      sprintRequired ? spec.sprint || null : '해당 없음',
      spec.status || null,
      (spec.tasks || []).filter(task => !CLOSED.has(task.status)).length,
      spec.childStats?.completionRate || 0,
      (spec.tasks || []).filter(task => task.overdueDays > 0).length,
    ]);
}

export function enrichAgentPacketWithProjectOperations(packet, dashboard) {
  const constraints = [
    'PROJECT_BRIEFING_OUTCOMES_V2: 모든 프로젝트에 projectBriefing을 작성한다. goal·milestones·specCatalog·sourceEvidence 전체·meetingReferences·gitEvidence를 종합해 currentProgress는 실제 산출물→진척→남은 일→다음 단계를 설명한다. summary는 그 1~2문장 압축본, overall.summary는 회사 흐름과 큰 위험의 종합이다. 숫자 나열·원문 복사는 금지한다.',
    'PROJECT_BRIEFING_TEMPORAL_V2: buildRelease는 마지막 확인된 전달·배포 빌드→다음 준비 빌드→다음 검증을 2~3문장으로 쓴다. 스프린트·버전·플랫폼·대상과 예정·내부 테스트·QA·전달·심사·배포를 구분한다. 최신 APK를 출시로 간주하지 않는다. 오늘/내일은 원문 날짜 기준이며 parentContext는 부모 작성일의 맥락이다. 최근 7일 이전의 마지막 전달 근거도 보존하고 이후 취소·변경을 대조한다. 배포 취소를 전체 롤백으로 추정하지 않는다. 과거 예정일 경과로 완료·지연을 단정하지 않는다.',
    'data는 현재 빌드의 D1·D7·RV·ARPDAU·퍼널·A/B 성과만 담는다. 빌드·플랫폼·국가·기간·코호트/실험군·값·단위·분모·비교 기준을 확인한다. D1 관찰 완료와 RV 집계 단위를 보존하며 단순 수치 우세를 A/B 승리로 만들지 않는다. 로그 오류·수집 상태·QA·고객 피드백 수는 성과가 아니다. 성과 근거가 없으면 null, 일부 조건 누락은 confidenceLimits다.',
    'project_operation은 specId=null인 프로젝트 운영 후보 근거이며 확정 상태가 아니다. latest*는 최신 언급의 링크다. 실제 미해결 실행 차단만 blockers, 합의 행동은 nextActions.kind=agreed, AI 제안은 suggested_check다. confirmationRequired는 레거시 required일 때만 []이다. evidenceCoverage의 생략·잘림은 원문으로 확인하거나 제한에 기록하고 수집 성공을 분석 완료로 간주하지 않는다.',
    'specCatalog에는 미완료 상위 작업의 하위항목이 모두 완료여도 남는다. activeTaskCount=0, completionRate=100이면 상위 완료 처리 누락 또는 추가 작업 미등록 여부를 확인한다. 활성 집계에서 제외한 완료 기록도 마지막 전달·성과·해결 사실의 역사적 근거로 사용할 수 있다. 공용 스프린트 unset은 관계 지표만 미평가이며 프로젝트 브리핑은 계속한다.',
  ];
  for (const constraint of constraints) if (!packet.constraints.includes(constraint)) packet.constraints.push(constraint);

  for (const projectPacket of packet.projects || []) {
    const project = (dashboard.projects || []).find(item => item.name === projectPacket.name);
    if (!project) continue;
    projectPacket.specCatalog = specCatalog(project, projectPacket.sprintRequired !== false);
    const opsRows = operationRows(project);
    const existing = new Set((projectPacket.sourceEvidence || []).map(row => `${row[0]}|${row[5] || ''}|${row[2] || ''}|${row[4] || ''}`));
    const beforeRows = projectPacket.sourceEvidence || [];
    projectPacket.sourceEvidence = [...opsRows.filter(row => !existing.has(`${row[0]}|${row[5] || ''}|${row[2] || ''}|${row[4] || ''}`)), ...(projectPacket.sourceEvidence || [])];
    if (projectPacket.evidenceCoverage) {
      const added = projectPacket.sourceEvidence.filter(row => !beforeRows.includes(row));
      projectPacket.evidenceCoverage.originalRows += added.length;
      for (const row of added) {
        const counts = projectPacket.evidenceCoverage.bySource[row[1]] ||= { original: 0, retained: 0 };
        counts.original += 1;
      }
    }
    projectPacket.projectOperations = project.projectOperations ? structuredClone({
      latestLifecycleSignal: project.projectOperations.latestLifecycleSignal || null,
      latestBuild: project.projectOperations.latestBuild || null,
      latestQa: project.projectOperations.latestQa || null,
      latestRelease: project.projectOperations.latestRelease || null,
      latestData: project.projectOperations.latestData || null,
      evidenceCount: project.projectOperations.evidenceCount || 0,
      threadContexts: (project.projectOperations.evidence || [])
        .filter(item => item.parentContext)
        .map(item => ({ url: item.url, replyAt: item.timestamp, parent: item.parentContext })),
    }) : null;
  }
  return fitRemoteEvidenceBudget(packet, { strict: false });
}
