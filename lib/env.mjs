import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import defaultConfig from '../config.json' with { type: 'json' };

const SITE_RUNTIME = typeof __SITES_WORKER__ !== 'undefined' && __SITES_WORKER__;
export const ROOT = SITE_RUNTIME
  ? '/app'
  : path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function loadEnv() {
  if (SITE_RUNTIME) return;
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function loadConfig() {
  const config = structuredClone(defaultConfig);
  if (process.env.DASHBOARD_URL) config.dashboardUrl = process.env.DASHBOARD_URL;
  return config;
}
