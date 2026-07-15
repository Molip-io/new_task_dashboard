// 대시보드 서버: 정적 파일 + API + 일일 스케줄러
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadEnv, loadConfig, ROOT } from './lib/env.mjs';

loadEnv();
const config = loadConfig();
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

let collecting = null; // 실행 중인 수집 프로세스

function runCollect() {
  if (collecting) return false;
  collecting = spawn(process.execPath, [path.join(ROOT, 'collect.mjs')], { stdio: 'inherit' });
  collecting.on('close', () => { collecting = null; });
  return true;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch { return null; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  if (url.pathname === '/api/dashboard') {
    const d = readJson('dashboard.json');
    if (d) return send(200, d);
    const sample = readJson('dashboard.sample.json');
    if (sample) return send(200, { ...sample, sample: true });
    return send(404, { error: 'no_data', message: '아직 수집된 데이터가 없습니다. 새로고침을 눌러 수집을 시작하세요.' });
  }
  if (url.pathname === '/api/status') {
    return send(200, { collecting: !!collecting, last: readJson('collect-status.json') });
  }
  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    const started = runCollect();
    return send(started ? 202 : 409, { started });
  }

  // 정적 파일
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) return send(404, { error: 'not_found' });
  send(200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
});

// 매일 config.scheduleTime 에 자동 수집
let lastRunDay = null;
setInterval(() => {
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const day = now.toISOString().slice(0, 10);
  if (hhmm === config.scheduleTime && lastRunDay !== day) {
    lastRunDay = day;
    console.log(`⏰ ${config.scheduleTime} 정기 수집 시작`);
    runCollect();
  }
}, 30_000);

server.listen(config.port, () => {
  console.log(`업무현황 대시보드: http://localhost:${config.port}`);
  console.log(`정기 수집: 매일 ${config.scheduleTime} (서버 실행 중일 때)`);
});
