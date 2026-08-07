const REMOTE_PACKET_TARGET = 48_000;

export function fitRemoteEvidenceBudget(packet) {
  const packetSize = () => JSON.stringify(packet).length;
  if (packetSize() <= REMOTE_PACKET_TARGET) return packet;

  for (const limit of [140, 100, 72, 40]) {
    for (const project of packet.projects) {
      for (const row of project.sourceEvidence || []) row[4] = String(row[4] || '').slice(0, limit);
    }
    if (packetSize() <= REMOTE_PACKET_TARGET) return packet;
  }

  for (const project of packet.projects) {
    for (const row of project.sourceEvidence || []) row[3] = String(row[3] || '').slice(0, 48);
  }
  while (packetSize() > REMOTE_PACKET_TARGET) {
    let removed = false;
    const projects = [...packet.projects]
      .sort((left, right) => (right.sourceEvidence?.length || 0) - (left.sourceEvidence?.length || 0));
    for (const project of projects) {
      const counts = new Map((project.sourceEvidence || []).map(row => [row[0], 0]));
      for (const row of project.sourceEvidence || []) counts.set(row[0], (counts.get(row[0]) || 0) + 1);
      const index = (project.sourceEvidence || []).findLastIndex(row => (counts.get(row[0]) || 0) > 1);
      if (index < 0) continue;
      project.sourceEvidence.splice(index, 1);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return packet;
}
