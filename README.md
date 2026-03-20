# claude-pipeline

**Claude Code 커맨드 기반 에이전트 시스템**

Claude Code 슬래시 커맨드 기반으로, GitHub 이슈 트리아지부터 스펙 작성 · 병렬 실행 · 리뷰 · 머지까지 전체 개발 워크플로우를 자동화합니다.

---

## 왜 만들었나

대규모 프로젝트에서 수십~수백 개의 이슈를 처리하려면, 단일 에이전트로는 컨텍스트 한계와 실행 시간 문제에 부딪힙니다.

이 시스템은 **이슈 분석 → 명세 작성 → 충돌 없는 배치 구성 → 병렬 실행 → 자동 리뷰 → 머지**를 파이프라인으로 연결하여, 사람이 개입할 부분을 최소화합니다.

### 핵심 특징

| 특징 | 설명 |
|------|------|
| **멀티 에이전트 병렬 실행** | Git Worktree 격리 환경에서 배치별 독립 실행 |
| **2단계 리뷰 시스템** | L1(Sonnet) 기본 검증 + L2(Opus) 아키텍처 검증 |
| **MIS 배치 알고리즘** | 파일 충돌 그래프 → Maximum Independent Set → 최적 배치 |
| **적응형 팁 시스템** | 실패 원인을 `tip-pool.json`에 축적, 다음 워커에 자동 주입 |
| **멱등성 설계** | 어느 단계에서든 중단 후 안전하게 재실행 |
| **Pipeline CLI** | JSON 기반 상태 추적, Phase 간 검증 게이트, 세션 간 복구 |
| **Context Tier** | 200K / 1M 토큰 환경 모두 대응 |

---

## 워크플로우

```
  [이슈 공급 — 독립 입구]

  /basic-audit-*     → 문제/결함 발견 → 이슈 생성
  /basic-discover    → 기회/신기능 발견 → 이슈 생성
  /basic-brainstorm  → 사용자 아이디어 → 대화형 구체화 → 이슈 생성
        │
        ▼
                         /basic-pipeline
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │   ┌──────────┐    ┌──────────┐    ┌──────────┐      │
  │   │ Nextplan │───▶│   Spec   │───▶│ Review   │      │
  │   │(트리아지) │    │(명세 작성)│    │ (배치 계획)│      │
  │   └──────────┘    └──────────┘    └────┬─────┘      │
  │                                        ▼             │
  │   ┌──────────┐    ┌──────────┐    ┌──────────┐      │
  │   │  Report  │◀───│  Clean   │◀───│  Agents  │      │
  │   │  (회고)   │    │  (정리)   │    │(병렬 실행)│      │
  │   └──────────┘    └──────────┘    └──────────┘      │
  └─────────────────────────────────────────────────────┘
```

---

## 빠른 시작

### 1. 클론

```bash
git clone https://github.com/dongho-dev/claude-pipeline.git
```

### 2. 대상 프로젝트에 커맨드 복사

```bash
# 1M 컨텍스트 환경 (Opus)
cp claude-pipeline/commands/1m/*.md /path/to/your-project/.claude/commands/

# 200K 컨텍스트 환경 (Sonnet)
cp claude-pipeline/commands/200k/*.md /path/to/your-project/.claude/commands/
```

### 3. Pipeline CLI 복사 (선택)

```bash
cp claude-pipeline/scripts/pipeline-cli.mjs /path/to/your-project/scripts/
```

CLI가 있으면 Phase 간 상태 추적 · 검증 게이트 · 리마인더가 자동으로 작동합니다. 없어도 커맨드는 정상 동작합니다.

### 4. 실행

```bash
# Claude Code에서
/basic-pipeline              # 전체 파이프라인 자동 실행
/basic-pipeline --confirm    # 승인 게이트 포함 실행

# 또는 개별 커맨드
/basic-nextplan              # 이슈 트리아지만
/basic-spec 42 57 93         # 특정 이슈 명세만
/basic-agents                # 에이전트 실행만

# 이슈 공급
/basic-discover              # AI가 기회/신기능 발견
/basic-discover feature      # 기능 영역만 집중
/basic-brainstorm            # 대화형 아이디어 구체화
/basic-brainstorm 결제 시스템  # 주제 지정하여 시작
```

