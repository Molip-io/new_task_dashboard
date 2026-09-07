"""Browser smoke tests using synthetic data only; production APIs are never called.
Run with Python + playwright==1.57.0 and an installed Chromium/Google Chrome.
"""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json, shutil, threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'validation' / 'browser'
OUT.mkdir(parents=True, exist_ok=True)
projects = [
    {'name': 'Project A', 'notionId': 'a', 'currentSprints': ['Sprint3'], 'sprintRequired': True},
    {'name': 'Project B', 'notionId': 'b', 'currentSprints': ['Sprint60'], 'sprintRequired': True},
    {'name': 'Operations', 'notionId': 'ops', 'currentSprints': [], 'sprintRequired': False},
]
tasks = []
def task(key, project, sprint, status, guide=False, late=False):
    issues = []
    if guide:
        issues.append({'id': 'g-' + key, 'type': 'MISSING_BRANCH', 'category': 'guide', 'severity': 'error', 'message': 'Branch missing', 'label': 'Branch missing', 'workItemId': key, 'project': project['name']})
    if late:
        issues.append({'id': 'l-' + key, 'type': 'OVERDUE', 'category': 'schedule', 'severity': 'warning', 'message': 'Overdue', 'label': 'Overdue', 'workItemId': key, 'project': project['name']})
    tasks.append({'id': key, 'title': key, 'project': project['name'], 'sprint': sprint, 'status': status, 'itemLevel': 'child', 'team': 'Development', 'assignees': ['Test Owner'], 'specId': project['notionId'] + '-spec', 'spec': 'Test Spec', 'start': '2026-09-01', 'due': '2026-09-04' if late else '2026-09-12', 'overdueDays': 3 if late else 0, 'issues': issues, 'url': 'https://example.invalid/work/' + key})
a, b, ops = projects
task('overdue-and-guide', a, 'Sprint3', '진행 중', True, True)
task('ready', a, 'Sprint3', '시작 전')
task('future-running', a, 'Sprint4', '진행 중', True)
task('future-ready', a, 'Sprint4', '시작 전', True)
task('outside-overdue', a, 'Sprint2', '진행 중', False, True)
task('in-review', a, 'Sprint3', '검토중')
task('b-running', b, 'Sprint60', '진행 중', True)
task('ops-running', ops, None, '진행 중', True)
for project in projects:
    project['config'] = {key: project[key] for key in ['notionId', 'currentSprints', 'sprintRequired']}
    project['stats'] = {}
    project['specs'] = [{'id': project['notionId'] + '-spec', 'title': 'Test Spec', 'status': '진행 중', 'sprint': next(iter(project['currentSprints']), None), 'tasks': [t for t in tasks if t['project'] == project['name']], 'owners': ['Test Owner']}]
