"""Offline browser verification of the actual Agent project-briefing presenter.
Uses synthetic data only; no source requests, mutations, or Agent calls.
"""
import copy
import json
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'validation' / 'project-briefing-browser'
OUT.mkdir(parents=True, exist_ok=True)
T = '2026-09-08T01:00:00Z'
NARRATIVE = '합성 검증 데이터: 다음 버전의 제작 규칙을 검토하고 있으며, 남은 범위는 결과 적용 확인이다.'
RAW = '합성 원문: Slack 메시지를 요약문으로 직접 표시하면 안 됩니다.'
sources = ['notion', 'slack', 'meeting', 'git']
brief = {
    'currentProgress': NARRATIVE,
    'buildRelease': '검증용 버전 2는 QA 예정이며 버전 1은 출시가 확인됐다.',
    'data': '검증용 버전 1의 관찰 결과이며 버전 2의 성과는 아직 확인되지 않았다.',
    'confirmationRequired': ['승인 기록 확인 필요'],
    'nextActions': [{'text':'QA 결과 검토', 'kind':'agreed'}, {'text':'배포 대상 버전 확인', 'kind':'suggested_check'}],
    'evidence': [{'source':s, 'timestamp':T, 'url':f'https://example.test/{s}', 'excerpt':f'{s} synthetic direct evidence'} for s in sources],
    'confidenceLimits': []
}
project = {'name':'검증 프로젝트 A', 'projectOperations':{'latestBuild':{'timestamp':T,'excerpt':RAW,'url':'https://example.test/raw'}}}
fixture = {
    'generatedAt':T,
    'agentHandoff':{'generatedAt':T, 'runId':'2026-09-08-morning'},
    'projects':[project, {'name':'검증 프로젝트 B'}],
    'ai':{'runId':'2026-09-08-morning','generatedAt':'2026-09-08T02:00:00Z','analysisStatus':'success',
          'sourceStatus':{s:'success' for s in sources},'sourceComparison':{'status':'complete'},'overall':{},
          'projects':[{'name':project['name'],'summary':'기존 통합 요약', 'projectBriefing':brief,
                       'blockers':['승인 대기로 검증 착수가 막혔다는 직접 보고'], 'specSummaries':[]}]}
}
checks, errors = [], []
def check(name, condition):
    checks.append({'name':name,'passed':bool(condition)})
    if not condition:
        raise AssertionError(name)

try:
    with sync_playwright() as p:
        executable = shutil.which('chromium') or shutil.which('google-chrome')
        browser = p.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':1360,'height':1100})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content('<html lang="ko"><head></head><body><main id="fixture"></main></body></html>')
        page.add_style_tag(content=(ROOT/'public/style.css').read_text()+'\n'+(ROOT/'public/project-briefing.css').read_text())
        page.add_script_tag(content=(ROOT/'public/project-briefing.js').read_text().replace('export function ', 'function '))
        def render(data):
            page.evaluate('d => document.getElementById("fixture").innerHTML = projectBriefingsHtml(d)', data)
        render(fixture)
        cards=page.locator('.project-briefing-card')
        check('one card per exact project', cards.count()==2)
        check('cards start collapsed', cards.locator('xpath=./summary').count()==2 and page.locator('.project-briefing-card[open]').count()==0)
        cards.first.locator('xpath=./summary').click()
        check('click expands only selected project', page.locator('.project-briefing-card[open]').count()==1)
        check('summary label becomes collapse', cards.first.locator('.toggle-close').is_visible() and not cards.first.locator('.toggle-open').is_visible())
        check('synthesis is visible in primary narrative', NARRATIVE in cards.first.locator('.project-briefing-axis').first.inner_text())
        check('three narrative axes are visible', all(cards.first.get_by_role('heading', name=x, exact=True).is_visible() for x in ['현재 진행 요약','빌드·출시 현황','데이터 현황']))
        check('only connected evidence source types shown', cards.first.locator('.project-briefing-source').all_text_contents()==['Notion','Slack','회의록','GitHub'])
        check('raw Slack is not visible initially', not cards.first.get_by_text(RAW, exact=True).is_visible())
        check('agreed and suggested actions are distinguished', cards.first.get_by_text('합의된 행동',exact=True).is_visible() and cards.first.get_by_text('AI 확인 제안',exact=True).is_visible())
        check('timestamp is Seoul', '11:00 KST' in cards.first.locator('.project-briefing-meta').inner_text())
        page.screenshot(path=str(OUT/'desktop-dark.png'),full_page=True)
        evidence=cards.first.locator('.project-briefing-evidence')
        evidence.locator('xpath=./summary').click()
        check('analysis evidence expands', evidence.get_by_text('notion synthetic direct evidence',exact=True).is_visible())
        check('raw remains independently collapsed', not cards.first.get_by_text(RAW,exact=True).is_visible())
        cards.first.locator('.project-briefing-raw > summary').click()
        check('raw evidence can be inspected on demand', cards.first.get_by_text(RAW,exact=True).is_visible())
        page.evaluate("document.documentElement.dataset.theme='light'")
        for width in [390,320]:
            page.set_viewport_size({'width':width,'height':844})
            check(f'no document overflow at {width}px',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.set_viewport_size({'width':390,'height':844})
        cards.first.locator('.project-briefing-evidence > summary').click()
        page.screenshot(path=str(OUT/'mobile-light.png'),full_page=True)
        d=copy.deepcopy(fixture);d['ai']['projects'][0].pop('projectBriefing');render(d)
        page.locator('.project-briefing-card > summary').first.click()
        check('legacy summary remains without fabricated split axes',page.get_by_role('heading',name='기존 통합 요약',exact=True).is_visible() and '영역별 통합 분석 미생성' in page.locator('.project-briefing-body').first.inner_text())
        d=copy.deepcopy(fixture);d['ai']['analysisStatus']='stale';render(d)
        page.locator('.project-briefing-card > summary').first.click()
        check('stale analysis stays explicitly labelled', '이전 통합 분석 · 갱신 필요' in page.locator('.project-briefing-summary-meta').first.inner_text())
        d=copy.deepcopy(fixture);d['ai']['sourceStatus']['slack']='failed';render(d)
        page.locator('.project-briefing-card > summary').first.click()
        check('partial source coverage stays explicit','확인 제한' in page.locator('.project-briefing-summary-meta').first.inner_text() and 'Slack failed' in page.locator('.project-briefing-limits').first.inner_text())
        d=copy.deepcopy(fixture);d['ai']['projects']=[];render(d)
        page.locator('.project-briefing-card > summary').first.click()
        check('no analysis does not substitute raw Slack',page.locator('.project-briefing-empty').first.is_visible() and not page.get_by_text(RAW,exact=True).is_visible())
        d=copy.deepcopy(fixture);d['ai']['projects'][0]['projectBriefing']['currentProgress']='<img src=x onerror="window.injected=1">';render(d)
        check('HTML payload is displayed as text not executed',page.locator('#fixture img').count()==0 and page.evaluate('window.injected === undefined'))
        check('no JavaScript errors',not errors)
        browser.close()
finally:
    report={'checks':checks,'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'javascriptErrors':errors,'data':'synthetic','mode':'offline actual presenter'}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))
