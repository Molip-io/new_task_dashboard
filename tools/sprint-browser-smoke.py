"""Real Chromium regression checks with synthetic dashboard data and mocked writes."""
import json
import shutil
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'validation' / 'browser'
OUT.mkdir(parents=True, exist_ok=True)
projects = [
    {'name': 'Project A', 'notionId': 'a', 'currentSprints': ['Sprint3'], 'sprintRequired': True},
    {'name': 'Project B', 'notionId': 'b', 'currentSprints': ['Sprint3'], 'sprintRequired': True},
    {'name': 'Operations', 'notionId': 'o', 'currentSprints': [], 'sprintRequired': False},
]
tasks = []
def task(key, project, sprint, status, guide=False, late=False):
    issues = []
    if guide:
        issues.append({'id': key + '-guide', 'type': 'MISSING_BRANCH', 'category': 'guide', 'severity': 'error', 'message': 'Missing branch', 'label': 'Missing branch', 'workItemId': key, 'project': project['name']})
    if late:
        issues.append({'id': key + '-late', 'type': 'OVERDUE', 'category': 'schedule', 'severity': 'warning', 'message': 'Overdue', 'label': 'Overdue', 'workItemId': key, 'project': project['name']})
    tasks.append({'id': key, 'title': key, 'project': project['name'], 'sprint': sprint, 'status': status, 'itemLevel': 'child', 'team': 'Development', 'assignees': ['Test Owner'], 'specId': project['notionId'] + '-spec', 'spec': 'Test Spec', 'start': '2026-09-01', 'due': '2026-09-04' if late else '2026-09-12', 'overdueDays': 3 if late else 0, 'issues': issues, 'url': 'https://example.invalid/work/' + key})
a, b, ops = projects
task('overdue-and-guide', a, 'Sprint3', '진행 중', True, True)
task('ready', a, 'Sprint3', '시작 전')
task('future-running', a, 'Sprint4', '진행 중', True)
task('future-ready', a, 'Sprint4', '시작 전', True)
task('outside-overdue', a, 'Sprint2', '진행 중', False, True)
task('in-review', a, 'Sprint3', '검토중')
task('b-running', b, 'Sprint3', '진행 중', True)
task('ops-running', ops, None, '진행 중', True)
for project in projects:
    project['config'] = {key: project[key] for key in ['notionId', 'currentSprints', 'sprintRequired']}
    project['stats'] = {}
    project['specs'] = [{'id': project['notionId'] + '-spec', 'title': 'Test Spec', 'status': '진행 중', 'sprint': next(iter(project['currentSprints']), None), 'tasks': [t for t in tasks if t['project'] == project['name']], 'owners': ['Test Owner']}]
