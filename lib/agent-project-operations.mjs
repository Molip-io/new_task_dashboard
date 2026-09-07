import { fitRemoteEvidenceBudget } from './agent-packet-budget.mjs';

const CLOSED = new Set(['완료', '일시 정지', '정지', '중단']);

function operationRows(project) {
  return (project.projectOperations?.evidence || []).slice(0, 4).map(item => [
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
    } : null;
  }
  return fitRemoteEvidenceBudget(packet);
}
