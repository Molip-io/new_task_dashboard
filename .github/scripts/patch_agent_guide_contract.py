from pathlib import Path


def patch(path, replacements=(), insert_before=None, insert_text=None):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    for old, new in replacements:
        if old not in text:
            raise SystemExit(f'missing target in {path}: {old[:100]!r}')
        text = text.replace(old, new, 1)
    if insert_before and insert_text and 'GUIDE_METRIC_SCOPE_V2' not in text:
        if insert_before not in text:
            raise SystemExit(f'missing insert marker in {path}: {insert_before[:100]!r}')
        text = text.replace(insert_before, insert_text + '\n\n' + insert_before, 1)
    p.write_text(text, encoding='utf-8')


scope_contract = '''<!-- GUIDE_METRIC_SCOPE_V2 -->
### 공용 스프린트 브리핑 지표 계약

당일 `payload.rules.briefingScope`를 전사 공용 현재 스프린트의 최우선 기준으로 사용한다. `briefingScope.mode = selected`면 지정된 스프린트만, `all`이면 입력이 제공한 전체 스프린트 범위를 사용하고, `unset`이면 스프린트 기반 브리핑 지표를 0건으로 해석하지 않는다. 과거 프로젝트별 현재 스프린트 값이나 Slack·조회 미리보기로 이 기준을 재구성하지 않는다.

`payload.rules.briefingMetrics`는 **지표별 단위가 다른 mixed-by-metric 집계**다.

- `inProgressWorkItems`, `overdueWorkItems`, `progressSetupRequiredItems`: 선택 범위의 활성 **하위 작업항목** 기준
- `guideViolationWorkItems`: 선택 범위의 활성 **상위 작업 + 하위 작업** 기준
- 가이드 위반은 기한 초과와 독립적인 관리 분류이므로 같은 하위 작업이 `overdueWorkItems`와 `guideViolationWorkItems`에 동시에 포함될 수 있다. 기한 초과라는 이유로 가이드 위반에서 제거하지 않는다.
- `briefingScope.guideUnit = parent-and-child-items`, `briefingScope.guideOverlapAllowed = true`가 제공되면 이 계약을 명시적으로 확인한다.
- `briefingScope.outsideGuideViolationItems`, `unknownGuideViolationItems`가 제공되면 각각 선택 스프린트 밖과 스프린트 분류 불가로 인해 현재 가이드 KPI에 포함되지 않은 항목 수다.

`확인필요` 탭의 전체 활성 범위와 현재 스프린트 브리핑 숫자를 직접 동일하다고 가정하지 않는다. 차이를 설명하거나 검증할 때는 최소한 `선택 스프린트 범위 / 상위·하위 단위 / 기한 초과 중복 / 선택 밖 / 스프린트 미지정·분류 불가`를 분리한다. 동일 스프린트·동일 항목인데 두 화면에서 가이드 분류 자체가 다르면 집계 차이로 덮지 말고 규칙·분류 불일치 후보로 기록한다.'''

patch(
    'agent-package/01_AGENT_INSTRUCTIONS.md',
    replacements=[
        (
            "프로젝트 리스트 DB의 `현재 스프린트`를 프로젝트별 기준으로 사용한다. 여러 값이 있으면 모두 현재 스프린트로 인정한다. `Sprint60`, `Sprint 60`, `스프린트60`처럼 표기만 다른 값은 숫자를 기준으로 정규화하되, 다른 숫자를 유사값으로 추정하지 않는다.",
            "당일 규칙 입력의 `rules.briefingScope`를 전사 공용 현재 스프린트의 최우선 기준으로 사용한다. 수집기가 이 기준으로 프로젝트별 `currentSprints`와 작업별 `sprintRelation`을 계산하므로 이를 그대로 사용하고, 과거 프로젝트별 값이나 다른 출처로 현재 스프린트를 다시 추정하지 않는다."
        ),
        (
            "- `payload.rules.metrics`: 대시보드 원본 집계\n- `payload.rules.deltas`: 전일 대비 변경",
            "- `payload.rules.metrics`: 대시보드 원본 집계\n- `payload.rules.briefingMetrics`: 공용 스프린트 범위의 브리핑 집계. 지표별 단위는 아래 공용 스프린트 브리핑 지표 계약을 따른다.\n- `payload.rules.briefingScope`: 전사 공용 현재 스프린트 기준과 지표 단위·범위 밖 항목 메타데이터\n- `payload.rules.deltas`: 전일 대비 변경"
        ),
        (
            "- `blockers`: `피자레디 UI 기획서와 공통 하이어라키 표준의 제공·확정 여부 확인 필요`처럼 실제 제공 여부가 근거에서 확인되지 않을 때만 기록",
            "- `blockers`: 단순히 자료가 요청됐거나 제공 여부가 확인되지 않는다는 이유로 기록하지 않는다. `자료 미전달 때문에 통합 테스트를 시작하지 못함`처럼 현재 실행 영향이 직접 확인될 때만 기록"
        ),
    ],
    insert_before='## 4. 허용된 소스',
    insert_text=scope_contract,
)