setting = {'kind':'MOLIP_GLOBAL_SPRINT_SETTINGS_V2','mode':'selected','input':'3','sprints':['Sprint3'],'changedAt':'2026-09-07T10:00:00+09:00','revision':'initial'}
scope = {'mode':'selected','input':'3','sprints':['Sprint3'],'configured':True,'source':'dashboard'}
fixture = {'sample': False, 'generatedAt': '2026-09-07T10:00:00+09:00', 'projects': projects, 'workItems': tasks, 'validationIssues': [i for t in tasks for i in t['issues']], 'metrics': {}, 'deltas': [], 'workload': [], 'notionSetup': {'ready': True, 'databases': []}, 'git': {'repositories': [], 'commits': [], 'errors': []}, 'errors': [], 'sourceHealth': {'sources': [{'id': 'notion', 'status': 'ok'}, {'id': 'agent-analysis', 'status': 'ok', 'analysisStatus': 'success'}]}, 'ai': {'analysisStatus': 'success', 'generatedAt': '2026-09-07T10:05:00+09:00', 'overall': {'summary': 'Synthetic fixture: not production company data.', 'topRisks': []}, 'projects': []}, 'sprintScope': {**scope, 'revision':'initial','signature':'[selected,sprint3]'}, 'sprintSettings': {'writable': True, 'setting': setting, 'scope': scope, 'history': [], 'revision': 'initial', 'pendingInput': False, 'pendingAnalysis': False}}
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
                saved = {'kind':'MOLIP_GLOBAL_SPRINT_SETTINGS_V2','mode':'selected','input':body['input'],'sprints':['Sprint3','Sprint4'],'previousInput':'3','changedAt':'2026-09-07T10:10:00+09:00','revision':'r1'}
                fixture['sprintSettings'].update({'setting': saved, 'scope': {'mode':'selected','input':body['input'],'sprints':['Sprint3','Sprint4'],'configured':True,'source':'dashboard'}, 'history': [saved], 'revision': 'r1', 'pendingAnalysis': True})
                fixture['sprintScope'].update({'mode':'selected','input':body['input'],'sprints':['Sprint3','Sprint4'],'revision':'r1'})
                for project in fixture['projects'][:2]:
                    project['currentSprints'] = ['Sprint3','Sprint4']
                    project['config']['currentSprints'] = ['Sprint3','Sprint4']
                fixture['ai']['analysisStatus'] = 'stale'
                return route.fulfill(json={'settings': {'setting':saved,'history':[saved],'revision':'r1','legacyRecordCount':0}, 'changed': True})
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
        sprint = page.locator('[data-scope-sprint]')
        check('Baseline five scoped KPIs', values() == [3, 3, 1, 2, 1], values())
        headings = page.locator('#tab-briefing h3').all_text_contents()
        check('Analysis changes project briefing and sprint overview are ordered', len(headings) >= 4 and headings[0].startswith('1.') and headings[1].startswith('2.') and '프로젝트 현황' in headings[2] and headings[3].startswith('3.'), headings)
        sprint.fill('3,4'); sprint.press('Enter')
        check('Global multi-sprint input recomputes five KPIs', values() == [3, 4, 1, 4, 2], values())
        check('Preview does not write shared settings', not writes)
        page.locator('button[data-scope-detail="guide"]').click()
        titles = page.locator('.scope-table tbody td:first-child a').all_text_contents()
        check('Guide list matches KPI without overdue duplicate', len(titles) == 4 and 'overdue-and-guide' not in titles, titles)
        sprint = page.locator('[data-scope-sprint]'); sprint.fill(''); sprint.press('Enter')
        check('Blank input is explicitly unconfigured', '미계산' in page.locator('sprint-work-overview').inner_text())
        sprint = page.locator('[data-scope-sprint]'); sprint.fill('전체'); sprint.press('Enter')
        check('ALL includes outside sprint overdue', values()[2] == 2, values())
        page.locator('[data-scope-reset]').click()
        sprint = page.locator('[data-scope-sprint]'); sprint.fill('3,4'); sprint.press('Enter')
        page.locator('[data-scope-save]').click()
        check('Administrator input is masked', page.locator('dialog').evaluate('(e)=>e.open') and page.locator('dialog input').get_attribute('type') == 'password')
        page.locator('dialog input').fill('TEST-ONLY-KEY-' + 'x' * 32)
        page.locator('[data-scope-cancel]').click()
        check('Cancel clears key without saving', not writes and page.locator('dialog input').input_value() == '')
        page.locator('[data-scope-save]').click()
        page.locator('dialog input').fill('TEST-ONLY-KEY-' + 'x' * 32)
        page.locator('dialog button[type="submit"]').click()
        page.wait_for_timeout(600)
        check('Shared save posts one global input and refreshes', len(writes) == 2 and writes[0]['body']['input'] == '3,4' and 'projectId' not in writes[0]['body'] and writes[1]['path'] == 'refresh', writes)
        check('Previous analysis marked stale', '갱신 필요' in page.locator('#tab-briefing h3').first.inner_text())
        stored = page.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)')
        check('Admin key not persisted in browser storage', 'TEST-ONLY-KEY-' not in stored)
        if page.locator('[data-scope-copy]').count() == 0:
            page.locator('button[data-scope-detail="guide"]').click()
        page.locator('[data-scope-copy]').click()
        page.wait_for_timeout(100)
        copied = page.evaluate('navigator.clipboard.readText()')
        link = copied.splitlines()[-1].split(': ', 1)[-1]
        check('Copy shares global scope and URL', 'sprintView=3%2C4' in link and 'overdue-and-guide' not in copied)
        second = context.new_page()
        second.on('pageerror', lambda e: errors.append(str(e)))
        second.goto(link)
        second.locator('sprint-work-overview .kpi').first.wait_for()
        check('Shared URL restores global input and detail', second.locator('[data-scope-sprint]').input_value() == '3,4' and second.locator('.scope-table tbody tr').count() == 4)
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
