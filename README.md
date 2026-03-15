# basic-agent-system

**범용 멀티 에이전트 오케스트레이션 시스템** — Claude Code 슬래시 커맨드 기반의 자동화 파이프라인

> GitHub 이슈 트리아지부터 스펙 작성, 병렬 실행, 리뷰, 머지까지
> 전체 개발 워크플로우를 자동화합니다.

---

## 개요

이 프로젝트는 Claude Code의 슬래시 커맨드(`/command`)로 동작하는 **모듈식 에이전트 시스템**입니다.

각 커맨드는 독립적으로 사용하거나, `/basic-pipeline`으로 전체 파이프라인을 한 번에 실행할 수 있습니다.

### 핵심 특징

- **멀티 에이전트 병렬 실행** — Git Worktree 격리 환경에서 안전하게 병렬 작업
- **2단계 리뷰 시스템** — L1(Sonnet) / L2(Opus) 자동 검증
- **MIS 알고리즘 배치 구성** — 파일 충돌 없는 최적 배치 계산
- **적응형 팁 시스템** — 실패에서 학습하여 다음 실행에 반영
- **멱등성 설계** — 어느 단계에서든 안전하게 재실행 가능
- **Context Tier 지원** — 200K / 1M 토큰 환경 모두 대응

---

## 워크플로우

```
┌─────────────────────────────────────────────────────────┐
│                    /basic-pipeline                       │
│                                                         │
│   ┌──────────┐    ┌──────────┐    ┌───────────────┐     │
│   │  Audit   │───▶│ Nextplan │───▶│     Spec      │     │
│   │ (감사)    │    │ (트리아지) │    │ (스펙 작성)    │     │
│   └──────────┘    └──────────┘    └───────┬───────┘     │
│                                           │             │
│   ┌───────────────┐    ┌──────────────┐   │             │
│   │ Worktree-Clean│◀───│    Agents    │◀──┘             │
│   │   (정리)       │    │ (병렬 실행)   │                 │
│   └───────┬───────┘    └──────────────┘                 │
│           │                                             │
│           ▼                                             │
│      📋 Report                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 커맨드 목록

| 커맨드 | 단계 | 설명 |
|--------|------|------|
| `/basic-pipeline` | 전체 | 트리아지→스펙→실행→정리 전체 자동화 |
| `/basic-nextplan` | Phase 1 | 이슈 트리아지 및 우선순위 분류 |
| `/basic-spec` | Phase 2 | 이슈별 구현 명세서 생성 |
| `/basic-review-issues` | Phase 3 | 충돌 분석 및 배치 구성 |
| `/basic-agents` | Phase 4 | 멀티 에이전트 병렬 실행 |
| `/basic-worktree-clean` | Phase 5 | Worktree 및 브랜치 정리 |
| `/basic-audit-backend` | 감사 | 백엔드 보안·에러 처리·테스트 감사 |
| `/basic-audit-frontend` | 감사 | 프론트엔드 보안·UX·접근성 감사 |
| `/basic-audit-fullstack` | 감사 | 풀스택 통합 감사 |

---

## 프로젝트 구조

```
basic-agent-system/
├── commands/
│   ├── 1m/                  # 1M 토큰 컨텍스트 티어
│   │   ├── basic-agents.md
│   │   ├── basic-pipeline.md
│   │   ├── basic-spec.md
│   │   ├── basic-review-issues.md
│   │   ├── basic-nextplan.md
│   │   ├── basic-audit-fullstack.md
│   │   ├── basic-audit-backend.md
│   │   ├── basic-audit-frontend.md
│   │   └── basic-worktree-clean.md
│   │
│   └── 200k/                # 200K 토큰 컨텍스트 티어
│       └── (동일한 9개 커맨드)
│
└── README.md
```

---

## 사용 방법

### 1. 설치

이 저장소를 클론한 뒤, 대상 프로젝트의 `.claude/commands/` 경로에 커맨드 파일을 복사합니다.

```bash
# 예: 1M 컨텍스트 티어 사용 시
cp commands/1m/*.md /path/to/your-project/.claude/commands/
```

### 2. 개별 커맨드 실행

Claude Code에서 슬래시 커맨드로 실행합니다.

```
/basic-nextplan          # 이슈 트리아지
/basic-spec              # 스펙 작성
/basic-agents            # 에이전트 실행
```

### 3. 파이프라인 실행

전체 워크플로우를 한 번에 자동화합니다.

```
/basic-pipeline          # 전체 파이프라인 실행
```

---

## Context Tier

모델의 컨텍스트 윈도우 크기에 따라 두 가지 티어를 제공합니다.

| 티어 | 경로 | 대상 |
|------|------|------|
| **200K** | `commands/200k/` | Claude Sonnet, 기본 환경 |
| **1M** | `commands/1m/` | Claude Opus (1M context) |

두 티어는 동일한 기능을 제공하며, 1M 티어는 대규모 컨텍스트에 최적화된 프롬프트를 포함합니다.

---

## 핵심 아키텍처

### 에이전트 실행 모델

```
Orchestrator (Opus)
    │
    ├── Worker A (Sonnet) ──── Worktree A
    ├── Worker B (Sonnet) ──── Worktree B
    └── Worker C (Sonnet) ──── Worktree C
                  │
                  ▼
         Reviewer (L1/L2)
           │         │
         PASS      FAIL
           │         │
         Merge    재시도 → 2차 FAIL → BLOCKED
```

### 배치 구성 (MIS 알고리즘)

- 이슈 간 **파일 충돌 그래프**를 구성
- Maximum Independent Set으로 **충돌 없는 최대 배치** 계산
- 우선순위 기반 타이브레이커 (high > medium > low)
- 배치당 최대 5~6개 이슈

### 적응형 팁 시스템

```
Worker 실패
    ↓
실패 원인 분석
    ↓
tip-pool.json에 팁 추가 (가중치 부여)
    ↓
다음 Worker 프롬프트 끝에 랜덤 주입 (recency bias 활용)
```

---

## 요구 사항

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- Git (Worktree 지원)
- GitHub CLI (`gh`) — 이슈/PR 관리용

---

## 라이선스

MIT
