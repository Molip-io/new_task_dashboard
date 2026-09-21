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
parent_guide = {'id': 'parent-guide', 'type': 'MISSING_REQUIRED_OWNERS', 'severity': 'error', 'message': 'Parent owners required', 'specId': 'a-spec', 'project': 'Project A'}
fixture = {'sample': False, 'generatedAt': '2026-09-07T10:00:00+09:00', 'projects': projects, 'workItems': tasks, 'validationIssues': [parent_guide] + [i for t in tasks for i in t['issues']], 'metrics': {}, 'deltas': [], 'workload': [], 'notionSetup': {'ready': True, 'databases': []}, 'git': {'repositories': [], 'commits': [], 'errors': []}, 'errors': [], 'sourceHealth': {'sources': [{'id': 'notion', 'status': 'ok'}, {'id': 'agent-analysis', 'status': 'ok', 'analysisStatus': 'success'}]}, 'ai': {'analysisStatus': 'success', 'generatedAt': '2026-09-07T10:05:00+09:00', 'overall': {'summary': 'Synthetic fixture: not production company data.', 'topRisks': []}, 'projects': []}, 'sprintScope': {**scope, 'revision':'initial','signature':'[selected,sprint3]'}, 'sprintSettings': {'writable': True, 'setting': setting, 'scope': scope, 'history': [], 'revision': 'initial', 'pendingInput': False, 'pendingAnalysis': False}}
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
        page.locator('#tab-briefing .management-section .kpi').first.wait_for()
        def values():
            return [int(x) for x in page.locator('#tab-briefing .management-section .kpi .value').all_text_contents()]
        def select_sprint(value):
            page.locator('.sprint-picker > summary').click()
            page.locator(f'[data-briefing-sprint][value="{value}"]').check()
            page.locator('#tab-briefing .management-section .kpi').first.wait_for()
        baseline = values()
        check('Briefing has five scoped KPIs', len(baseline) == 5, baseline)
        headings = page.locator('#tab-briefing h3').all_text_contents()
        check('Only the three requested briefing surfaces are rendered', len(headings) == 3 and headings[0].startswith('1.') and headings[1].startswith('2.') and headings[2].startswith('3.') and 'AI 통합브리핑' in headings[0] and '프로젝트 브리핑' in headings[1] and '스프린트별 업무현황' in headings[2], headings)
        check('Sprint choices normalize aliases into a list', page.locator('[data-briefing-sprint]').count() >= 3 and page.locator('[data-briefing-sprint][value="sprint3"]').count() == 1, page.locator('[data-briefing-sprint]').all_text_contents())
        select_sprint('sprint3')
        selected = values()
        check('Selecting a sprint scopes the five KPIs', len(selected) == 5 and selected[0] <= baseline[0] and selected[1] <= baseline[1], selected)
        page.locator('button[data-briefing-detail="guide"]').click()
        page.locator('#briefing-detail').wait_for()
        check('Guide detail opens from the matching KPI', '가이드 위반 작업항목' in page.locator('#briefing-detail').inner_text(), page.locator('#briefing-detail').inner_text())
        page.locator('[data-scope-filter="project"]').select_option(label='Project B')
        project_values = values()
        check('Project selection narrows the same scoped metrics', project_values[0] == 1 and project_values[1] <= selected[1], project_values)
        page.locator('[data-scope-reset]').click()
        check('Reset returns to the unscoped dashboard', values() == baseline and '전체 스프린트' in page.locator('.sprint-picker > summary').inner_text(), values())
        check('No legacy sprint save request is issued', not writes, writes)
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