fixture = {'sample': False, 'generatedAt': '2026-09-07T10:00:00+09:00', 'projects': projects, 'workItems': tasks, 'validationIssues': [i for t in tasks for i in t['issues']], 'metrics': {}, 'deltas': [], 'workload': [], 'notionSetup': {'ready': True, 'databases': []}, 'git': {'repositories': [], 'commits': [], 'errors': []}, 'errors': [], 'sourceHealth': {'sources': [{'id': 'notion', 'status': 'ok'}, {'id': 'agent-analysis', 'status': 'ok', 'analysisStatus': 'success'}]}, 'ai': {'analysisStatus': 'success', 'generatedAt': '2026-09-07T10:05:00+09:00', 'overall': {'summary': 'Synthetic fixture: not production company data.', 'topRisks': []}, 'projects': []}, 'sprintSettings': {'writable': True, 'projects': {}, 'history': [], 'revision': 'initial', 'pendingInput': False, 'pendingAnalysis': False}}
checks, errors, writes = [], [], []
def check(name, condition, detail=None):
    checks.append({'name': name, 'passed': bool(condition), 'detail': detail})
    assert condition, (name, detail)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT / 'public')))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as pw:
        executable = shutil.which('google-chrome') or shutil.which('chromium')
        assert executable, 'Install Chromium or Google Chrome'
        browser = pw.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1050}, permissions=['clipboard-read', 'clipboard-write'], color_scheme='light')
        def api(route):
            req = route.request
            if req.url.endswith('/api/dashboard'):
                return route.fulfill(json=fixture)
            if req.url.endswith('/api/status'):
                return route.fulfill(json={'collecting': False, 'last': {'state': 'done'}})
            if req.url.endswith('/api/sprint-settings'):
                body = req.post_data_json
                writes.append({'path': 'settings', 'body': body})
                record = {'projectId': body['projectId'], 'projectName': 'Project A', 'sprints': body['sprints'], 'previousSprints': ['Sprint3'], 'changedAt': '2026-09-07T10:10:00+09:00', 'revision': 'r1'}
                fixture['sprintSettings'].update({'projects': {'a': record}, 'history': [record], 'revision': 'r1', 'pendingAnalysis': True})
                fixture['projects'][0]['currentSprints'] = body['sprints']
                fixture['projects'][0]['config']['currentSprints'] = body['sprints']
                fixture['ai']['analysisStatus'] = 'stale'
                return route.fulfill(json={'settings': fixture['sprintSettings'], 'changed': True})
            if req.url.endswith('/api/refresh'):
                writes.append({'path': 'refresh'})
                return route.fulfill(json={'started': True, 'completed': True, 'dashboard': fixture})
            return route.fulfill(status=404, json={})
        context.route('**/api/**', api)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '/?tab=briefing')
        page.locator('sprint-work-overview .kpi').first.wait_for()
        def values():
            return [int(x) for x in page.locator('sprint-work-overview .kpi .value').all_text_contents()]
        def box(value):
            return page.locator(f'input[data-scope-project="a"][value="{value}"]')
        check('Baseline five scoped KPIs', values() == [3, 3, 1, 2, 1], values())
        headings = page.locator('#tab-briefing h3').all_text_contents()
        check('Three briefing sections are ordered', [h[:2] for h in headings[:3]] == ['1.', '2.', '3.'], headings)
        page.locator('.scope-picker>summary').click()
        box('Sprint4').check()
        check('Multiple sprint selection recomputes five KPIs', values() == [3, 4, 1, 4, 2], values())
        check('Preview does not write shared settings', not writes)
        page.locator('button[data-scope-detail="guide"]').click()
        titles = page.locator('.scope-table tbody td:first-child a').all_text_contents()
        check('Guide list matches KPI without overdue duplicate', len(titles) == 4 and 'overdue-and-guide' not in titles, titles)
        box('Sprint3').uncheck()
        box('Sprint4').uncheck()
        check('Empty selection preserves other projects only', values() == [2, 2, 0, 2, 0], values())
        page.locator('button[data-scope-detail="outside"]').click()
        check('Outside-scope overdue remains accessible', page.locator('.scope-table tbody tr').count() == 2)
        page.locator('[data-scope-reset]').click()
        box('Sprint4').check()
        page.locator('[data-scope-save="a"]').click()
        check('Administrator input is masked', page.locator('dialog').evaluate('(e)=>e.open') and page.locator('dialog input').get_attribute('type') == 'password')
        page.locator('dialog input').fill('TEST-ONLY-KEY-' + 'x' * 32)
        page.locator('[data-scope-cancel]').click()
        check('Cancel clears key without saving', not writes and page.locator('dialog input').input_value() == '')
        page.locator('[data-scope-save="a"]').click()
        page.locator('dialog input').fill('TEST-ONLY-KEY-' + 'x' * 32)
        page.locator('dialog button[type="submit"]').click()
        page.wait_for_timeout(600)
        check('Shared save posts selected array and refreshes', len(writes) == 2 and writes[0]['body']['projectId'] == 'a' and set(writes[0]['body']['sprints']) == {'Sprint3', 'Sprint4'} and writes[1]['path'] == 'refresh', writes)
        check('Previous analysis marked stale', '갱신 필요' in page.locator('#tab-briefing h3').first.inner_text())
        stored = page.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)')
        check('Admin key not persisted in browser storage', 'TEST-ONLY-KEY-' not in stored)
        page.locator('button[data-scope-detail="guide"]').click()
        page.locator('[data-scope-copy]').click()
        page.wait_for_timeout(100)
        copied = page.evaluate('navigator.clipboard.readText()')
        link = copied.splitlines()[-1].split(': ', 1)[-1]
        check('Copy shares scoped data and URL', 'sprintView=' in link and 'overdue-and-guide' not in copied)
        second = context.new_page()
        second.on('pageerror', lambda e: errors.append(str(e)))
        second.goto(link)
        second.locator('sprint-work-overview .kpi').first.wait_for()
        check('Shared URL restores selection and detail', second.locator('input[data-scope-project="a"]:checked').count() == 2 and second.locator('.scope-table tbody tr').count() == 4)
        second.close()
        page.screenshot(path=str(OUT / 'desktop.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(100)
        size = page.evaluate('({w:innerWidth,body:document.documentElement.scrollWidth})')
        check('Mobile has no page-level horizontal overflow', size['body'] <= size['w'], size)
        page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
        check('No browser JavaScript errors', not errors, errors)
        browser.close()
finally:
    server.shutdown()
    report = {'checks': checks, 'passed': sum(row['passed'] for row in checks), 'failed': sum(not row['passed'] for row in checks), 'scope': 'Real Chromium application with synthetic data and mocked API writes; not a production integration test'}
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
