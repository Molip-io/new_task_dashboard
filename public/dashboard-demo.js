export const demoDashboard = {
  "generatedAt": "2026-07-14T07:30:00.000Z",
  "sample": true,
  "errors": [],
  "projects": [
    {
      "name": "피자레디",
      "config": {
        "name": "피자레디",
        "channels": [
          "몰입_피자레디",
          "s2_pizzaready"
        ],
        "days": 3
      },
      "stats": {
        "total": 41,
        "done": 28,
        "inProgress": 6,
        "planned": 5,
        "review": 1,
        "overdue": 3
      },
      "overdueTasks": [
        {
          "title": "라이브 이벤트 보상 밸런스 시트",
          "assignees": [
            "김기획"
          ],
          "due": "2026-07-11",
          "url": "#"
        },
        {
          "title": "월드맵 아트 리소스 2차",
          "assignees": [
            "박아트"
          ],
          "due": "2026-07-12",
          "url": "#"
        },
        {
          "title": "인터스티셜 광고 SDK 갱신",
          "assignees": [
            "이개발"
          ],
          "due": "2026-07-13",
          "url": "#"
        }
      ],
      "activeTasks": [],
      "notionSummary": {
        "date": "2026-07-13",
        "status": "주의",
        "summary": "스프린트60 진행 중. 크리에이티브 아트 리소스 검토 완료, 광고 SDK 이슈 대응 중.",
        "blocked": "광고 SDK 버전 충돌로 빌드 실패 반복",
        "decision": "라이브 미니게임 이벤트 범위 확정 필요",
        "nextAction": "SDK 핫픽스 브랜치 머지 후 CT 재실행",
        "slackSignals": [
          "일정 변경",
          "반복 이슈"
        ]
      },
      "slack": [
        {
          "channel": "몰입_피자레디",
          "count": 47
        },
        {
          "channel": "s2_pizzaready",
          "count": 12
        }
      ],
      "meetings": [
        {
          "project": "피자레디",
          "title": "피자레디 크리에이티브 아트 리소스 및 개발 검토 회의",
          "date": "2026-07-10",
          "url": "#"
        }
      ],
      "specs": [
        {
          "id": "demo-parent",
          "title": "이벤트 출시 준비",
          "project": "피자레디",
          "itemLevel": "parent",
          "sprint": "스프린트60",
          "status": "시작 전",
          "assignees": [
            "김기획"
          ],
          "team": "기획",
          "overdueDays": 0,
          "url": "#",
          "issues": [
            {
              "id": "MISSING_DUE_DATE:demo-parent",
              "type": "MISSING_DUE_DATE",
              "severity": "warning",
              "project": "피자레디",
              "specId": "demo-parent",
              "message": "마감일 입력 필요"
            }
          ]
        }
      ]
    },
    {
      "name": "포지 앤 포춘",
      "config": {
        "name": "포지 앤 포춘",
        "channels": [
          "몰입_포지앤포춘"
        ],
        "days": 3
      },
      "stats": {
        "total": 25,
        "done": 11,
        "inProgress": 8,
        "planned": 6,
        "review": 0,
        "overdue": 0
      },
      "overdueTasks": [],
      "activeTasks": [],
      "notionSummary": {
        "date": "2026-07-13",
        "status": "정상",
        "summary": "스프린트2 순항. UI 색상 방향성 확정, 작업 분배 완료.",
        "blocked": null,
        "decision": null,
        "nextAction": "UI 1차 적용 빌드 리뷰",
        "slackSignals": []
      },
      "slack": [
        {
          "channel": "몰입_포지앤포춘",
          "count": 33
        }
      ],
      "meetings": [
        {
          "project": "포지 앤 포춘",
          "title": "포지앤포춘 UI 작업 방향 정리 회의",
          "date": "2026-07-07",
          "url": "#"
        },
        {
          "project": "포지 앤 포춘",
          "title": "포지앤포춘 UI 색상 방향성 회의",
          "date": "2026-07-02",
          "url": "#"
        }
      ]
    },
    {
      "name": "Color Fill",
      "config": {
        "name": "Color Fill",
        "channels": [
          "몰입_퍼즐"
        ],
        "days": 7
      },
      "stats": {
        "total": 17,
        "done": 15,
        "inProgress": 1,
        "planned": 1,
        "review": 0,
        "overdue": 1
      },
      "overdueTasks": [
        {
          "title": "3차 개선안 지표 분석",
          "assignees": [
            "(미지정)"
          ],
          "due": "2026-07-09",
          "url": "#"
        }
      ],
      "activeTasks": [],
      "notionSummary": {
        "date": "2026-07-12",
        "status": "개입 필요",
        "summary": "2차 개선 적용 후 지표 정체. 다음 방향 결정 대기 상태.",
        "blocked": "3차 개선 방향 미정 — 담당자 배정 안 됨",
        "decision": "Color Fill 추가 개선 지속 여부 (킬/피벗/유지)",
        "nextAction": null,
        "slackSignals": [
          "다음 액션 없음",
          "담당자 불명확",
          "핵심 방향성 미정"
        ]
      },
      "slack": [
        {
          "channel": "몰입_퍼즐",
          "count": 4
        }
      ],
      "meetings": [
        {
          "project": "Color Fill",
          "title": "Color FILL 2차 개선 적용 리뷰",
          "date": "2026-06-19",
          "url": "#"
        }
      ]
    }
  ],
  "workload": [
    {
      "name": "김기획",
      "teams": [
        "기획"
      ],
      "count": 7,
      "tasks": [
        {
          "title": "라이브 이벤트 보상 밸런스 시트",
          "project": "피자레디",
          "spec": "라이브 이벤트 - 마법가마솥",
          "status": "진행 중",
          "start": "2026-07-01",
          "due": "2026-07-11",
          "notionUpdatedAt": "2026-07-10T09:00:00Z",
          "priority": "0순위",
          "url": "#",
          "id": "demo-task-1",
          "sprint": "스프린트60"
        },
        {
          "title": "미니게임 이벤트 기획서",
          "project": "피자레디",
          "spec": "라이브 이벤트 - 마법가마솥",
          "status": "진행 중",
          "start": "2026-07-08",
          "due": "2026-07-17",
          "notionUpdatedAt": "2026-07-14T05:00:00Z",
          "priority": "1순위",
          "url": "#",
          "id": "demo-task-2",
          "sprint": "sprint60"
        },
        {
          "title": "포춘 강화 시스템 상세",
          "project": "포지 앤 포춘",
          "spec": "포지 강화 시스템",
          "status": "진행 예정",
          "start": "2026-07-16",
          "due": "2026-07-20",
          "notionUpdatedAt": "2026-07-14T04:00:00Z",
          "priority": "1순위",
          "url": "#",
          "id": "demo-task-3",
          "sprint": "스프린트3.5"
        }
      ]
    },
    {
      "name": "이개발",
      "teams": [
        "개발"
      ],
      "count": 5,
      "tasks": [
        {
          "title": "인터스티셜 광고 SDK 갱신",
          "project": "피자레디",
          "spec": "익스프레스 기능",
          "status": "진행 중",
          "start": "2026-07-05",
          "due": "2026-07-13",
          "notionUpdatedAt": "2026-07-09T03:00:00Z",
          "priority": "0순위",
          "url": "#",
          "id": "demo-task-4",
          "sprint": "sprint60"
        },
        {
          "title": "메인 플로우 구현",
          "project": "포지 앤 포춘",
          "spec": "포지 강화 시스템",
          "status": "진행 중",
          "start": "2026-07-08",
          "due": "2026-07-18",
          "notionUpdatedAt": "2026-07-14T06:00:00Z",
          "priority": "1순위",
          "url": "#",
          "id": "demo-task-5",
          "sprint": "sprint3.5"
        }
      ]
    },
    {
      "name": "박아트",
      "teams": [
        "아트"
      ],
      "count": 4,
      "tasks": [
        {
          "title": "월드맵 아트 리소스 2차",
          "project": "피자레디",
          "spec": "라이브 이벤트 - 마법가마솥",
          "status": "진행 중",
          "start": "2026-07-02",
          "due": "2026-07-12",
          "notionUpdatedAt": "2026-07-08T08:00:00Z",
          "priority": "1순위",
          "url": "#",
          "id": "demo-task-6",
          "sprint": "크리에이티브"
        },
        {
          "title": "UI 색상 팔레트 적용",
          "project": "포지 앤 포춘",
          "spec": "UI 리뉴얼",
          "status": "진행 중",
          "start": "2026-07-09",
          "due": "2026-07-16",
          "notionUpdatedAt": "2026-07-14T02:00:00Z",
          "priority": "2순위",
          "url": "#",
          "id": "demo-task-7",
          "sprint": "sprint3.5"
        }
      ]
    }
  ],
  "meetings": [
    {
      "project": "피자레디",
      "title": "피자레디 크리에이티브 아트 리소스 및 개발 검토 회의",
      "date": "2026-07-10",
      "url": "#"
    },
    {
      "project": "포지 앤 포춘",
      "title": "포지앤포춘 UI 작업 방향 정리 회의",
      "date": "2026-07-07",
      "url": "#"
    },
    {
      "project": "포지 앤 포춘",
      "title": "포지앤포춘 스프린트 2 회의 - 2",
      "date": "2026-07-06",
      "url": "#"
    },
    {
      "project": "포지 앤 포춘",
      "title": "포지앤포춘 UI 색상 방향성 회의",
      "date": "2026-07-02",
      "url": "#"
    }
  ],
  "slack": {},
  "ai": {
    "overall": {
      "summary": "피자레디는 광고 SDK 충돌 해결과 빌드 검수가 우선입니다. 포지 앤 포춘은 UI 구현을 진행 중이며, Color Fill은 다음 개선 방향을 결정해야 합니다.",
      "topRisks": [
        "피자레디 광고 SDK 충돌 — 빌드 실패 반복으로 스프린트60 일정 위험"
      ],
      "decisionsForCEO": [
        {
          "project": "Color Fill",
          "question": "추가 개선 지속 여부 (킬/피벗/유지)",
          "context": "2차 개선 후 지표 정체, 팀 리소스가 붕 떠 있는 상태."
        }
      ]
    },
    "projects": [
      {
        "name": "피자레디",
        "status": "주의",
        "statusReason": "지연 3건 + SDK 빌드 실패 반복",
        "summary": "스프린트60 진행 중이나 광고 SDK 버전 충돌로 빌드가 반복 실패 중. 크리에이티브 아트 검토는 완료.",
        "blockers": [
          "광고 SDK 버전 충돌"
        ],
        "highlights": [
          "7/10 아트 리소스 검토 회의에서 리소스 규모 축소 합의"
        ],
        "nextActions": [
          "SDK 핫픽스 머지 후 CT 재실행"
        ]
      },
      {
        "name": "포지 앤 포춘",
        "status": "정상",
        "statusReason": "지연 없음, 스프린트2 계획대로 진행",
        "summary": "UI 색상 방향성을 확정하고 구현·리소스 적용을 진행 중입니다.",
        "blockers": [],
        "highlights": [
          "UI 색상 최종안 슬랙 투표로 확정"
        ],
        "nextActions": [
          "UI 1차 적용 빌드 리뷰"
        ]
      },
      {
        "name": "Color Fill",
        "status": "개입필요",
        "statusReason": "다음 액션·담당자 부재 2주 지속",
        "summary": "2차 개선 적용 후 지표 정체. 3차 방향이 정해지지 않아 작업이 멈춰 있음.",
        "blockers": [
          "3차 개선 방향 미정",
          "담당자 미배정"
        ],
        "highlights": [],
        "nextActions": [
          "킬/피벗/유지 결정 회의 소집"
        ]
      }
    ],
    "analysisStatus": "success",
    "generatedAt": "2026-07-14T07:30:00.000Z"
  },
  "workItems": [
    {
      "title": "라이브 이벤트 보상 밸런스 시트",
      "project": "피자레디",
      "spec": "라이브 이벤트 - 마법가마솥",
      "status": "진행 중",
      "start": "2026-07-01",
      "due": "2026-07-11",
      "notionUpdatedAt": "2026-07-10T09:00:00Z",
      "priority": "0순위",
      "url": "#",
      "id": "demo-task-1",
      "sprint": "스프린트60",
      "team": "기획",
      "assignees": [
        "김기획"
      ],
      "overdueDays": 2,
      "issues": [
        {
          "id": "OVERDUE:demo-task-1",
          "type": "OVERDUE",
          "severity": "warning",
          "message": "기한 초과",
          "workItemId": "demo-task-1",
          "project": "피자레디"
        }
      ]
    },
    {
      "title": "미니게임 이벤트 기획서",
      "project": "피자레디",
      "spec": "라이브 이벤트 - 마법가마솥",
      "status": "진행 중",
      "start": "2026-07-08",
      "due": "2026-07-17",
      "notionUpdatedAt": "2026-07-14T05:00:00Z",
      "priority": "1순위",
      "url": "#",
      "id": "demo-task-2",
      "sprint": "sprint60",
      "team": "기획",
      "assignees": [
        "김기획"
      ],
      "overdueDays": 0,
      "issues": []
    },
    {
      "title": "포춘 강화 시스템 상세",
      "project": "포지 앤 포춘",
      "spec": "포지 강화 시스템",
      "status": "진행 예정",
      "start": "2026-07-16",
      "due": "2026-07-20",
      "notionUpdatedAt": "2026-07-14T04:00:00Z",
      "priority": "1순위",
      "url": "#",
      "id": "demo-task-3",
      "sprint": "스프린트3.5",
      "team": "기획",
      "assignees": [
        "김기획"
      ],
      "overdueDays": 0,
      "issues": []
    },
    {
      "title": "인터스티셜 광고 SDK 갱신",
      "project": "피자레디",
      "spec": "익스프레스 기능",
      "status": "진행 중",
      "start": "2026-07-05",
      "due": "2026-07-13",
      "notionUpdatedAt": "2026-07-09T03:00:00Z",
      "priority": "0순위",
      "url": "#",
      "id": "demo-task-4",
      "sprint": "sprint60",
      "team": "개발",
      "assignees": [
        "이개발"
      ],
      "overdueDays": 2,
      "issues": [
        {
          "id": "OVERDUE:demo-task-4",
          "type": "OVERDUE",
          "severity": "warning",
          "message": "기한 초과",
          "workItemId": "demo-task-4",
          "project": "피자레디"
        }
      ]
    },
    {
      "title": "메인 플로우 구현",
      "project": "포지 앤 포춘",
      "spec": "포지 강화 시스템",
      "status": "진행 중",
      "start": "2026-07-08",
      "due": "2026-07-18",
      "notionUpdatedAt": "2026-07-14T06:00:00Z",
      "priority": "1순위",
      "url": "#",
      "id": "demo-task-5",
      "sprint": "sprint3.5",
      "team": "개발",
      "assignees": [
        "이개발"
      ],
      "overdueDays": 0,
      "issues": []
    },
    {
      "title": "월드맵 아트 리소스 2차",
      "project": "피자레디",
      "spec": "라이브 이벤트 - 마법가마솥",
      "status": "진행 중",
      "start": "2026-07-02",
      "due": "2026-07-12",
      "notionUpdatedAt": "2026-07-08T08:00:00Z",
      "priority": "1순위",
      "url": "#",
      "id": "demo-task-6",
      "sprint": "크리에이티브",
      "team": "아트",
      "assignees": [
        "박아트"
      ],
      "overdueDays": 0,
      "issues": []
    },
    {
      "title": "UI 색상 팔레트 적용",
      "project": "포지 앤 포춘",
      "spec": "UI 리뉴얼",
      "status": "진행 중",
      "start": "2026-07-09",
      "due": "2026-07-16",
      "notionUpdatedAt": "2026-07-14T02:00:00Z",
      "priority": "2순위",
      "url": "#",
      "id": "demo-task-7",
      "sprint": "sprint3.5",
      "team": "아트",
      "assignees": [
        "박아트"
      ],
      "overdueDays": 0,
      "issues": []
    }
  ],
  "guideViolationItems": [
    {
      "id": "demo-parent",
      "title": "이벤트 출시 준비",
      "project": "피자레디",
      "itemLevel": "parent",
      "sprint": "스프린트60",
      "status": "시작 전",
      "assignees": [
        "김기획"
      ],
      "team": "기획",
      "overdueDays": 0,
      "url": "#",
      "issues": [
        {
          "id": "MISSING_DUE_DATE:demo-parent",
          "type": "MISSING_DUE_DATE",
          "severity": "warning",
          "project": "피자레디",
          "specId": "demo-parent",
          "message": "마감일 입력 필요"
        }
      ]
    }
  ],
  "progressSetupItems": [
    {
      "id": "demo-parent",
      "title": "이벤트 출시 준비",
      "project": "피자레디",
      "itemLevel": "parent",
      "sprint": "스프린트60",
      "status": "시작 전",
      "assignees": [
        "김기획"
      ],
      "team": "기획",
      "overdueDays": 0,
      "url": "#",
      "issues": [
        {
          "id": "MISSING_DUE_DATE:demo-parent",
          "type": "MISSING_DUE_DATE",
          "severity": "warning",
          "project": "피자레디",
          "specId": "demo-parent",
          "message": "마감일 입력 필요"
        }
      ]
    }
  ]
};
