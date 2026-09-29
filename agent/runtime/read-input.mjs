#!/usr/bin/env node
// Usage: node agent/runtime/read-input.mjs [--run-id YYYY-MM-DD-morning] [--out FILE]
// Exit codes: 0 input ready, 2 input page missing, 3 still publishing, 1 invalid or error.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadEnv } from '../../shared/env.mjs';
import { AgentInputError, morningRunId, readAgentInput } from './agent-routine.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

loadEnv();
const runId = option('--run-id', morningRunId());
const out = option('--out', '/tmp/molip-agent/input.json');
const exitCodes = { not_available: 2, not_ready: 3, invalid: 1 };

try {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 환경변수가 없습니다.');
  const { input, provenance } = await readAgentInput({ databaseId: loadConfig().notion.summaryDbId, runId });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(input, null, 2));
  fs.writeFileSync(`${out}.provenance.json`, JSON.stringify({ runId, readAt: new Date().toISOString(), ...provenance }, null, 2));
  console.log(JSON.stringify({
    status: 'ready', runId, out, format: provenance.format, generationId: provenance.generationId || null,
    partCount: provenance.parts.length, generatedAt: input.generatedAt,
    projects: input.projects.map(project => ({
      name: project.name,
      activeSpecs: (project.specCatalog || []).length,
      ruleAuditItems: (project.ruleAuditItems || []).length,
      sourceEvidence: (project.sourceEvidence || []).length,
    })),
  }, null, 2));
} catch (error) {
  const code = error instanceof AgentInputError ? error.code : 'error';
  console.error(JSON.stringify({ status: code, runId, message: error.message }));
  process.exitCode = exitCodes[code] || 1;
}
