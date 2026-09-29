// Budget the final enriched packet, not only its initial rule projection.
export const REMOTE_PACKET_TARGET = 48_000;
export const REMOTE_PACKET_LIMIT = 50_000;

function refreshCoverage(project) {
  const rows = project.sourceEvidence || [];
  const coverage = project.evidenceCoverage;
  coverage.retainedRows = rows.length;
  coverage.omittedRows = coverage.originalRows - rows.length;
  for (const [source, counts] of Object.entries(coverage.bySource)) {
    counts.retained = rows.filter(row => row[1] === source).length;
  }
}

export function fitRemoteEvidenceBudget(packet, { strict = true } = {}) {
  const size = () => JSON.stringify(packet).length;
  packet.packetBudget ||= { originalChars: size(), targetChars: REMOTE_PACKET_TARGET, limitChars: REMOTE_PACKET_LIMIT };
  for (const project of packet.projects || []) {
    const rows = project.sourceEvidence || [];
    project.evidenceCoverage ||= {
      originalRows: rows.length, retainedRows: rows.length, omittedRows: 0,
      excerptCharsRemoved: 0, titleCharsRemoved: 0,
      bySource: Object.fromEntries([...new Set(rows.map(row => row[1]))].map(source => [source, {
        original: rows.filter(row => row[1] === source).length,
        retained: rows.filter(row => row[1] === source).length,
      }])),
    };
  }
  // Previous prose is optional context; it must never crowd out today's facts.
  if (size() > REMOTE_PACKET_TARGET) {
    for (const project of packet.projects || []) {
      if (project.previousSummary) {
        project.evidenceCoverage.previousSummaryOmitted = true;
        project.previousSummary = null;
      }
    }
  }
  // Repeated latest* slots can point to the same evidence. Keep every distinct
  // excerpt and all state fields; only exact repeated prose becomes a reference.
  if (size() > REMOTE_PACKET_TARGET) {
    for (const project of packet.projects || []) {
      const seen = new Map();
      for (const [key, value] of Object.entries(project.projectOperations || {})) {
        if (!key.startsWith('latest') || !value?.excerpt) continue;
        const identity = JSON.stringify([value.source, value.timestamp, value.url, value.excerpt, value.parentContext]);
        if (seen.has(identity)) {
          delete value.excerpt;
          delete value.parentContext;
          value.sameEvidenceAs = seen.get(identity);
          project.evidenceCoverage.operationDuplicatesReferenced = (project.evidenceCoverage.operationDuplicatesReferenced || 0) + 1;
        } else seen.set(identity, key);
      }
    }
  }
  // Operation prose is already present in sourceEvidence. Keep identifiers and
  // category hints here, plus the separately dated parent contexts, only once.
  if (size() > REMOTE_PACKET_TARGET) {
    for (const project of packet.projects || []) {
      for (const [key, value] of Object.entries(project.projectOperations || {})) {
        if (!key.startsWith('latest') || !value?.url) continue;
        if (!(project.sourceEvidence || []).some(row => row[5] === value.url && row[2] === value.timestamp)) continue;
        project.projectOperations[key] = Object.fromEntries(Object.entries(value)
          .filter(([field]) => ['source', 'timestamp', 'url', 'category', 'categories', 'channel'].includes(field)));
        project.evidenceCoverage.operationDetailsInSourceEvidence = true;
      }
    }
  }
  // Descriptions are schema annotations, not validation rules. The complete
  // validation contract stays intact; detailed semantics live in instructions.
  if (size() > REMOTE_PACKET_TARGET && packet.outputSchema) {
    let removed = 0;
    const compactSchema = value => {
      if (Array.isArray(value)) return value.map(compactSchema);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).filter(([key, val]) => {
        if (key !== 'description' || typeof val !== 'string') return true;
        removed += String(val).length;
        return false;
      }).map(([key, val]) => [key, compactSchema(val)]));
    };
    packet.outputSchema = compactSchema(packet.outputSchema);
    packet.packetBudget.schemaDescriptionCharsRemoved = (packet.packetBudget.schemaDescriptionCharsRemoved || 0) + removed;
  }
  if (size() > REMOTE_PACKET_TARGET) {
    for (const project of packet.projects || []) {
      for (const commit of project.gitEvidence || []) {
        const message = String(commit.message || '');
        if (message.length > 120) {
          project.evidenceCoverage.gitMessageCharsRemoved = (project.evidenceCoverage.gitMessageCharsRemoved || 0) + message.length - 120;
          commit.message = message.slice(0, 120);
        }
      }
    }
  }
  for (const limit of [180, 140, 100, 72, 40]) {
    if (size() <= REMOTE_PACKET_TARGET) break;
    for (const project of packet.projects || []) {
      for (const row of project.sourceEvidence || []) {
        // Project operations often have no specId; their distinct state/source
        // evidence must survive, including multiple segments of one meeting.
        const effectiveLimit = row[7] === 'project_operation' ? Math.max(limit, 180) : limit;
        const text = String(row[4] || '');
        const shortened = text.slice(0, effectiveLimit);
        project.evidenceCoverage.excerptCharsRemoved += text.length - shortened.length;
        row[4] = shortened;
      }
    }
  }
  if (size() > REMOTE_PACKET_TARGET) {
    for (const project of packet.projects || []) {
      for (const row of project.sourceEvidence || []) {
        const title = String(row[3] || '');
        row[3] = title.slice(0, 48);
        project.evidenceCoverage.titleCharsRemoved += title.length - row[3].length;
      }
    }
  }
  while (size() > REMOTE_PACKET_TARGET) {
    let removed = false;
    const projects = [...(packet.projects || [])].sort((a, b) => (b.sourceEvidence?.length || 0) - (a.sourceEvidence?.length || 0));
    for (const project of projects) {
      const rows = project.sourceEvidence || [];
      const counts = new Map();
      for (const row of rows) if (row[0] !== null && row[0] !== undefined) counts.set(row[0], (counts.get(row[0]) || 0) + 1);
      const index = rows.findLastIndex(row => row[7] !== 'project_operation' && row[0] != null && counts.get(row[0]) > 1);
      if (index < 0) continue;
      rows.splice(index, 1);
      refreshCoverage(project);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  for (const project of packet.projects || []) refreshCoverage(project);
  packet.packetBudget.status = 'within_budget';
  packet.packetBudget.finalChars = size();
  for (let n = 0; n < 3; n++) packet.packetBudget.finalChars = size();
  if (size() > REMOTE_PACKET_LIMIT) {
    packet.packetBudget.status = strict ? 'overflow' : 'requires_sharding';
    packet.packetBudget.finalChars = size();
    if (strict) throw new Error(`원격 규칙 입력 예산 초과: ${size()}자 > ${REMOTE_PACKET_LIMIT}자. 필수 규칙·스펙·변경 사실 및 프로젝트 운영 근거를 보존했으므로 게시를 중단합니다.`);
  }
  return packet;
}