# Daily run prompt: replace project-local sprint wording and add the same mixed-unit contract.
patch(
    'agent-package/02_DAILY_RUN_PROMPT.md',
    replacements=[
        (
            "10. 프로젝트의 `currentSprints`와 작업의 `sprintRelation`을 사용해. 현재 스프린트의 `시작 전`은 `진행 준비 필요 항목`, 지난 스프린트의 `시작 전`은 `지난 스프린트 미착수`로 집계해. 미래 스프린트의 `시작 전`은 진행 준비 및 상세 필드 위반에서 제외하고 공통 필수 항목만 검사해. 관계를 판정할 수 없으면 추정하지 말고 `RULE_NOT_EVALUATED`로 기록해. `project.sprintRequired = false`인 프로젝트에는 이 스프린트 관계 규칙을 적용하지 마.",
            "10. 당일 `rules.briefingScope`를 전사 공용 현재 스프린트 기준으로 사용하고, 그 기준으로 제공된 프로젝트 `currentSprints`와 작업 `sprintRelation`을 그대로 사용해. 현재 스프린트의 `시작 전`은 `진행 준비 필요 항목`, 지난 스프린트의 `시작 전`은 `지난 스프린트 미착수`로 집계해. 미래 스프린트의 `시작 전`은 진행 준비 및 상세 필드 위반에서 제외하고 공통 필수 항목만 검사해. 관계를 판정할 수 없으면 추정하지 말고 `RULE_NOT_EVALUATED`로 기록해. `briefingScope.mode = unset`이면 스프린트 기반 지표를 0건으로 해석하지 말고, `project.sprintRequired = false`인 프로젝트에는 이 관계 규칙을 적용하지 마."
        ),
    ],
    insert_before='<grounding_rules>',
    insert_text='''<!-- GUIDE_METRIC_SCOPE_V2 -->
11-1. `rules.briefingMetrics`는 mixed-by-metric 집계야. `inProgressWorkItems`, `overdueWorkItems`, `progressSetupRequiredItems`는 선택 스프린트의 활성 하위 작업 기준이고, `guideViolationWorkItems`는 선택 스프린트의 활성 상위 작업과 하위 작업을 함께 센다. 같은 하위 작업이 기한 초과이면서 가이드 위반이면 두 지표에 동시에 포함할 수 있고, 기한 초과라는 이유로 가이드 위반에서 빼지 마. `briefingScope.guideUnit = parent-and-child-items`, `guideOverlapAllowed = true`, `outsideGuideViolationItems`, `unknownGuideViolationItems`가 제공되면 그대로 해석해. `확인필요` 전체 수치와 현재 스프린트 수치가 다르면 선택 범위·상위/하위·중복·선택 밖·스프린트 분류 불가를 먼저 분리하고, 동일 스프린트·동일 항목의 분류 자체가 다를 때만 규칙 불일치 후보로 다뤄.''',
)

# Runtime execution instruction used by the repository.
patch(
    'prompts/업무대시보드_에이전트_실행지시.md',
    insert_before='## 분석 범위',
    insert_text='''<!-- GUIDE_METRIC_SCOPE_V2 -->
## 공용 스프린트 브리핑 지표 계약

- 당일 `rules.briefingScope`가 공용 현재 스프린트의 최우선 기준이다. `selected / all / unset` 의미를 입력 그대로 사용하고 다른 출처로 재구성하지 않는다.
- `rules.briefingMetrics`는 mixed-by-metric이다. 진행 중·기한 초과·진행 준비는 선택 범위의 활성 하위 작업 기준이고, 가이드 위반은 선택 범위의 활성 상위 작업 + 하위 작업 기준이다.
- 동일 하위 작업이 기한 초과와 가이드 위반을 동시에 만족하면 두 지표에 모두 포함할 수 있다. 기한 초과 우선 표시 때문에 가이드 위반 사실을 삭제하지 않는다.
- `briefingScope.guideUnit`, `guideOverlapAllowed`, `outsideGuideViolationItems`, `unknownGuideViolationItems`가 있으면 해당 단위와 제외 사유를 그대로 사용한다.
- `확인필요` 탭과 브리핑을 대조할 때는 선택 스프린트 범위, 상위/하위 항목, 기한 초과 중복, 선택 밖, 스프린트 미지정·분류 불가를 구분한다. 같은 스프린트의 같은 항목인데 가이드 분류 자체가 다르면 규칙·분류 불일치 후보로 남긴다.''',
)

# Regression contract.
p = Path('test/agent-instruction-contract.test.mjs')
text = p.read_text(encoding='utf-8')
if 'mixed guide metric contract' not in text:
    text += '''\n\ntest('Given the scoped briefing, When guide metrics are interpreted, Then mixed units and guide overlap are explicit contracts', () => {\n  const documents = [\n    read('../agent-package/01_AGENT_INSTRUCTIONS.md'),\n    read('../agent-package/02_DAILY_RUN_PROMPT.md'),\n    read('../prompts/업무대시보드_에이전트_실행지시.md'),\n  ];\n  for (const document of documents) {\n    assert.match(document, /rules\\.briefingScope/);\n    assert.match(document, /briefingMetrics/);\n    assert.match(document, /상위 작업.*하위 작업|상위 작업 \\+ 하위 작업/);\n    assert.match(document, /기한 초과.*가이드 위반.*동시|동시에 포함/);\n    assert.match(document, /outsideGuideViolationItems/);\n    assert.match(document, /unknownGuideViolationItems/);\n    assert.match(document, /확인필요/);\n  }\n});\n'''
p.write_text(text, encoding='utf-8')
print('agent guide metric contract patched')