---

## 커맨드 상세

### 파이프라인

| 커맨드 | Phase | 설명 |
|--------|-------|------|
| **`/basic-pipeline`** | 전체 | 아래 Phase 1~6을 순차 자동 실행. `--confirm` 옵션으로 2개 승인 게이트 활성화 |

### 개별 커맨드

| 커맨드 | Phase | 입력 | 출력 |
|--------|-------|------|------|
| **`/basic-nextplan`** | 1. 트리아지 | GitHub open 이슈 전체 | 카테고리 분류 + 우선순위 태깅 (🔴high/🟡medium/🟢low) |
| **`/basic-spec`** | 2. 명세 | 이슈 번호 (복수 가능) | 이슈 본문에 구현 명세서 기록 (코드 분석 · 변경 파일 · 테스트 설계) |
| **`/basic-review-issues`** | 3. 배치 계획 | 명세 완료된 이슈 풀 | MIS 알고리즘으로 충돌 없는 배치 구성 + 리뷰 레벨(L1/L2) 지정 |
| **`/basic-agents`** | 4. 병렬 실행 | 배치 계획 | Worktree 격리 실행 → 리뷰어 검증 → PR 생성 → CI 확인 |
| **`/basic-worktree-clean`** | 5. 정리 | — | 잔여 Worktree · 머지된 브랜치 일괄 정리 |

### 이슈 공급 커맨드

| 커맨드 | 발견 주체 | 설명 |
|--------|----------|------|
| **`/basic-audit-backend`** | AI | 백엔드 감사 — 보안 취약점 · 에러 처리 · 테스트 커버리지 |
| **`/basic-audit-frontend`** | AI | 프론트엔드 감사 — 보안 · UX · 접근성 · 성능 |
| **`/basic-audit-fullstack`** | AI | 풀스택 감사 — 백엔드 + 프론트엔드 통합 |
| **`/basic-discover`** | AI | 기회 발견 — 신기능 · DX 개선 · 아키텍처 진화 |
| **`/basic-brainstorm`** | 사용자 | 대화형 아이디어 구체화 — 질문 공세 · 1원칙/5 Whys · 이슈 분해 |

감사/디스커버 커맨드는 Sonnet 에이전트를 병렬로 실행하며 (파일 크기 기준 2MB/에이전트), 발견된 항목을 GitHub 이슈로 자동 생성합니다. 브레인스토밍은 대화형으로 사용자 확인을 거쳐 이슈를 생성합니다.

---

## Pipeline CLI

`scripts/pipeline-cli.mjs` — Phase 상태 관리 · 검증 게이트 · 팁 시스템을 제공하는 Node.js CLI입니다.

### 기본 사용법

```bash
node scripts/pipeline-cli.mjs init                     # 새 파이프라인 초기화
node scripts/pipeline-cli.mjs status                    # 현재 상태 + 리마인더
node scripts/pipeline-cli.mjs advance <phase>           # Phase 전환 (검증 포함)
node scripts/pipeline-cli.mjs complete <phase> '<json>' # Phase 완료 + 출력 기록
node scripts/pipeline-cli.mjs validate                  # 현재 Phase 스키마 검증
```

### 팁 시스템

```bash
node scripts/pipeline-cli.mjs tips [category]           # 가중치 기반 랜덤 팁 2개
node scripts/pipeline-cli.mjs worker-reminder [category] # 워커용 체크리스트 + 팁
node scripts/pipeline-cli.mjs add-tip <cat> "<text>"    # 팁 추가 (중복 시 가중치↑)
node scripts/pipeline-cli.mjs bump-tip "<search>"       # 매칭 팁 가중치 +1
```

### Phase 흐름

```
init → advance nextplan → complete nextplan
     → advance spec → complete spec
     → advance review-issues → complete review-issues
     → advance run-agents → complete run-agents
     → advance worktree-clean → complete worktree-clean
```

각 `advance`에서 이전 Phase 완료 여부와 출력 스키마를 자동 검증합니다. 순서를 건너뛰면 에러로 차단됩니다.

---

## 아키텍처

### 에이전트 실행 모델

