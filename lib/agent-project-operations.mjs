import { fitRemoteEvidenceBudget } from './agent-packet-budget.mjs';

const CLOSED = new Set(['완료', '일시 정지', '정지', '중단']);

function operationRows(project) {
  return (project.projectOperations?.evidence || []).slice(0, 12).map(item => [
    null,
    item.source || 'slack',
    item.timestamp || null,
    item.title || '프로젝트 운영 상태',
    String(item.excerpt || '').slice(0, 180),
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
    'PROJECT_BRIEFING_OUTCOMES_V2: buildRelease는 현재 마지막으로 전달·배포된 빌드 → 다음으로 준비 중인 빌드 → 다음 단계/남은 검증을 2~3문장으로 종합하고 원문 나열을 금지한다. 먼저 각 상태를 별도로 판정한 뒤 요약하며, 현재 빌드와 다음 빌드를 섞거나 한쪽을 다른 쪽으로 덮지 않는다. 일반 작업 요청·아트 실험은 currentProgress로, 고객 피드백 일일 리포트는 빌드·출시·성과 데이터로 분류하지 않는다. data는 현재 전달·배포 빌드에 연결된 D1·RV·ARPDAU·A/B 등 성과 지표이며 sourceHealth/수집 정상 여부/갱신 시각/작업 수가 아니다. 빌드·플랫폼·국가·관찰 기간·코호트/실험군을 식별하고 수치·단위·분모·비교 기준과 해석을 짧게 쓴다. D1은 설치 코호트 및 관찰 완료 여부를, RV는 총 횟수/인당/DAU당 등 원문 단위를 구분한다. A/B는 실험·주요 지표·그룹별 결과·표본/판정 근거를 확인하며 단순 수치 우세를 승리 확정으로 바꾸지 않는다. 지표 일부만 확인되면 그 범위와 제한을 쓰고 해당 빌드에 연결된 근거가 전혀 없으면 data=null이다. 과거 빌드나 버전 불명 지표를 현재 빌드 성과로 전용하지 않는다. 정보 부족은 confidenceLimits에, 실제 실행 차단은 blockers에, 근거가 있는 다음 행동은 nextActions에 둔다. 새 분석에서는 confirmationRequired 내용을 작성하지 않는다. 당일 outputSchema가 레거시 필드를 required로 요구하면 []만 넣고 UI에는 노출하지 않는다.',
    'PROJECT_BRIEFING_TEMPORAL_V2: 기준일은 실행 시각의 Asia/Seoul 날짜, packet.generatedAt은 자료 수집 시각이다. 현재 전달/배포 빌드와 다음 준비 빌드를 분리하고 프로젝트·스프린트·빌드 버전·플랫폼·전달 대상별로 후속 근거를 대조한다. 스프린트 번호와 빌드 버전은 숫자가 같아도 동일 대상이 아니다. 예정·준비·전달·QA·심사·출시를 구분하며 예정일 경과로 완료/지연을 추정하지 않는다. 오늘/내일은 원문 날짜의 절대 날짜로 표현한다. parentContext는 부모 작성일의 과거 맥락이며 답글 시각으로 갱신하지 않는다. 지난 계획에 후속 확인이 없으면 이행 여부를 미확인으로 두고 confidenceLimits에 기록한다. 최근 7일에 없더라도 마지막 확인된 전달 상태는 확인 날짜와 함께 유지하고 다음 준비 빌드로 덮지 않는다. buildRelease는 마지막 확인 상태 → 다음 빌드 준비 → 다음 단계 순서로 쓰고 각 상태에 날짜와 evidence 링크를 연결한다. 오래된 분석/입력, 잘린 발췌, 충돌은 confidenceLimits에 명시한다. 기준일보다 오래된 예정 문구를 현재 완료 사실로 출력하면 검증 실패이며 다시 작성한다. 이는 예시이며 실제 상태를 상수 삽입하지 않는다.',

    "새 분석에서는 outputSchema의 projects[].projectBriefing을 작성한다. project.goal·milestones·specCatalog 전체·sourceEvidence 전체(recent_execution/persistent_context/project_operation)·허용 meetingReferences·gitEvidence를 종합해 currentProgress(프로젝트 전반의 진행), buildRelease, data를 구분한다. 관련 직접 근거만 쓰며 Slack 최신 발췌 복사나 KPI 나열을 통합 요약으로 쓰지 않는다. 버전·플랫폼·관찰 기간이 다른 개발/QA/배포/데이터는 분리한다. buildRelease/data 미확인은 null, 제한은 confidenceLimits, 실제 실행 영향이 있는 병목만 기존 blockers에 기록한다. nextActions.kind는 합의 근거가 있으면 agreed, AI가 제안하는 확인 행동이면 suggested_check다. 사용한 출처만 evidence로 연결하고 출처 미수집을 활동 없음으로 단정하지 않는다. summary는 currentProgress의 1~2문장 압축본으로 유지하며 출력 스키마에 없는 필드는 생성하지 않는다. 레거시 confirmationRequired가 입력에 있어도 내용을 복사하지 않으며, 해당 필드가 required이면 []만 넣는다.",
    'specCatalog에는 상위 작업이 완료되지 않았다면 등록된 하위 작업항목이 모두 완료여도 남는다. activeTaskCount=0, completionRate=100인 활성 상위 작업은 상위 완료 처리 누락 또는 추가 하위 작업 미등록 여부를 확인한다.',
    'sourceEvidence의 specId가 null이고 evidenceRole이 project_operation이면 특정 스펙에 억지로 연결하지 말고 프로젝트 전체의 빌드·QA/리뷰·배포/출시·데이터 상태 근거로 사용한다. 예정·홀드·완료·배포 등 메시지에 직접 명시된 범위만 상태로 기록한다.',
  ];
  for (const constraint of constraints) if (!packet.constraints.includes(constraint)) packet.constraints.push(constraint);

  for (const projectPacket of packet.projects || []) {
    const project = (dashboard.projects || []).find(item => item.name === projectPacket.name);
    if (!project) continue;
    projectPacket.specCatalog = specCatalog(project, projectPacket.sprintRequired !== false);
    const opsRows = operationRows(project);
    const existing = new Set((projectPacket.sourceEvidence || []).map(row => `${row[0]}|${row[5] || ''}|${row[2] || ''}|${row[4] || ''}`));
    projectPacket.sourceEvidence = [...opsRows.filter(row => !existing.has(`${row[0]}|${row[5] || ''}|${row[2] || ''}|${row[4] || ''}`)), ...(projectPacket.sourceEvidence || [])];
    projectPacket.projectOperations = project.projectOperations ? {
      latestLifecycleSignal: project.projectOperations.latestLifecycleSignal || null,
      latestBuild: project.projectOperations.latestBuild || null,
      latestQa: project.projectOperations.latestQa || null,
      latestRelease: project.projectOperations.latestRelease || null,
      latestData: project.projectOperations.latestData || null,
      evidenceCount: project.projectOperations.evidenceCount || 0,
      threadContexts: (project.projectOperations.evidence || [])
        .filter(item => item.parentContext)
        .map(item => ({ url: item.url, replyAt: item.timestamp, parent: item.parentContext })),
    } : null;
  }
  return fitRemoteEvidenceBudget(packet);
}
