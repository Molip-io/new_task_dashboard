#!/usr/bin/env node
// Usage: node tools/agent-routine/save-analysis.mjs --analysis FILE [--input FILE] [--dry-run]
// --dry-run only validates the analysis against the day's input and schema.
// Otherwise it re-checks the input generation, saves, and reads the pages back.
import fs from 'node:fs';
import { loadConfig, loadEnv } from '../../lib/env.mjs';
import { analysisErrors, saveAnalysis } from '../../lib/agent-routine.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

loadEnv();
try {
  const analysisFile = option('--analysis');
  if (!analysisFile) throw new Error('--analysis 파일 경로가 필요합니다.');
  const inputFile = option('--input', '/tmp/molip-agent/input.json');
  const analysis = readJson(analysisFile);
  const input = readJson(inputFile);
  const provenance = readJson(`${inputFile}.provenance.json`);
  const { runId, readAt: _readAt, ...inputProvenance } = provenance;

  if (args.includes('--dry-run')) {
    const errors = analysisErrors({ analysis, input, runId });
    console.log(JSON.stringify({ status: errors.length ? 'invalid' : 'valid', errors }, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } else {
    if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 환경변수가 없습니다.');
    const result = await saveAnalysis({
      databaseId: loadConfig().notion.summaryDbId, runId, analysis, input, provenance: inputProvenance,
    });
    console.log(JSON.stringify({ status: 'saved', ...result }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', message: error.message }));
  process.exitCode = 1;
}