```
┌─────────────────────────────────────────────────┐
│              Orchestrator (Opus)                 │
│                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │Worker A │  │Worker B │  │Worker C │  ...     │
│  │(Sonnet) │  │(Sonnet) │  │(Sonnet) │         │
│  └────┬────┘  └────┬────┘  └────┬────┘         │
│       │             │            │               │
│  Worktree A    Worktree B   Worktree C          │
└───────┼─────────────┼────────────┼──────────────┘
        │             │            │
        ▼             ▼            ▼
   ┌──────────────────────────────────┐
   │        Reviewer (L1/L2)          │
   │                                  │
   │  PASS ──▶ Draft 해제 → 머지 대기  │
   │  FAIL 1회 ──▶ 수정 지시 → 재실행   │
   │  FAIL 2회 ──▶ BLOCKED 에스컬레이션 │
   └──────────────────────────────────┘
```

### 배치 구성 — MIS 알고리즘

1. 각 이슈의 명세에서 **Write 파일 목록**을 파싱
2. 이슈 간 파일이 겹치면 **충돌 그래프** 간선 생성
3. **Maximum Independent Set** (greedy) → 충돌 없는 최대 배치 계산
4. 우선순위 타이브레이커: `priority:high > medium > low`
5. 배치당 상한 5~6개, 이슈 ≤3개면 에이전트 없이 직접 처리

### 적응형 팁 시스템

```
Worker 실패 / CI 실패 / Reviewer FAIL
        │
        ▼
  실패 원인 1줄 요약
        │
        ▼
  tip-pool.json에 등록 (가중치 부여)
        │
        ▼
  다음 Worker 프롬프트 끝에 랜덤 주입
  (recency bias — 컨텍스트 끝이 가장 영향력 큼)
```

반복되는 실패일수록 가중치가 올라가 주입 확률이 높아집니다.

### Spec 분배 전략

| 이슈 수 | 처리 방식 |
|---------|----------|
| 1~8개 | 본체가 직접 처리 |
| 9~16개 | Opus Agent 2개 (균등 분배) |
| 17~24개 | Opus Agent 3개 |
| N개 | `ceil(N/8)` 개의 Opus Agent |

Sonnet이 아닌 Opus를 쓰는 이유: 명세는 단순 탐색이 아니라 **1원칙 분해** — 연쇄 영향 판단, 공통 패턴 추출, 테스트 설계 등 고수준 판단이 필요합니다.

---

## Context Tier

| 티어 | 경로 | 대상 모델 | 특징 |
|------|------|----------|------|
| **200K** | `commands/200k/` | Claude Sonnet (기본) | 표준 컨텍스트 |
| **1M** | `commands/1m/` | Claude Opus (1M context) | 전체 스펙을 오케스트레이터에 전달, 리뷰어가 파일 전문 검증 |

두 티어는 동일한 기능을 제공합니다. 1M 티어는 오케스트레이터가 전체 스펙 맥락을 보고 워커 간 잠재 충돌을 감지하거나, 리뷰어가 diff뿐 아니라 파일 전문을 읽고 주변 코드와의 정합성을 검증할 수 있습니다.

---

## 프로젝트 구조

```
claude-pipeline/
├── README.md
├── .gitignore
├── scripts/
│   └── pipeline-cli.mjs     # Pipeline 상태 관리 CLI
└── commands/
    ├── 1m/                   # 1M 토큰 컨텍스트 티어
    │   ├── basic-pipeline.md
    │   ├── basic-nextplan.md
    │   ├── basic-spec.md
    │   ├── basic-review-issues.md
    │   ├── basic-agents.md
    │   ├── basic-worktree-clean.md
    │   ├── basic-audit-backend.md
    │   ├── basic-audit-frontend.md
    │   ├── basic-audit-fullstack.md
    │   ├── basic-discover.md
    │   └── basic-brainstorm.md
    │
    └── 200k/                 # 200K 토큰 컨텍스트 티어
        └── (동일한 11개 커맨드)
```

---

## 요구 사항

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- Git (Worktree 지원)
- GitHub CLI ([`gh`](https://cli.github.com/)) — 이슈/PR 관리용
- Node.js — Pipeline CLI 사용 시

---

## 라이선스

MIT
