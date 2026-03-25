# 외부 프로젝트 흡수 아이디어 레지스트리

다른 AI 에이전트 시스템을 분석할 때마다 여기에 추가.
각 항목: **아이디어 → 현재 우리 구현 → 상대 구현 → 트레이드오프 → 적용 방안 → 우선순위**

---

## 1. Ouroboros (Q00/ouroboros release/0.26.0-beta) — 2026-03-22 분석

**프로젝트 요약:** Python 기반 specification-first AI 워크플로우 엔진. 소크라테스 인터뷰 → Seed 명세 → Double Diamond 실행 → 3단계 평가 → 진화 루프(30세대). Event Sourcing(SQLite), PAL Router(자동 모델 티어), MCP 양방향 허브, Stagnation 감지 + Lateral Thinking 5 페르소나.

---

### 흡수 대상 아이디어

#### A. PAL Router — 태스크 복잡도 기반 자동 모델/리뷰 선택

**현재 우리 구현:**
- `basic-review-issues.md`에서 L2 에스컬레이션은 규칙 기반 3조건:
  - 3+ Write files
  - 프로젝트 코어 파일(type 정의, 데이터 레이어, 미들웨어, DB 스키마)
  - `priority:high` 라벨 (1M 티어만, 200K에선 제외)
- 200K/1M 컨텍스트 티어는 사용자가 수동 선택
- MIS 알고리즘에서 priority-weighted greedy(1M) vs pure min-degree greedy(200K) — 티어별로 다른 전략이 하드코딩

**Ouroboros 구현:**
- 복잡도 스코어 = 토큰 수(30%) + 도구 의존성(30%) + AC 깊이(40%)
- 3티어 자동 라우팅: Frugal(기본) → Standard(10x) → Frontier(30x)
- 연속 2회 실패 → 에스컬레이션, 연속 5회 성공 → 다운그레이드
- Jaccard 유사도 ≥ 0.80인 유사 태스크는 티어 상속

**트레이드오프:**

| 관점 | 규칙 기반 (현재) | 스코어 기반 (PAL) |
|------|------------------|-------------------|
| **투명성** | 조건 3개로 즉시 판단 가능, 디버깅 쉬움 | 가중치 조합이라 "왜 L2인지" 추적 필요 |
| **정확도** | 코어 파일 수정하면서 1파일만 고치는 경우에도 L2 (과잉) | 복합 스코어라 경계 케이스 더 정교 |
| **적응성** | 새 패턴 나오면 규칙 수동 추가 | 실패/성공 피드백으로 자동 조정 |
| **구현 비용** | 0 — 이미 동작 중 | pipeline-cli.mjs에 스코어링 로직 추가 필요 |
| **실패 모드** | false positive(불필요한 L2) → 비용 증가 | 스코어 드리프트 → 전체 판단 오류 가능 |

**근거 — 흡수하는 이유:**
현재 L2 규칙은 **파일 수와 파일 종류만** 본다. 실제로는 "types/index.ts 1줄 수정"과 "types/index.ts 50줄 리팩토링"이 같은 L2로 분류됨. 복잡도 스코어를 도입하면 변경 파일 수 + 변경 규모 + 의존 이슈 수를 조합해서 더 정확한 리뷰 레벨 결정 가능. 다만 PAL의 3티어 자동 라우팅까지는 불필요 — **L1/L2 결정 로직 정교화**로 한정.

**적용 방안:**
1. spec phase에서 이슈별 복잡도 스코어 계산: `변경 파일 수 × 0.3 + 예상 변경 라인 × 0.3 + 의존 이슈 수 × 0.4`
2. `basic-review-issues`에서 스코어 임계값으로 L1/L2 결정 (기존 3조건은 L2 강제 오버라이드로 유지)
3. 에스컬레이션/다운그레이드 피드백은 보류 — tip pool 가중치 시스템이 이미 유사 역할

**우선순위:** 중
- 이슈 10개 이하: 현재 규칙으로 충분
- 이슈 20개 이상: 수동 판단 병목 발생 시점. 이때 도입 가치 있음

---

#### B. Stagnation 감지 + 전략 전환

**현재 우리 구현:**
- Worker 실패 시 `basic-agents.md` 플로우:
  - FAIL 1 → Reviewer가 수정 지시서 작성 → Worker 재실행
  - FAIL 2 → BLOCKED → 사용자 에스컬레이션
  - 최대 2회 리뷰 사이클, 그 이상은 없음
- CI 실패 시 auto-loop:
  - format/lint → 자동 수정 + 재커밋 (최대 2회)
  - test/build → 에러 메시지 Worker 주입 (최대 2회)
- Tip pool: 실패 → 가중치 증가 → 다음 Worker에 랜덤 2개 주입
  - `bump-tip`: 기존 팁 가중치 +1
  - `add-tip`: 새 팁 가중치 2로 생성
  - **분류 없이 카테고리(general, prettier 등) + 가중치만 사용**

**Ouroboros 구현:**
- 4가지 정체 패턴 감지:
  - **Spinning:** 반복 출력 (같은 코드 반복 생성)
  - **Oscillation:** A→B→A→B (수정↔롤백 반복)
  - **No Drift:** 점수 변화 없음 (시도는 하지만 개선 없음)
  - **Diminishing Returns:** 개선폭 점점 감소
- 패턴별 매칭된 5가지 페르소나:
  - Hacker(우회 시도), Researcher(자료 조사), Simplifier(단순화), Architect(재설계), Contrarian(반대 접근)

**트레이드오프:**

| 관점 | 현재 (횟수 기반 차단) | Stagnation 감지 |
|------|----------------------|-----------------|
| **단순성** | FAIL 1→2→BLOCKED, 이해 즉시 가능 | 패턴 분류 로직 + 전략 매핑 테이블 필요 |
| **실패 비용** | 최대 2회 재시도 후 즉시 중단 → 비용 예측 가능 | 전략 전환 후 추가 재시도 → 비용 상한 불확실 |
| **성공률** | 같은 접근으로 2번 시도 → 구조적 문제면 2번 다 실패 | 접근 자체를 바꾸므로 돌파 가능성 높음 |
| **복잡도** | pipeline-cli.mjs 변경 없음 | Worker 프롬프트에 패턴 감지 + 전략 주입 로직 추가 |
| **디버깅** | "FAIL 2 → BLOCKED" 명확 | "왜 이 전략이 선택됐는지" 추적 필요 |

**근거 — 흡수하는 이유:**
현재 시스템의 **핵심 약점**: FAIL 1에서 Reviewer가 수정 지시서를 쓰지만, Worker가 **같은 접근법**으로 재시도한다. 구조적 문제(잘못된 API 사용, 아키텍처 불일치)면 2회 다 동일하게 실패. Ouroboros의 Spinning/Oscillation 감지는 이 문제를 정확히 짚음. 다만 5가지 페르소나는 과잉 — **실패 패턴 분류(2-3가지) + 팁 카테고리 매핑**이면 구현 비용 대비 효과 충분.

**적용 방안:**
1. FAIL 1 시점에 실패 유형 태깅:
   - `same-error`: 같은 에러 반복 (Spinning) → "완전히 다른 접근법" 계열 팁 주입
   - `test-flip`: 테스트 통과/실패 반복 (Oscillation) → "엣지 케이스 먼저 열거" 계열 팁 주입
   - `partial-progress`: 일부만 해결 (Diminishing Returns) → "스코프 축소" 계열 팁 주입
2. tip-pool.json에 실패 유형별 카테고리 추가 (`same-error`, `test-flip`, `partial-progress`)
3. FAIL 1 → 유형 태깅 → 해당 카테고리 팁 우선 주입 → FAIL 2 → BLOCKED (횟수 상한 유지)
4. **5가지 페르소나는 도입하지 않음** — 팁 카테고리로 동일 효과를 더 경량으로 달성

**우선순위:** 중
- agent-blame 트래킹(improvement-plan.md에 이미 pending)과 결합하면 시너지
- 실패율 데이터가 쌓인 후(10+ 파이프라인 실행) 패턴 분포를 보고 카테고리 확정

---

#### C. 소크라테스 인터뷰 경량 버전 (명세 품질 게이트)

**현재 우리 구현:**
- `/basic-brainstorm`: 5-Whys + 범위 조정 → 이슈 생성
  - 1M: gh issue list 200개 + body 포함, 코드 조사 6항목, 의존성 선행/후행 모두 기록
  - 200K: gh issue list 100개 body 미포함, 코드 조사 5항목(재사용 자산 제외), 의존성 선행만
  - 이슈 생성 직전 품질 게이트: **없음** — brainstorm 결과가 바로 이슈로 변환
- `/basic-spec`: 이슈 → 구현 명세 작성
  - 변경 파일 목록, 의존 이슈, 테스트 설계 등 구조화
  - spec이 부실하면 MIS 배치에서 파일 충돌 감지 실패 가능

**Ouroboros 구현:**
- InterviewEngine: 라운드별 소크라테스 질문 → 모호성 스코어 계산
- 모호성 ≤ 0.2 (80% 명확)까지 반복 → 불변 Seed YAML 생성
- Seed에 목표, 제약 조건, 수용 기준, 온톨로지 스키마, 종료 조건 포함

**트레이드오프:**

| 관점 | 현재 (게이트 없음) | 모호성 스코어링 | 체크리스트 게이트 (경량안) |
|------|-------------------|----------------|------------------------|
| **속도** | brainstorm → 즉시 이슈 | 여러 라운드 인터뷰 (느림) | 1회 체크 추가 (미미) |
| **LLM 비용** | 0 추가 비용 | 라운드당 LLM 호출 (비쌈) | 0 추가 비용 (프롬프트 내 체크) |
| **spec 품질** | brainstorm 품질에 의존 | 높음 — 모호성 제거 보장 | 중간 — 최소 기준 보장 |
| **사용자 경험** | 자유도 높음 | 인터뷰 강제 → 피로감 | 부족 시 경고만, 강제 아님 |
| **실패 전파** | 부실 이슈 → 부실 spec → MIS 오류 → Worker 실패 | 차단됨 | 경고로 인지 가능 |

**근거 — 흡수하는 이유:**
파이프라인 실패의 **근본 원인 추적** 시, spec 부실 → Worker 실패 경로가 존재. 현재는 brainstorm에서 이슈로의 변환에 품질 필터가 없어서, "변경 파일 특정 불가"한 모호한 이슈가 spec phase에 진입할 수 있음. 다만 Ouroboros의 전체 인터뷰 엔진은 **brainstorm의 자유로운 성격과 충돌** — 경량 체크리스트로 충분.

**근거 — 경량으로 한정하는 이유:**
- brainstorm → spec 사이에 `/basic-nextplan`이 이미 이슈 트리아지(workable 여부 판단)를 수행
- spec phase 자체가 코드 분석 → 변경 파일 목록 작성이므로 모호한 이슈도 spec 작성 과정에서 구체화됨
- 전체 인터뷰 엔진 도입 시 brainstorm 1회에 3-5 LLM 라운드 추가 → 비용/시간 과다

**적용 방안:**
1. `/basic-brainstorm` 이슈 생성 직전(Step 6)에 체크리스트 게이트 추가:
   - [ ] 변경 대상 파일/모듈 1개 이상 특정 가능?
   - [ ] 완료 조건(테스트 가능한 수준)이 명확한가?
   - [ ] 기존 이슈와 중복이 아닌가?
2. 미충족 항목 있으면 경고 출력 + 이슈 body에 `⚠️ 명세 보완 필요` 태그
3. nextplan에서 해당 태그 이슈를 `needs-refinement`로 분류 → spec phase 진입 전 필터링
4. **모호성 점수 계산, 반복 인터뷰, 불변 Seed 등은 도입하지 않음**

**우선순위:** 낮
- 현재 nextplan + spec 2단계 필터로 대부분 커버
- brainstorm 자체가 사용자 대화형이라 사용자가 이미 품질 제어 중
- 파이프라인 10회+ 실행 후 "spec 부실 → Worker 실패" 빈도를 보고 재평가

---

#### D. Event Sourcing (파이프라인 이벤트 로그)

**현재 우리 구현:**
- `logs/pipeline-state.json`: 단일 JSON, 현재 상태만 저장
  - `pipelineId`, `currentPhase`, 각 phase의 `status/output/startedAt/completedAt`
  - phase 전환 시 **덮어쓰기** — 이전 상태 히스토리 없음
- 감사 추적: git log + pipeline-state.json 조합으로 간접 추론
- `/basic-report` 회고: pipeline-state.json의 최종 상태 + git log에서 재구성

**Ouroboros 구현:**
- SQLite + SQLAlchemy Core 기반 append-only 이벤트 스토어
- 모든 상태 변화가 불변 이벤트 (phase 전환, Worker 시작/완료, 리뷰 결과 등)
- 세션 리플레이: 이벤트 재생으로 임의 시점 상태 복원
- Unit of Work: 이벤트 + 체크포인트 원자적 커밋

**트레이드오프:**

| 관점 | 현재 (단일 JSON 덮어쓰기) | JSONL 이벤트 로그 (경량안) | SQLite Event Store (원본) |
|------|------------------------|--------------------------|--------------------------|
| **구현 비용** | 0 | pipeline-cli에 append 1줄 추가 | SQLAlchemy + 마이그레이션 + 스키마 |
| **파일 복잡도** | 1파일 | 2파일 (state.json + events.jsonl) | SQLite DB + 쿼리 레이어 |
| **히스토리** | 없음 (현재 상태만) | 전체 이벤트 시퀀스 | 전체 + 인덱싱 + 쿼리 |
| **리플레이** | 불가 | JSONL 순차 읽기로 가능 | 인덱스 기반 임의 시점 복원 |
| **회고 품질** | git log 의존 | 정확한 타임라인 재구성 | 풍부한 분석 가능 |
| **의존성** | 없음 | 없음 | SQLite + SQLAlchemy |

**근거 — 흡수하는 이유:**
`/basic-report` 회고 시 **정확한 타임라인이 없음**. "Phase 3에서 4로 넘어가는데 얼마나 걸렸는지", "어떤 배치가 BLOCKED됐는지" 등이 pipeline-state.json 최종 스냅샷에서는 유실. JSONL append면 구현 비용 거의 0으로 이벤트 히스토리 확보.

**근거 — SQLite가 아닌 JSONL인 이유:**
- 우리 시스템은 Node.js CLI 단일 파일(646줄). SQLAlchemy 도입은 아키텍처 복잡도 급증
- 파이프라인 1회 실행당 이벤트 수 ~20-50개 수준. 인덱싱/쿼리 불필요
- JSONL은 `cat` + `jq`로 즉시 분석 가능, git diff로 변경 추적 가능
- 사용자가 200-300K 구간에서 /clear하는 패턴 → 세션 리플레이보다 회고용 로그가 실용적

**적용 방안:**
1. `pipeline-cli.mjs`의 `advance`/`complete` 명령에 JSONL append 추가:
   ```jsonl
   {"ts":"2026-03-22T10:00:00Z","event":"phase_advance","phase":"spec","from":"pending","to":"in_progress"}
   {"ts":"2026-03-22T10:15:00Z","event":"phase_complete","phase":"spec","output":{"specs":8}}
   {"ts":"2026-03-22T10:16:00Z","event":"tip_bump","tip":"prettier","new_weight":3}
   ```
2. `/basic-report`에서 events.jsonl 파싱 → 타임라인 차트 + 병목 분석
3. **세션 리플레이, 체크포인트, Unit of Work 패턴은 도입하지 않음**

**우선순위:** 낮
- git log 조합으로 현재도 동작
- report 품질 개선 필요성이 체감될 때 도입 (파이프라인 10회+ 실행 후)

---

### 흡수하지 않는 것 (근거 포함)

#### X1. 30세대 진화 루프
- **Ouroboros:** Seed → 실행 → 평가 → Wonder(미지 식별) → Reflect(명세 진화) → 반복, 최대 30세대, 온톨로지 유사도 0.95 수렴까지
- **불채택 근거:** 우리 파이프라인은 이슈 단위 실행. 1이슈 = 1PR = 1머지. 이슈 자체를 30번 진화시킬 필요 없음. Worker FAIL 시 최대 2회 재시도 후 BLOCKED → 사용자 판단이 더 효율적. 30세대 루프의 LLM 비용 = 이슈 1개당 최대 30×(Worker+Reviewer) 호출 → **비용 상한 예측 불가**

#### X2. 3모델 합의 (Consensus Voting)
- **Ouroboros:** GPT-4o + Claude Sonnet 4 + Gemini 2.5 Pro 3모델 투표, 2/3 과반
- **불채택 근거:** 우리 L1(Sonnet)+L2(Opus) 2단계가 **단일 벤더 내에서 더 빠르고 저렴**. 3모델 합의는 API 3개 호출 + 응답 대기 + 불일치 해소 로직 필요. Ouroboros도 6가지 특정 조건에서만 발동(비용 제어)할 정도로 비쌈. 우리 시스템에선 L2 Opus 리뷰가 이미 최고 수준의 단일 모델 검증

#### X3. 5가지 Lateral Thinking 페르소나
- **Ouroboros:** Hacker, Researcher, Simplifier, Architect, Contrarian — 각 페르소나별 시스템 프롬프트 + 전략
- **불채택 근거:** 페르소나 전환은 본질적으로 **시스템 프롬프트 교체**. 우리는 tip pool 주입으로 동일 효과를 달성하되 구현이 더 경량. 5가지 페르소나 각각에 프롬프트 작성 + 매핑 테이블 유지 비용 > tip 카테고리 3개 추가 비용. B안(Stagnation 감지)에서 실패 패턴 분류 + 팁 카테고리 매핑으로 흡수

#### X4. Rust TUI / Rich TUI 대시보드
- **Ouroboros:** Textual 기반 TUI + Rust 대안 TUI. 실시간 phase 진행, AC 트리, 에이전트 활동, 비용 추적, 드리프트 미터
- **불채택 근거:** 우리 시스템은 **Claude Code slash command 네이티브**. 사용자가 이미 Claude Code 터미널 안에 있음. 별도 TUI는 컨텍스트 스위칭 유발. `pipeline-cli.mjs status`로 현재 상태 확인 충분. 실시간 모니터링은 Claude Code의 Agent 실행 로그로 대체

#### X5. Bidirectional MCP Hub
- **Ouroboros:** MCP 서버(도구 노출) + MCP 클라이언트(외부 도구 소비) 양방향
- **불채택 근거:** Claude Code 자체가 MCP 클라이언트. 우리 커맨드 파일은 Claude Code 프롬프트이므로 MCP 도구를 직접 사용 가능. 별도 MCP 허브 레이어는 **불필요한 간접층**. Ouroboros는 Claude Code 외에 Codex CLI도 지원해야 하므로 추상화가 필요했지만, 우리는 Claude Code 전용

#### X6. 불변 Seed YAML
- **Ouroboros:** 생성 후 수정 불가(Pydantic frozen). 변경 시 새 세대 Seed 생성
- **불채택 근거:** 우리는 GitHub Issue가 명세 저장소. Issue body가 spec이고, 수정 이력은 GitHub가 관리. 별도 YAML 파일 + 불변성 제약은 **GitHub 워크플로우와 이중 관리**. Issue 편집 → spec 재생성이 더 자연스러움

---

## 2. Composio Agent Orchestrator (ComposioHQ/agent-orchestrator) — 2026-03-22 분석

**프로젝트 요약:** TypeScript 기반 멀티 에이전트 코딩 오케스트레이터. 5K+ stars. 30개 동시 AI 에이전트를 Git Worktree로 격리 실행. 7개 플러그인 슬롯(Runtime/Agent/Workspace/Tracker/SCM/Notifier/Terminal), 에이전트 무관(Claude Code/Codex/Aider/OpenCode). 이벤트→리액션 기반 CI 실패 자동 복구. 8일 만에 자기 자신을 빌드한 프로젝트(30 동시 에이전트). PR 성공률 64%.

---

### 흡수 대상 아이디어

#### A. 관찰 기반 에이전트 상태 감지 ("Agents lie")

**현재 우리 구현:**
- Worker 상태는 **Worker 자체의 출력에 의존**. Worker가 "완료"라고 보고하면 Reviewer가 검증
- Reviewer PASS/FAIL 판단도 LLM 판단에 의존
- pipeline-cli.mjs의 phase 상태는 사용자가 `advance`/`complete` 명령으로 수동 전환
- 에이전트가 실제로 동작 중인지, 멈춘 건지 판단하는 메커니즘 없음

**Composio 구현:**
- Claude Code의 `.jsonl` 세션 파일을 직접 tail-read (131KB만 읽어 100MB+ 파일 방지)
- entry type으로 상태 추론: `tool_use`/`progress` → active, `assistant`/`summary` → ready, `permission_request` → waiting_input, `error` → blocked
- "Agents lie, or at least get confused" — 자기 보고 대신 **외부 관찰**로 상태 판단
- 상태 전이: spawning → working → pr_open → mergeable → merged, 분기: needs_input, stuck, ci_failed, changes_requested

**트레이드오프:**

| 관점 | 현재 (자기 보고 의존) | 관찰 기반 감지 |
|------|---------------------|---------------|
| **정확도** | Worker가 "완료"라 해도 실제로는 불완전할 수 있음 | JSONL 파일이 ground truth — 실제 도구 호출 기록 |
| **구현 비용** | 0 | JSONL 파싱 로직 + 상태 매핑 테이블 필요 |
| **범용성** | Claude Code 특화 필요 없음 | Claude Code JSONL 포맷 의존 — 포맷 변경 시 깨짐 |
| **실시간성** | 결과 보고 후에만 판단 가능 | 실행 중에도 stuck/blocked 감지 가능 |
| **디버깅** | Worker 출력만 볼 수 있음 | 전체 도구 호출 히스토리 추적 가능 |

**근거 — 흡수하는 이유:**
현재 `/basic-agents`에서 Worker가 무응답이 되거나 무한 루프에 빠진 경우를 감지할 방법이 없음. Composio가 발견한 "에이전트는 거짓말한다" 문제는 실제로 발생함 — Worker가 PASS를 자체 선언했지만 실제로는 테스트를 실행하지 않은 경우 등. JSONL 관찰은 이를 근본적으로 해결.

**근거 — 경량으로 한정하는 이유:**
- 우리 시스템은 Worktree 격리 Agent tool 기반이라, Claude Code 내부 JSONL에 직접 접근이 어려울 수 있음
- 전체 상태 머신(8개 상태)까지는 불필요 — stuck/blocked 감지만으로도 가치 있음

**적용 방안:**
1. `basic-agents`에서 Worker 실행 후 타임아웃 기반 stuck 감지 추가 (예: Worker 10분 무응답 → BLOCKED)
2. Worker PR 생성 여부로 "실제 완료" 검증 (현재 일부 구현됨: Step 0 고아 worktree 감지)
3. 장기: Claude Code의 `.jsonl` 세션 파일 파싱 가능해지면 관찰 기반으로 전환
4. **전체 상태 머신, SSE 대시보드, 실시간 모니터링은 도입하지 않음**

**우선순위:** 중
- Worker 무한루프/무응답이 실제 발생한 적 있으면 즉시 도입
- 없으면 타임아웃 기반으로 충분

---

#### B. 이벤트→리액션 시스템 (CI 실패 자동 복구)

**현재 우리 구현:**
- CI 실패 처리는 `basic-agents.md`에 하드코딩:
  - format → 자동 수정 + 재커밋 (최대 2회)
  - lint(--fix 가능) → 자동 수정 + 재커밋 (최대 2회)
  - test/build → 에러 메시지 Worker 주입 (최대 2회)
- 실패 유형별 분기가 프롬프트 내 규칙으로만 존재, 코드 레벨 강제 아님
- 리뷰 코멘트 자동 처리 없음 — Reviewer PASS/FAIL만 존재

**Composio 구현:**
- 이벤트 기반 리액션 엔진:
  ```yaml
  reactions:
    ci-failed: { auto: true, action: send-to-agent, retries: 2, escalateAfter: 30m }
    changes-requested: { auto: true, action: send-to-agent, retries: 2 }
    bugbot-comments: { auto: true, action: send-to-agent }
  ```
- `pollAll()` → SCM 플러그인으로 CI 상태 변화 감지 → 이벤트 발화 → 리액션 실행
- 리액션 추적: `reactionTrackers Map`에 세션별 시도 횟수 + 최초 트리거 시간 기록
- 에스컬레이션: 시도 > retries OR 경과 > escalateAfter → `reaction.escalated` 이벤트
- 상태 전환 시 이전 리액션 트래커 초기화 (새 커밋 CI 실패는 새 카운터)
- 실전 성과: PR #125가 12회 연속 CI 실패-수정 사이클을 사람 개입 없이 통과

**트레이드오프:**

| 관점 | 현재 (프롬프트 내 규칙) | 이벤트→리액션 엔진 |
|------|----------------------|-------------------|
| **유연성** | 규칙 변경 = 프롬프트 편집 | YAML 설정으로 리액션 추가/수정 |
| **투명성** | Worker 내부에서 처리 → 로그 추적 어려움 | 이벤트 발화 로그로 전체 흐름 추적 |
| **확장성** | 새 실패 유형 = 프롬프트에 분기 추가 | 새 이벤트 + 리액션 YAML 추가 |
| **구현 비용** | 0 (프롬프트로 동작) | poll 루프 + 이벤트 시스템 + 리액션 엔진 |
| **시간 기반 에스컬레이션** | 없음 — 횟수만 | 30분 경과 후 자동 에스컬레이션 |
| **상태 리셋** | 없음 — 2회 고정 | 새 커밋 시 카운터 리셋 (12회까지 자동 복구 가능) |

**근거 — 흡수하는 이유:**
현재 CI 실패 처리의 **핵심 한계**: 최대 2회 고정이라 새 커밋 push 후에도 카운터가 리셋되지 않음. Composio의 "상태 전환 시 트래커 초기화"는 합리적 — 새 커밋은 새 시도이므로 카운터를 리셋해야 함. PR #125의 12회 자동 복구 사례는 이 설계의 실효성을 증명.

**근거 — 전체 엔진이 아닌 개선으로 한정하는 이유:**
- 우리 시스템은 poll 루프가 없음 — Claude Code 세션 내에서 동기적으로 실행
- 이벤트 시스템 도입은 아키텍처 근본 변경 (동기 → 비동기)
- 프롬프트 내 규칙을 정교화하면 대부분 커버 가능

**적용 방안:**
1. `basic-agents.md` CI 실패 규칙에 **커밋 단위 카운터 리셋** 추가: "새 커밋 push 후 CI 실패는 카운터 0부터 재시작"
2. 시간 기반 에스컬레이션 개념 도입: "동일 CI 에러 30분 이상 반복 → BLOCKED"
3. `pipeline-cli.mjs`에 CI 실패 횟수 추적 커맨드 추가 (선택적): `pipeline-cli.mjs ci-track <pr> <result>`
4. **전체 이벤트→리액션 엔진, poll 루프, YAML 설정 시스템은 도입하지 않음**

**우선순위:** 중
- CI 실패 자동 복구 개선은 Worker 성공률에 직결
- 커밋 단위 카운터 리셋만으로도 효과 클 것으로 예상

---

#### C. 재귀적 태스크 분해 (Task Decomposer)

**현재 우리 구현:**
- 이슈 분해는 `/basic-spec`에서 수행: 1이슈 = 1구현 명세
- 명세 분배: 1-8이슈 직접, 9-16이슈 2 Opus 에이전트, ceil(N/8)으로 분배
- 이슈 자체를 하위 태스크로 분해하는 메커니즘 없음
- 큰 이슈가 들어오면 Worker가 자체 판단으로 구현 — 범위 초과 리스크

**Composio 구현:**
- 재귀적 LLM 기반 분해:
  1. 태스크를 "atomic" vs "composite" 분류 (Claude Sonnet, max_tokens=10)
  2. composite → 2-7개 하위 태스크로 분해 (최소 2 강제)
  3. 최대 깊이 3까지 재귀
  4. 최대 깊이 도달 시 강제 atomic
- 형제 인식(Sibling awareness): 각 에이전트 프롬프트에 병렬 형제 태스크 설명 포함 + "YOUR task에만 집중하라" 경고

**트레이드오프:**

| 관점 | 현재 (이슈 = 최소 단위) | 재귀적 분해 |
|------|----------------------|------------|
| **단순성** | 1이슈 = 1Worker = 1PR, 추적 명확 | 1이슈 → N하위태스크 → 추적 복잡 |
| **대규모 이슈** | Worker가 범위 초과 가능 | 사전에 atomic 단위로 분해 → 범위 제한 |
| **LLM 비용** | 분해 비용 0 | 분류(max_tokens=10) + 분해 호출 추가 |
| **MIS 영향** | 이슈 단위 충돌 감지 (coarse) | 하위태스크 단위면 더 정밀한 충돌 감지 가능 |
| **PR 관리** | 이슈:PR = 1:1, 깔끔 | 하위태스크:PR = N:1? 또는 N:N? 복잡 |

**근거 — 흡수하는 이유:**
`basic-spec`에서 "변경 파일 10개 이상" 같은 대규모 이슈가 들어오면, Worker 하나가 전체를 구현해야 함 → 컨텍스트 과부하 + 리뷰 난이도 급증. Composio의 atomic/composite 분류(max_tokens=10, 거의 무료)는 경량 사전 필터로 가치 있음.

**근거 — 재귀 분해까지는 불필요한 이유:**
- 우리 MIS 배치는 이슈 단위 충돌 감지. 하위태스크 단위로 가면 MIS 그래프 복잡도 급증
- PR:이슈 1:1 관계가 깨지면 GitHub 이슈 추적이 복잡해짐
- spec phase에서 이미 변경 파일 목록을 구조화하므로, 범위 과다 이슈는 spec 시점에 감지 가능

**적용 방안:**
1. `basic-spec`에서 변경 파일 수 기반 이슈 크기 경고: 변경 파일 8개+ → `⚠️ 분할 권장` 라벨
2. `basic-nextplan`에서 대규모 이슈 자동 감지 → 분할 제안 (사용자 판단)
3. 형제 인식(Sibling awareness) 패턴: Worker 프롬프트에 같은 배치 내 다른 이슈의 변경 파일 목록 포함 → "겹치는 파일은 건드리지 마라" 명시적 경고
4. **재귀적 분해, atomic/composite LLM 분류, 하위태스크 PR은 도입하지 않음**

**우선순위:** 낮
- 현재 이슈 크기가 대체로 적절 (audit/discover가 세밀한 이슈를 생성)
- 사용자 수동 이슈 등록 시 대규모 이슈가 들어올 가능성 있으면 재평가

---

### 흡수하지 않는 것 (근거 포함)

#### X1. 플러그인 아키텍처 (7슬롯 × N구현)
- **Composio:** Runtime(tmux/process), Agent(claude-code/codex/aider/opencode), Workspace(worktree/clone), Tracker(github/linear), SCM(github), Notifier(5개), Terminal(iterm2/web)
- **불채택 근거:** 우리는 **Claude Code 전용**. 다른 에이전트(Codex/Aider) 지원 필요 없음. 플러그인 추상화는 멀티 에이전트 지원이 목적인데, 단일 에이전트 파이프라인에선 간접층만 추가. Composio 자체도 "새 에이전트 추가 = 깊은 통합 작업"이라 플러그인의 이점이 제한적이라 인정

#### X2. 전용 오케스트레이터 에이전트 (읽기 전용 AI)
- **Composio:** 별도 AI 에이전트가 백로그를 읽고 Worker를 스폰/관리. 코드 편집 금지, 읽기 전용
- **불채택 근거:** 우리 파이프라인은 **프롬프트 자체가 오케스트레이터**. `/basic-pipeline`이 Phase 1-6을 순차 실행하며, 각 phase가 다음 phase의 입력을 생성. 별도 AI 오케스트레이터 에이전트는 LLM 비용 추가 + 오케스트레이터 자체의 판단 오류 리스크. 코드 기반 오케스트레이션(`pipeline-cli.mjs`)이 더 결정적(deterministic)

#### X3. 3단계 리뷰 (봇 + AI 피어 + 사람)
- **Composio:** Cursor Bugbot(자동, 69%) + AI 피어 리뷰(30%) + 사람(1%)
- **불채택 근거:** 우리 L1(Sonnet)/L2(Opus) 2단계가 **더 통합적**. Bugbot 같은 외부 도구 의존은 추가 설정 + 유지 비용. AI 피어 리뷰(다른 에이전트가 리뷰)는 동일 모델이 다른 시각을 제공한다는 보장 없음. L2 Opus가 이미 최고 수준 리뷰

#### X4. Web 대시보드 (Next.js + SSE)
- **Composio:** 실시간 세션 상태, CI 상태, PR 상태를 웹 대시보드로 시각화
- **불채택 근거:** 우리 사용자는 **Claude Code 터미널에서 작업**. 별도 웹 대시보드는 컨텍스트 스위칭. `pipeline-cli.mjs status`가 터미널 내에서 동일 정보 제공. 30+ 동시 에이전트 운영이 아닌 이상 대시보드 필요성 낮음

---

## 3. Superpowers (obra/superpowers) — 2026-03-22 분석

**프로젝트 요약:** 104K+ stars. Agentic skills 프레임워크. 13개 Markdown 스킬 파일로 AI 코딩 워크플로우를 구조화. 핵심: subagent-driven-development(태스크당 fresh subagent + 2단계 리뷰 게이트), TDD 절대 강제(RED-GREEN-REFACTOR), verification-before-completion(5단계 증거 요구). Cialdini 설득 원칙 기반 LLM "합리화 방지" 프롬프트 엔지니어링. Claude Code/Cursor/Codex/OpenCode 멀티 플랫폼.

---

### 흡수 대상 아이디어

#### A. Verification-before-Completion (완료 전 증거 요구)

**현재 우리 구현:**
- Worker가 구현 완료 보고 → Reviewer가 diff 기반 검증
- Worker의 "완료" 선언에 증거 요구 없음 — "테스트 통과했다"고 주장하면 Reviewer가 확인
- CI 통과 여부는 PR push 후에야 판단 가능
- Reviewer도 LLM이므로 "통과한 것 같다"는 판단을 할 수 있음

**Superpowers 구현:**
- 5단계 증거 프로토콜:
  1. **Identify**: 검증해야 할 구체적 주장 목록 작성
  2. **Run**: 실제 명령어 실행 (테스트, 빌드, 린트)
  3. **Read**: 출력 결과를 실제로 읽음
  4. **Verify**: 출력이 주장과 일치하는지 판단
  5. **Claim**: 증거가 있는 주장만 최종 보고
- "Skip any step = lying, not verifying"
- Red flags: 증거 없는 확신, 부분 검사, "should work" 언어, 이전 실행 결과 인용

**트레이드오프:**

| 관점 | 현재 (Reviewer 사후 검증) | Verification-before-Completion |
|------|-------------------------|-------------------------------|
| **Worker 부하** | 구현만 하면 됨 | 구현 + 자체 검증까지 수행 |
| **Reviewer 부하** | 전체 검증 책임 | 증거 확인만 (경량) |
| **실패 감지 시점** | PR push + CI + Reviewer 후 (늦음) | Worker 단계에서 즉시 (빠름) |
| **비용** | Worker 1회 + Reviewer 1회 | Worker 1.2~1.5회 (검증 포함) + Reviewer 0.5회 |
| **총 비용 효과** | FAIL 시 Worker 재실행 비용 높음 | 사전 검증으로 FAIL 감소 → 총 비용 절감 가능 |
| **프롬프트 복잡도** | Worker 프롬프트 단순 | 5단계 프로토콜 + red flag 목록 추가 |

**근거 — 흡수하는 이유:**
Worker가 "완료"라고 보고했는데 실제로 테스트를 실행하지 않은 경우가 LLM의 대표적 실패 모드. Superpowers의 "Skip any step = lying" 프레이밍은 LLM의 **합리화 경향을 직접 공격**. 이것은 프롬프트 엔지니어링 기법이므로 구현 비용이 거의 0 — Worker 프롬프트에 체크리스트만 추가하면 됨.

**적용 방안:**
1. `basic-agents.md` Worker 프롬프트에 완료 전 체크리스트 추가:
   - [ ] 테스트 실행 명령어 + 실제 출력 결과 첨부
   - [ ] 빌드 성공 확인 명령어 + 실제 출력 결과 첨부
   - [ ] spec의 변경 파일 목록과 실제 변경 파일 일치 확인
   - "증거 없이 '통과'라고 보고하지 마라. 출력 결과를 반드시 첨부하라."
2. Reviewer에게 증거 검증 지시 추가: "Worker가 테스트 출력을 첨부하지 않았으면 FAIL"
3. **5단계 전체 프로토콜, red flag 목록 전체는 도입하지 않음** — 핵심 원칙("증거 첨부")만 추출

**우선순위:** 상
- 구현 비용 거의 0 (프롬프트 편집)
- FAIL 감소 → 재시도 감소 → 비용 절감으로 직결
- 즉시 적용 가능

---

#### B. Worker 상태 프로토콜 (4-Status Model)

**현재 우리 구현:**
- Worker 결과: 암묵적으로 "완료" 또는 "실패"
- Reviewer가 PASS/FAIL/BLOCKED 판단
- Worker가 "맥락 부족"이나 "부분 완료"를 구조화해서 보고하는 프로토콜 없음
- Worker가 spec 자체에 문제가 있다고 보고하는 경로 없음

**Superpowers 구현:**
- 4가지 명시적 상태:
  - `DONE`: 구현 완료, 리뷰 진행
  - `DONE_WITH_CONCERNS`: 완료했지만 우려 사항 있음 → 컨트롤러가 우려 평가
  - `NEEDS_CONTEXT`: 맥락 부족 → 컨트롤러가 추가 정보 제공 후 재실행
  - `BLOCKED`: 구현 불가 → 차단 유형 분류 (맥락/추론/범위/명세 오류)

**트레이드오프:**

| 관점 | 현재 (암묵적 완료/실패) | 4-Status 프로토콜 |
|------|---------------------|------------------|
| **정보량** | "됐다" or "안됐다" | 왜 안 됐는지, 뭐가 부족한지 구조화 |
| **재시도 정확도** | Reviewer가 원인 추론 필요 | Worker가 원인 보고 → 정확한 대응 가능 |
| **spec 피드백** | Worker → spec 역방향 피드백 없음 | BLOCKED(명세 오류) → spec 수정 트리거 가능 |
| **프롬프트 복잡도** | 단순 | 4가지 상태 정의 + 각 상태별 보고 형식 필요 |
| **LLM 준수율** | N/A | LLM이 4가지 중 정확히 하나를 선택하는 것에 의존 |

**근거 — 흡수하는 이유:**
현재 Worker가 FAIL하면 Reviewer가 원인을 **diff에서 역추론**해야 함. "이 Worker는 spec을 이해 못 한 건지, 코드를 못 찾은 건지, 아키텍처를 잘못 판단한 건지" 구분이 안 됨. 4-Status 중 `NEEDS_CONTEXT`와 `BLOCKED`만 도입해도 재시도 정확도가 올라감.

**적용 방안:**
1. Worker 완료 보고 형식에 상태 코드 추가:
   - `DONE` — PR 생성 진행
   - `DONE_WITH_CONCERNS` — PR 생성하되 우려 사항을 Reviewer에게 전달
   - `NEEDS_CONTEXT` — 추가 정보 필요, 오케스트레이터가 정보 제공 후 재실행
   - `BLOCKED` — 구현 불가, 원인 분류 (spec 부실 / 의존성 미해결 / 아키텍처 충돌)
2. Reviewer는 `DONE`/`DONE_WITH_CONCERNS`만 리뷰. `NEEDS_CONTEXT`/`BLOCKED`는 오케스트레이터가 처리
3. `BLOCKED(spec 부실)` → tip pool에 spec 관련 팁 가중치 증가

**우선순위:** 중
- Verification-before-Completion(A안)과 결합하면 시너지
- Worker 프롬프트 변경으로 구현 가능 (코드 변경 최소)

---

#### C. LLM 합리화 방지 프롬프트 패턴 (Rationalization Countermeasures)

**현재 우리 구현:**
- Worker/Reviewer 프롬프트는 **작업 지시** 중심 — "무엇을 하라" 위주
- LLM이 지시를 우회하거나 합리화하는 것에 대한 방어 없음
- tip pool이 일부 역할 (실패 경험 기반 경고)이지만 체계적 방어는 아님

**Superpowers 구현:**
- **writing-skills 메타스킬 (22,465바이트)**: Cialdini 설득 원칙 기반
- 각 스킬에 "Common Mistakes" 섹션 + "Red Flags" 목록
- 허점 봉쇄 테이블: LLM이 흔히 사용하는 합리화 패턴 → 대응 문구
  - "just this once" → "No exceptions. Delete and restart"
  - "keep as reference" → "Reference is contamination"
  - "tests are passing already" → "Tests passing immediately = tests proving nothing"
  - "should work" → "Show evidence or it didn't happen"
- 스킬 작성 시 **LLM이 빠질 모든 빠져나갈 구멍을 미리 막는** 방법론

**트레이드오프:**

| 관점 | 현재 (지시 중심) | 합리화 방지 패턴 |
|------|----------------|-----------------|
| **프롬프트 길이** | 짧고 집중적 | 방어 문구로 30-50% 증가 |
| **토큰 비용** | 낮음 | 프롬프트 길이 증가 → 입력 토큰 비용 증가 |
| **LLM 준수율** | 지시를 따를 수도 안 따를 수도 | 빠져나갈 구멍이 적어 준수율 향상 |
| **유지 보수** | 규칙 추가/수정 쉬움 | Red flag 목록 유지 필요 |
| **일반화** | 프로젝트 무관 | 특정 실패 패턴에 특화 (전이 가능성 높음) |

**근거 — 흡수하는 이유:**
104K stars의 핵심 가치가 여기에 있음. Superpowers의 진짜 혁신은 아키텍처가 아니라 **프롬프트 엔지니어링 방법론**. "82,000 developers just agreed: the biggest problem with AI coding is not intelligence. It is discipline." LLM 합리화 방지는 Worker 품질에 직접 영향. tip pool보다 더 사전적(proactive)인 방어.

**근거 — 전체 방법론이 아닌 패턴 추출로 한정하는 이유:**
- Superpowers는 단일 기능 워크플로우 최적화. 우리는 N이슈 병렬 파이프라인
- 22K 바이트 메타스킬 전체를 매 Worker에 주입하면 토큰 과다
- 핵심 패턴만 추출해서 Worker/Reviewer 프롬프트에 삽입

**적용 방안:**
1. Worker 프롬프트에 핵심 합리화 방지 문구 3-5개 추가:
   - "테스트를 실행하지 않고 '통과할 것이다'라고 보고하지 마라"
   - "spec에 없는 변경을 '개선'이라고 합리화하지 마라"
   - "파일을 읽지 않고 '이미 알고 있다'고 가정하지 마라"
   - "에러를 무시하고 진행하지 마라 — 에러가 있으면 보고하라"
2. Reviewer 프롬프트에:
   - "Worker가 증거 없이 주장하면 FAIL"
   - "diff와 spec이 일치하지 않으면 '부분 구현'으로 허용하지 마라"
3. 새로운 합리화 패턴 발견 시 → tip pool에 추가 (기존 시스템 활용)
4. **writing-skills 메타스킬 전체, Cialdini 프레임워크, red flag 목록 전체는 도입하지 않음**

**우선순위:** 상
- 프롬프트 편집만으로 즉시 적용 가능
- A안(Verification-before-Completion)과 결합하면 상승 효과
- Superpowers 104K stars의 핵심 가치를 경량으로 흡수

---

#### D. Spec 준수 리뷰 + 품질 리뷰 분리 (2-Stage Review)

**현재 우리 구현:**
- Reviewer 1명이 **spec 준수 + 코드 품질** 동시 검증
- L1(Sonnet): 구현 정확성, 문법, 테스트
- L2(Opus): 아키텍처 일관성, 파일 응집도, 패턴 정합
- 두 관점이 하나의 리뷰에 혼재 → 어떤 이유로 FAIL인지 불명확할 수 있음

**Superpowers 구현:**
- **Stage 1 — Spec Compliance**: spec-reviewer 서브에이전트가 "코드가 spec과 정확히 일치하는가" **만** 검증. 품질 무시. 실패 시 구현자에게 반환
- **Stage 2 — Code Quality**: spec 통과 후에만 실행. quality-reviewer가 구현 품질 검증. 실패 시 구현자에게 반환
- 두 단계는 **순차적** — Stage 1 실패 시 Stage 2 진행 안 함

**트레이드오프:**

| 관점 | 현재 (통합 리뷰) | 2-Stage 분리 |
|------|----------------|-------------|
| **리뷰 횟수** | 1회 (통합) | 2회 (순차) |
| **LLM 비용** | Reviewer 1회 호출 | Reviewer 2회 호출 (비용 ~2배) |
| **FAIL 원인 명확성** | "FAIL" — spec 미준수인지 품질 문제인지 혼재 | Stage 1 FAIL = spec 문제, Stage 2 FAIL = 품질 문제 |
| **Worker 수정 정확도** | 혼합 피드백 → 뭘 고쳐야 하는지 불명확 | 단일 초점 피드백 → 정확한 수정 |
| **총 사이클 수** | 통합 FAIL → 재구현 → 재리뷰 | Stage 1에서 걸러지면 Stage 2 비용 절감 |

**근거 — 흡수하는 이유:**
현재 Reviewer FAIL 시 수정 지시서에 "spec 미준수"와 "코드 품질"이 섞여 있으면 Worker가 **품질 문제를 고치면서 spec 준수를 깨뜨리는** 경우 발생 가능. 분리하면 각 FAIL에 대해 Worker가 **한 가지만 집중** 가능. 특히 FAIL 1 → 재시도에서 성공률 향상 기대.

**근거 — 완전 분리가 아닌 관점 분리로 한정하는 이유:**
- 2회 별도 Reviewer 호출은 비용 2배. 배치 5-6개 이슈 × 2 리뷰 = 10-12 리뷰 호출
- 단일 Reviewer에게 "먼저 spec 준수를 확인하고, 통과하면 품질을 확인하라"는 지시로 **프롬프트 내 순차 검증** 가능
- 물리적 분리(2개 에이전트)보다 논리적 분리(1개 에이전트, 2패스)가 비용 효율적

**적용 방안:**
1. Reviewer 프롬프트에 **2패스 검증 구조** 도입:
   - Pass 1: "spec의 변경 파일 목록 vs 실제 diff 비교. 누락/초과 파일이 있으면 즉시 FAIL(spec 미준수)"
   - Pass 2 (Pass 1 통과 시만): "코드 품질, 아키텍처 일관성, 테스트 충분성 검증"
2. FAIL 사유를 구조화: `FAIL(spec-mismatch)` vs `FAIL(quality-issue)` → Worker 수정 지시가 더 정확
3. tip pool에 FAIL 사유별 카테고리 추가 (Ouroboros B안의 실패 패턴 분류와 연계)
4. **물리적 2-Stage (별도 에이전트 2회 호출)는 도입하지 않음** — 논리적 2-pass로 충분

**우선순위:** 중
- Reviewer 프롬프트 구조 변경으로 구현 가능
- A안(Verification) + B안(Status Protocol)과 결합하면 Worker→Reviewer 전체 품질 체인 강화

---

### 흡수하지 않는 것 (근거 포함)

#### X1. TDD 절대 강제 (RED-GREEN-REFACTOR)
- **Superpowers:** 코드보다 테스트 먼저 작성 절대 강제. 코드 먼저 쓰면 삭제 후 재시작. 15+ red flags
- **불채택 근거:** 우리 파이프라인은 **이슈 유형이 다양** — 리팩토링, 설정 변경, 문서 수정 등 TDD가 부적합한 이슈 다수. Superpowers는 단일 기능 구현에 최적화되어 TDD 강제가 자연스럽지만, N이슈 병렬 파이프라인에서 전체 이슈에 TDD 강제는 비현실적. 테스트 관련 이슈에만 선택적으로 적용하려면 이슈별 분기 로직 필요 → 복잡도 증가 대비 효용 불명확

#### X2. 멀티 플랫폼 지원 (Cursor/Codex/OpenCode/Gemini CLI)
- **Superpowers:** .claude-plugin/, .cursor-plugin/, .opencode/, .codex/ 등 멀티 플랫폼 설치 설정
- **불채택 근거:** 우리는 Claude Code 전용. pipeline-cli.mjs + Claude Code slash command 아키텍처가 다른 플랫폼과 호환되지 않음. 멀티 플랫폼은 Superpowers의 "프롬프트만으로 구성" 아키텍처에서 가능한 것이고, 우리처럼 Node.js CLI + 구조적 검증 게이트가 있으면 플랫폼별 포팅 비용이 큼

#### X3. Session-Start Hook으로 스킬 시스템 자동 주입
- **Superpowers:** hooks.json에서 startup/clear/compact 이벤트에 using-superpowers SKILL.md 자동 주입
- **불채택 근거:** 우리 시스템은 slash command로 명시적 호출. Hook 기반 자동 주입은 **모든 세션에 오버헤드** 추가 (22K+ 토큰). Superpowers도 Issue #190에서 이 문제 인지. 우리는 필요할 때만 `/basic-pipeline` 호출하는 것이 더 효율적

#### X4. Writing-Skills 메타스킬 전체
- **Superpowers:** 22,465바이트 메타스킬로 새 스킬 작성 방법론 체계화. Cialdini 설득 원칙, 허점 봉쇄 테이블, pressure-test 방법론
- **불채택 근거:** 우리 커맨드 파일은 12개로 안정화. 새 커맨드 추가 빈도가 낮아 메타스킬의 ROI 불확실. C안(합리화 방지 패턴)에서 핵심 원칙만 추출하여 기존 커맨드에 적용하는 것이 더 실용적

---

## 4. Open-SWE (langchain-ai/open-swe) — 2026-03-22 분석

**프로젝트 요약:** LangChain의 오픈소스 비동기 코딩 에이전트 프레임워크. 8K stars. Stripe(Minions), Ramp(Inspect), Coinbase(Cloudbot)가 독립적으로 발견한 패턴을 코드화. 4-그래프 아키텍처(Manager→Planner→Programmer→Reviewer). LangGraph 기반 상태 관리. Daytona/Modal 클라우드 샌드박스. Slack/Linear/GitHub 웹훅 트리거. Deep Agents 서브에이전트 오케스트레이션.

---

### 흡수 대상 아이디어

#### A. PR 생성 안전망 미들웨어 (Safety Net Middleware)

**현재 우리 구현:**
- Worker가 구현 완료 → PR 생성은 Worker의 프롬프트 지시에 의존
- Worker가 PR 생성을 빼먹으면 → Step 0의 고아 worktree 감지에서 사후 발견
- 사후 발견 시 복구 경로: 커밋 있으면 push → PR 생성, 없으면 삭제

**Open-SWE 구현:**
- `commit_and_open_pr` 도구: Worker가 명시적으로 호출
- `open_pr_if_needed` 미들웨어: Worker가 도구 호출을 잊어도 **자동으로 커밋 + PR 생성**
- 미들웨어가 에이전트 완료 시 uncommitted changes + unpushed commits 감지 → 자동 처리

**트레이드오프:**

| 관점 | 현재 (사후 발견) | Safety Net 미들웨어 |
|------|----------------|-------------------|
| **실패 방지** | 다음 실행 시 Step 0에서 발견 (지연) | 즉시 자동 처리 (실시간) |
| **데이터 손실** | worktree 삭제 시 미커밋 변경 유실 가능 | 미커밋 변경도 자동 커밋 |
| **구현 비용** | Step 0 이미 구현됨 | Worker 프롬프트에 강제 지시 추가 or Hook 활용 |
| **신뢰도** | Step 0이 다음 파이프라인 실행에서만 동작 | Worker 완료 즉시 동작 |

**근거 — 흡수하는 이유:**
Step 0 고아 worktree 감지는 **다음 파이프라인 실행에서야** 발견. 현재 파이프라인 실행 중에 Worker가 PR 생성을 빼먹으면 해당 배치의 결과가 누락. Worker 완료 직후 PR 존재 확인 → 미존재 시 자동 생성이 더 안전.

**적용 방안:**
1. `basic-agents.md`에서 Worker 완료 후 오케스트레이터가 PR 존재 확인 단계 추가:
   - `gh pr list --head <branch>` → 결과 없으면 → `gh pr create` 자동 실행
2. 또는 Worker 프롬프트에 "마지막 단계: PR 생성 확인. PR이 없으면 반드시 생성" 강제
3. **미들웨어 패턴 자체는 도입하지 않음** — Claude Code 환경에서 미들웨어 개념이 없으므로 프롬프트 + 오케스트레이터 검증으로 대체

**우선순위:** 중
- Worker가 PR 생성을 빼먹는 빈도에 따라 우선순위 변동
- 구현 비용 낮음 (프롬프트 1줄 + 오케스트레이터 검증 1단계)

---

#### B. 계획 승인 게이트 (Human-in-the-Loop Plan Approval)

**현재 우리 구현:**
- `/basic-pipeline --confirm`: 전체 파이프라인 실행 시 각 phase 전환점에서 사용자 확인
- `/basic-pipeline` (confirm 없이): phase 자동 전환 — 사용자 개입 없음
- spec 내용 자체에 대한 사용자 승인 게이트 없음 — spec 작성 후 바로 배치 계획으로 진행

**Open-SWE 구현:**
- Planner 그래프가 계획 작성 → LangGraph `interrupt()` → 사용자에게 계획 제시 → 수정/승인/거부 선택 → 승인 후에만 Programmer 진행
- Slack/Linear에서 사용자가 계획을 보고 코멘트로 수정 지시 가능
- 실행 중에도 `check_message_queue_before_model` 미들웨어로 사용자 메시지 주입 가능

**트레이드오프:**

| 관점 | 현재 (phase 단위 확인) | 계획 내용 승인 |
|------|---------------------|---------------|
| **자동화 수준** | 높음 — confirm 없이 전자동 가능 | 중간 — 계획마다 사람 승인 대기 |
| **안전성** | spec 부실이 Worker 실패로 전파 | spec 시점에서 사람이 걸러냄 |
| **속도** | 빠름 — 중단 없이 진행 | 사람 응답 대기 시간 추가 |
| **적합 시나리오** | 다수 이슈 일괄 처리 | 소수 중요 이슈 신중 처리 |

**근거 — 흡수하는 이유:**
`priority:high` 이슈는 실패 비용이 높음. 현재는 high priority 이슈도 spec → 배치 → 실행까지 사람 검토 없이 진행 가능. Open-SWE의 계획 승인 게이트를 **high priority 이슈에만 선택적으로** 적용하면 안전성 향상.

**근거 — 전체 이슈에 적용하지 않는 이유:**
- 우리 파이프라인의 핵심 가치는 **N이슈 일괄 자동 처리**. 모든 이슈에 승인 게이트를 넣으면 자동화 이점 상실
- medium/low priority 이슈는 FAIL → BLOCKED → 사용자 에스컬레이션으로 충분

**적용 방안:**
1. `basic-review-issues`에서 `priority:high` 이슈의 spec을 별도 출력 → 사용자 확인 요청
2. `--confirm` 모드에서 spec 내용 표시 + "이 spec으로 진행하시겠습니까?" 게이트 추가
3. non-confirm 모드에서는 기존과 동일 (자동 진행)
4. **실행 중 메시지 주입, LangGraph interrupt() 패턴은 도입하지 않음**

**우선순위:** 낮
- `--confirm` 모드가 이미 phase 단위 확인 제공
- high priority 이슈의 spec 품질 문제가 실제로 발생할 때 재평가

---

#### C. 모델 폴백 체인 (Fallback Runnable)

**현재 우리 구현:**
- Claude Code 전용 — 모델 실패 시 폴백 없음
- Anthropic API 장애 시 전체 파이프라인 중단
- 200K/1M 티어 선택은 있지만 장애 시 자동 전환 아님

**Open-SWE 구현:**
- `FallbackRunnable`: Claude Opus 4 → GPT 모델 → Gemini 순서로 자동 폴백
- 트리거별 다른 모델: Slack(빠른 모델) vs GitHub 이슈(강력한 모델)
- GitHub 토큰 갱신도 phase 전환 시 자동 처리

**트레이드오프:**

| 관점 | 현재 (단일 모델) | 폴백 체인 |
|------|----------------|----------|
| **가용성** | Anthropic 장애 = 전체 중단 | 3개 프로바이더 중 1개만 살아있으면 동작 |
| **일관성** | 항상 같은 모델 = 예측 가능한 품질 | 폴백 모델 품질 차이 → 결과 변동 |
| **구현 비용** | 0 | 멀티 프로바이더 API 키 + 폴백 로직 |
| **비용** | Claude 단일 과금 | 폴백 시 다른 프로바이더 과금 |

**근거 — 흡수하지만 경량으로 한정하는 이유:**
전체 멀티 프로바이더 폴백은 Claude Code 아키텍처에서 불가능 (Claude Code는 Anthropic 모델만 사용). 다만 **Opus → Sonnet 폴백** 개념은 적용 가능 — Opus 에이전트 실패 시 Sonnet으로 재시도. 이미 200K/1M 티어가 있으므로 확장 자연스러움.

**적용 방안:**
1. 1M 티어에서 Opus 에이전트 실패(컨텍스트 과다, 타임아웃 등) 시 200K 티어 Sonnet으로 자동 폴백
2. `basic-agents`에서 Worker 에이전트 스폰 시 `model: "opus"` → 실패 → `model: "sonnet"` 재시도
3. **멀티 프로바이더(GPT/Gemini) 폴백은 도입하지 않음** — Claude Code 생태계 내 폴백으로 한정

**우선순위:** 낮
- Anthropic API 안정성이 높아 폴백 필요 빈도 낮음
- 실제 Opus 실패 경험이 있으면 우선순위 상향

---

### 흡수하지 않는 것 (근거 포함)

#### X1. 클라우드 샌드박스 실행 (Daytona/Modal/gVisor)
- **Open-SWE:** 모든 실행이 원격 클라우드 컨테이너에서 수행. 네트워크 격리, gVisor syscall 필터링
- **불채택 근거:** 우리는 **로컬 Git Worktree 기반**. 클라우드 샌드박스는 인프라 비용 + 설정 복잡도 + 네트워크 지연 추가. Worktree는 0비용 + 즉시 생성 + 파일시스템 공유로 빠름. 보안 격리가 필요한 시나리오(신뢰할 수 없는 코드 실행)가 아닌 이상 Worktree가 적합

#### X2. 웹훅 기반 트리거 (Slack/Linear/GitHub)
- **Open-SWE:** Slack 멘션, Linear 코멘트, GitHub 태그로 자동 트리거
- **불채택 근거:** 우리 시스템은 **개발자가 터미널에서 능동적으로 실행**하는 모델. 웹훅 트리거는 서버 인프라(항상 실행 중인 API 서버) 필요. Claude Code CLI 기반 아키텍처와 근본적으로 다른 배포 모델. 자동 트리거가 필요해지면 GitHub Actions + `/basic-pipeline` 조합으로 대체 가능

#### X3. LangGraph 기반 그래프 오케스트레이션
- **Open-SWE:** Manager→Planner→Programmer→Reviewer가 LangGraph 그래프로 연결, 상태 자동 전파
- **불채택 근거:** 우리 파이프라인은 **Markdown 커맨드 + Node.js CLI** 조합. LangGraph 도입은 Python 의존성 + 프레임워크 전환. 현재 pipeline-cli.mjs의 phase 상태 머신이 동일 역할을 더 경량으로 수행. LangGraph의 이점(체크포인팅, 인터럽트)은 우리 규모에서 과잉

#### X4. Deep Agents 서브에이전트 프레임워크
- **Open-SWE:** LangChain의 Deep Agents `task` 도구로 서브에이전트 스폰, 각자 격리된 컨텍스트
- **불채택 근거:** Claude Code의 네이티브 `Agent` 도구가 동일 기능 제공 (worktree 격리 포함). 별도 프레임워크 불필요. Deep Agents의 이점(미들웨어 스택, todo 도구)은 Claude Code에 이미 동등물 존재

#### X5. 실행 중 사용자 메시지 주입
- **Open-SWE:** `check_message_queue_before_model` 미들웨어가 실행 중 에이전트에 사용자 코멘트 주입
- **불채택 근거:** Claude Code는 **동기적 대화형** — 사용자가 실행 중 개입하려면 에이전트를 중단하고 새 메시지를 보내면 됨. 비동기 큐잉은 비동기 실행 모델(Open-SWE)에서만 필요

---

## 5. MetaGPT (FoundationAgents/MetaGPT) — 2026-03-22 분석

**프로젝트 요약:** 65.8K stars. "Code = SOP(Team)" — LLM 에이전트들이 소프트웨어 회사 역할(PM, Architect, Project Manager, Engineer, QA)을 수행하는 멀티 에이전트 프레임워크. Publish-Subscribe 메시지 시스템으로 역할 간 구조화된 문서 전달. 순차 조립 라인 방식. ICLR 2024 구두 발표(상위 1.2%). 토큰 효율성: 코드 1줄당 126.5 토큰(ChatDev 248.9 대비 2배 효율).

---

### 흡수 대상 아이디어

#### A. 구조화된 중간 산출물 (Structured Intermediate Artifacts)

**현재 우리 구현:**
- Phase 간 전달: pipeline-state.json의 output 필드 (스키마 검증 있음)
- spec은 GitHub Issue body에 자유 형식 Markdown
- Worker → Reviewer 전달: PR diff (구조화되지 않은 코드 변경)
- Phase 간 산출물 형식이 암묵적 — spec 형식은 프롬프트로만 제안, 강제 아님

**MetaGPT 구현:**
- 각 역할의 출력이 **정형화된 문서**: PRD(product goals, user stories, requirement pool), API 설계(파일 목록, 데이터 구조, 인터페이스 정의, 시퀀스 다이어그램)
- `instruct_content: Optional[BaseModel]` — Pydantic 타입으로 구조화된 데이터
- 구조화된 형식이 **다음 역할의 자유도를 제약** → 할루시네이션 전파 방지
- 각 단계의 출력이 다음 단계의 입력을 **명시적으로 제한**

**트레이드오프:**

| 관점 | 현재 (자유 형식 Markdown) | 구조화된 산출물 |
|------|------------------------|---------------|
| **유연성** | spec 형식이 유연 → 다양한 이슈 유형 수용 | 고정 스키마 → 이슈 유형별 스키마 필요 |
| **정확도** | Markdown 파싱 의존 → MIS에서 변경 파일 추출 시 정규식 | 타입 안전 → 파싱 오류 없음 |
| **할루시네이션 전파** | spec 부실 → Worker 자유 해석 → 실패 | 스키마 제약 → 해석 여지 최소화 |
| **구현 비용** | 0 | spec 스키마 정의 + 검증 로직 필요 |
| **LLM 준수율** | "이 형식으로 써라" 지시 무시 가능 | JSON Schema 강제 시 형식 보장 |

**근거 — 흡수하는 이유:**
현재 MIS 알고리즘이 `### 변경 파일 목록`을 **정규식으로 파싱**하는데, spec 작성 시 이 섹션 형식이 흔들리면 MIS가 파일 충돌을 놓침. MetaGPT의 교훈: "구조화된 산출물이 자유 형식 대화보다 할루시네이션 전파를 효과적으로 차단." spec 중 핵심 필드(변경 파일 목록, 의존 이슈)만 구조화하면 MIS 정확도 향상.

**적용 방안:**
1. `basic-spec`에서 변경 파일 목록과 의존 이슈를 **JSON 코드블록**으로 강제:
   ```json
   { "write_files": ["src/api/router.ts", "src/types/index.ts"], "depends_on": [12, 15] }
   ```
2. `basic-review-issues`에서 JSON 파싱으로 MIS 입력 추출 (정규식 대체)
3. pipeline-cli.mjs에 spec JSON 검증 커맨드 추가 (선택적)
4. **전체 Pydantic 스키마, 역할별 출력 타입, ActionNode 의존 그래프는 도입하지 않음**

**우선순위:** 중
- MIS 파싱 오류가 발생한 적 있으면 즉시 도입
- spec 형식 안정성이 높으면 현행 유지

---

#### B. 실행 가능한 피드백 루프 (Executable Feedback Loop)

**현재 우리 구현:**
- Worker가 코드 작성 → PR push → CI에서 테스트 실행 → 결과 확인
- Worker 내부에서 테스트 실행 여부는 Worker LLM의 판단에 의존
- CI 실패 시 auto-loop (format/lint 자동 수정, test/build는 에러 메시지 주입)
- Worker가 **자체적으로 테스트를 실행하고 디버깅하는 루프가 명시적으로 강제되지 않음**

**MetaGPT 구현:**
- Engineer 역할에 내장된 실행-디버그 루프:
  1. 코드 생성 → 즉시 실행
  2. 에러 발생 → PRD + 설계 문서 + 이전 시도 기록을 컨텍스트로 읽음
  3. 디버그 → 재실행 (최대 3회)
- HumanEval/MBPP에서 이 루프만으로 pass rate 4-5% 향상

**트레이드오프:**

| 관점 | 현재 (CI 의존) | Worker 내 실행-디버그 루프 |
|------|-------------|------------------------|
| **피드백 속도** | CI 실행 대기 (분 단위) | 즉시 (Worker 내에서 초 단위) |
| **디버그 정확도** | CI 에러 로그 → Worker 해석 | Worker가 직접 에러 보고 재현 가능 |
| **비용** | CI 1회 + Worker 재실행 비용 | Worker 내 추가 실행 비용 (경미) |
| **환경 일치** | CI 환경 = 프로덕션 환경 (정확) | Worker 환경 ≠ CI 환경 (불일치 가능) |

**근거 — 흡수하는 이유:**
Superpowers의 Verification-before-Completion(3A안)과 결합하면 상승 효과. Worker가 PR push **전에** 로컬에서 테스트 실행 → 실패 시 자체 수정 → 성공 후에만 push. CI 왕복 시간 절감 + FAIL 감소.

**적용 방안:**
1. Worker 프롬프트에 "PR push 전 필수 실행" 체크리스트 추가:
   - `npm test` (또는 프로젝트 테스트 명령) 실행 → 실패 시 수정 → 최대 3회 → 그래도 실패 시 BLOCKED 보고
   - `npm run build` 성공 확인
2. Superpowers 3A(증거 요구)와 통합: 테스트 실행 결과를 PR description에 첨부
3. **MetaGPT의 디버깅 메모리(이전 시도 기록 참조)는 도입하지 않음** — Worker 컨텍스트 내에서 자연스럽게 이전 시도 인지

**우선순위:** 상
- Verification-before-Completion과 같은 프롬프트 편집으로 즉시 적용
- CI 왕복 비용 절감 효과 큼

---

### 흡수하지 않는 것 (근거 포함)

#### X1. Publish-Subscribe 메시지 시스템
- **MetaGPT:** `_watch([ActionClass])` + 글로벌 메시지 풀로 역할 간 디커플링
- **불채택 근거:** 우리 파이프라인은 **선형 phase 순서**가 코드로 강제(pipeline-cli.mjs). pub-sub는 동적 역할 추가/제거가 필요한 경우에 가치 있지만, 우리 6-phase 고정 파이프라인에선 과잉. phase 순서가 이미 명시적

#### X2. 역할 기반 에이전트 시스템 (PM, Architect, Engineer, QA)
- **MetaGPT:** 5개 고정 역할이 순차적으로 문서 생성
- **불채택 근거:** 우리는 **이슈가 이미 존재**하는 상태에서 시작. PM/Architect 역할은 이슈 생성 이전 단계. `/basic-audit`과 `/basic-discover`가 이슈 생성을 담당하지만, 이것은 역할 시뮬레이션이 아니라 코드 분석. MetaGPT의 역할 시스템은 greenfield 프로젝트에 최적화되어 있고, 기존 코드베이스 작업에는 취약(공식 인정)

#### X3. 비용 상한 관리 (`Team.invest()`)
- **MetaGPT:** `max_budget` 설정 → `NoMoneyException` 발생으로 강제 중단
- **불채택 근거:** Claude Code는 API가 아닌 CLI 도구. 토큰 비용을 코드 레벨에서 제어할 수 없음. Claude Code 자체의 비용 제한(Max 플랜 등)이 외부에서 관리. pipeline-cli.mjs에서 비용 추적을 추가하려면 Claude Code 세션 비용을 파싱해야 하는데, 현재 JSONL 접근이 제한적

#### X4. QA Engineer 역할 (독립 테스트 생성)
- **MetaGPT:** Worker(Engineer)와 별도로 QA가 독립적으로 테스트 작성 → 크로스 검증
- **불채택 근거:** 우리 Reviewer가 이미 구현 검증 역할. 별도 QA 에이전트 추가는 LLM 비용 2배. MetaGPT의 QA는 "코드 작성자와 다른 관점의 테스트"를 제공하지만, LLM은 같은 모델이므로 **진정한 독립 관점이 아님**. L2 Opus 리뷰가 이미 최고 수준의 단일 모델 검증

---

## 6. SWE-agent (SWE-agent/SWE-agent) — 2026-03-22 분석

**프로젝트 요약:** 18.8K stars. Princeton/Stanford. NeurIPS 2024. 핵심 혁신: ACI(Agent-Computer Interface) — LLM에 최적화된 커스텀 도구 세트(windowed viewer, str_replace editor, linter-gated editing). GitHub 이슈 → 패치 자동 생성. 후속 프로젝트 mini-SWE-agent(100줄)가 원본을 능가(74%+ SWE-bench Verified). 핵심 교훈: "모델이 똑똑해지면 스캐폴딩은 단순해져도 된다."

---

### 흡수 대상 아이디어

#### A. Linter-Gated Editing (편집 시 구문 검증 게이트)

**현재 우리 구현:**
- Worker가 자유롭게 파일 편집 → 구문 오류가 있어도 커밋 가능
- CI에서 lint 실패 → auto-loop로 수정 (최대 2회)
- 잘못된 편집이 **커밋된 후에야** 발견 → 롤백 비용 발생

**SWE-agent 구현:**
- `str_replace` 편집 시 **자동 linter 실행**
- 구문 오류가 있으면 **편집 자체를 거부** + 정확한 에러 메시지 반환
- 잘못된 편집이 파일에 반영되지 않음 → 캐스케이딩 실패 방지
- ablation 결과: linter-gated editing이 **가장 높은 영향력** 구성 요소 중 하나

**트레이드오프:**

| 관점 | 현재 (CI 사후 검증) | Linter-Gated Editing |
|------|-------------------|---------------------|
| **실패 감지 시점** | 커밋 후 CI에서 (늦음) | 편집 시점에서 즉시 (빠름) |
| **캐스케이딩 방지** | 잘못된 편집 위에 추가 편집 가능 | 잘못된 편집 차단 → 깨끗한 상태 유지 |
| **구현 가능성** | N/A | Claude Code 자체에 lint hook 설정 필요 |
| **Agent 레벨 제어** | Worker 프롬프트로만 "lint 실행해라" 지시 | 시스템 레벨에서 강제 |

**근거 — 흡수하는 이유:**
SWE-agent의 ablation에서 **가장 영향력 높은 기법** 중 하나로 검증. Worker가 구문 오류 있는 코드를 작성 → 그 위에 추가 코드 작성 → 점점 더 꼬임 → FAIL. 이 캐스케이딩 실패는 우리 시스템에서도 발생 가능. 시스템 레벨 강제는 어렵지만, Worker 프롬프트에 "편집 후 즉시 lint 실행, 실패 시 편집 취소 후 재시도" 패턴 삽입 가능.

**적용 방안:**
1. Worker 프롬프트에 **편집-검증 패턴** 추가:
   - "파일 편집 후 반드시 lint 명령 실행. lint 실패 시 편집을 되돌리고(git checkout -- file) 다시 시도하라"
   - "구문 오류가 있는 상태에서 다른 파일 편집으로 넘어가지 마라"
2. CI auto-loop의 format/lint 자동 수정을 **Worker 레벨로 전진 배치** (CI 도달 전에 해결)
3. 장기: Claude Code Hook(PreToolUse)으로 Edit 도구 호출 후 자동 lint 실행 가능 여부 검토
4. **SWE-agent의 커스텀 str_replace 도구, windowed viewer는 도입하지 않음** — Claude Code에 이미 동등 도구 존재

**우선순위:** 중
- 프롬프트 패턴으로 즉시 적용 가능
- MetaGPT의 실행 피드백 루프(5B)와 결합하면 "편집→검증→실행→검증" 전체 품질 체인 강화

---

#### B. 컨텍스트 스노우볼 방지 (Context Management)

**현재 우리 구현:**
- Worker는 Claude Code Agent로 스폰 — 컨텍스트 관리는 Claude Code 내부에 위임
- 배치 내 여러 이슈를 처리할 때 Worker의 컨텍스트가 누적됨
- 실패한 시도의 컨텍스트도 누적 → 성공 사례 대비 **4배 토큰 소비** (SWE-agent 데이터)
- 사용자가 200-300K에서 /clear하는 것은 이 문제의 수동 대응

**SWE-agent 구현:**
- `Context_t = Sum(i=t-5 to t) G_i` — 최근 5 step만 전체 유지, 이전은 압축/삭제
- 검색 결과 50개 상한 → 컨텍스트 오버플로 방지
- 파일 뷰어 100줄 윈도우 → 전체 파일 로딩 방지
- 실패 사례: 8.8M 토큰 + 658초 vs 성공: 1.8M 토큰 + 167초

**트레이드오프:**

| 관점 | 현재 (Claude Code 위임) | 명시적 컨텍스트 관리 |
|------|----------------------|-------------------|
| **제어** | Claude Code 자동 압축에 의존 | Worker 프롬프트로 행동 제한 |
| **품질** | 긴 세션에서 주의력 저하 | 최근 컨텍스트에 집중 유지 |
| **구현** | 0 | Worker 프롬프트에 지시 추가 |
| **유연성** | 필요 시 전체 히스토리 참조 가능 | 오래된 컨텍스트 접근 불가 |

**근거 — 흡수하는 이유:**
SWE-agent 데이터에서 실패 시 4배 토큰 소비는 **우리 Worker에서도 동일하게 발생**할 가능성 높음. FAIL 1 → 재시도에서 이전 실패의 컨텍스트가 누적되면 재시도 품질도 저하. Worker에게 "이전 시도의 에러 원인만 참고하고, 코드 자체는 파일에서 다시 읽어라"는 지시로 스노우볼 완화 가능.

**적용 방안:**
1. Worker 프롬프트에 컨텍스트 위생 지시 추가:
   - "이전 시도에서 실패한 코드를 기억에서 참조하지 마라. 항상 파일에서 현재 상태를 다시 읽어라"
   - "검색 결과가 많으면 상위 5개만 확인하라"
2. FAIL 1 → 재시도 시 Reviewer의 수정 지시서만 전달하고 이전 Worker의 전체 대화는 전달하지 않음 (이미 fresh Agent 스폰이라 자연스러움)
3. **SWE-agent의 히스토리 압축 알고리즘, windowed viewer 크기 제한은 도입하지 않음** — Claude Code 내부 메커니즘이 이미 유사 역할

**우선순위:** 낮
- fresh Agent 스폰(현재 방식)이 이미 컨텍스트 초기화 역할
- FAIL 1 재시도에서 스노우볼이 관찰되면 우선순위 상향

---

#### C. mini-SWE-agent의 교훈: 스캐폴딩 단순화

**핵심 인사이트 (흡수 대상은 "아이디어"가 아닌 "설계 원칙"):**

SWE-agent → mini-SWE-agent 진화가 증명한 것:
- **원본 SWE-agent:** 커스텀 ACI 도구 6개 + 구성 YAML + 히스토리 압축 → 12.47% (GPT-4 Turbo)
- **mini-SWE-agent (100줄):** bash 도구 1개만 → 74%+ (Gemini 3 Pro)
- **교훈: 모델이 똑똑해지면 스캐폴딩은 단순해져도 된다**

우리 시스템에 대한 함의:
- pipeline-cli.mjs의 phase 검증은 **유지해야 할 스캐폴딩** (LLM 판단에 맡기면 안 되는 것)
- Worker 프롬프트의 세밀한 단계별 지시는 **점진적으로 줄여볼 수 있는 스캐폴딩**
- 200K 티어의 추가 제약(body 미포함, 의존성 선행만 등)은 모델 능력 향상 시 재평가 대상

**적용 방안:** 즉시 적용 아님. 다음 모델 업그레이드(Opus 5 등) 시 Worker 프롬프트 단순화 실험 수행. "지시를 줄여도 성공률이 유지되는가?" A/B 테스트.

**우선순위:** 관찰 — 모델 업그레이드 시 재평가

---

### 흡수하지 않는 것 (근거 포함)

#### X1. 커스텀 ACI 도구 (find_file, search_file, windowed viewer 등)
- **SWE-agent:** LLM에 최적화된 6개 커스텀 도구로 코드 탐색/편집
- **불채택 근거:** Claude Code에 이미 동등 도구 존재(Glob, Grep, Read, Edit). mini-SWE-agent가 bash 1개로 원본을 능가한 것이 커스텀 도구의 한계를 증명. Claude Code의 네이티브 도구가 이미 충분히 최적화됨

#### X2. Docker 컨테이너 샌드박스
- **SWE-agent:** 모든 실행을 Docker 컨테이너 내에서 수행
- **불채택 근거:** Container Use(7번) 분석과 동일. 우리는 로컬 Git Worktree 기반. 코드 편집 + 테스트 실행 수준에서 Docker 격리는 과잉

#### X3. 재현 스크립트 작성 패턴
- **SWE-agent:** 버그 수정 전에 반드시 재현 스크립트 작성 → 실행 → 버그 확인 → 수정 → 재실행
- **불채택 근거:** 우리 파이프라인은 버그 수정 전용이 아님. 기능 추가, 리팩토링, 설정 변경 등 다양한 이슈 유형 처리. 재현 스크립트는 버그 이슈에만 적용 가능하고, 이슈 유형별 분기를 추가하면 Worker 프롬프트 복잡도 급증. 테스트 실행(5B안)이 더 범용적

---

## 7. Container Use (dagger/container-use) — 2026-03-22 분석

**프로젝트 요약:** 3.7K stars. Solomon Hykes(Docker 창시자) + Dagger. Go 기반 MCP 서버 + CLI. 에이전트별 독립 컨테이너(branch + worktree + Dagger container 3레이어 격리). 13개 MCP 도구 노출. 모든 파일 작업이 자동 git 커밋. 명령 히스토리를 git notes에 저장. Apache 2.0.

---

### 흡수 대상 아이디어

#### A. 자동 커밋 + 명령 히스토리 추적 (Auto-Commit & Audit Trail)

**현재 우리 구현:**
- Worker가 자유롭게 편집 → 명시적 `git commit` 필요
- Worker가 커밋을 빼먹으면 → worktree 정리 시 미커밋 변경 유실 가능
- 편집 히스토리: git log에 Worker의 커밋 메시지만 존재
- Worker가 어떤 명령을 실행했는지 추적 불가 (Claude Code 세션 로그에만 존재)

**Container Use 구현:**
- 모든 `file_write`, `file_edit`, `file_delete` → **자동 git 커밋** (에이전트가 커밋을 잊을 수 없음)
- 명령 실행 히스토리 → `refs/notes/execution-log` (git notes)
- 컨테이너 상태 → `refs/notes/container-use` (git notes)
- `cu log` 명령으로 에이전트의 전체 작업 이력 조회 가능

**트레이드오프:**

| 관점 | 현재 (Worker 자율 커밋) | 자동 커밋 + git notes |
|------|---------------------|---------------------|
| **데이터 안전** | 미커밋 변경 유실 가능 | 모든 변경이 즉시 커밋 |
| **커밋 품질** | Worker가 의미 있는 커밋 메시지 작성 | 자동 커밋 = 무의미한 커밋 메시지 다수 |
| **감사 추적** | git log만 | git log + 명령 히스토리 + 상태 로그 |
| **git 히스토리** | 깔끔 (의도적 커밋만) | 노이즈 (자동 커밋 다수) |
| **구현 비용** | 0 | Claude Code Hook or 프롬프트 지시 |

**근거 — 흡수하지만 경량으로 한정하는 이유:**
전체 자동 커밋은 git 히스토리를 오염시킴 (PR에 수십 개 미니 커밋). Container Use는 `cu apply`(squash merge)로 해결하지만, 우리는 Worker PR이 그대로 머지됨. **핵심만 추출**: Worker가 "의미 있는 단위마다 커밋하라"는 강화된 지시 + PR push 전 squash.

**적용 방안:**
1. Worker 프롬프트에 "구현 단계마다 커밋. 커밋 없이 3개 이상 파일 편집하지 마라" 지시 강화
2. PR 생성 전 squash 옵션: `git rebase -i` 또는 GitHub PR squash merge 활용
3. **자동 커밋, git notes, 명령 히스토리 추적은 도입하지 않음** — git 히스토리 오염 방지

**우선순위:** 낮
- 현재 Worker가 커밋을 빼먹는 빈도에 따라 변동
- Open-SWE의 PR 안전망(4A)과 결합하면 커밋+PR 누락 방지 체인 완성

---

#### B. Worktree + Container 하이브리드 격리 (아키텍처 참조)

**현재 우리 구현:**
- Git Worktree만 사용 → **파일 격리만**, 런타임(포트, 프로세스, 패키지) 격리 없음
- Worker가 테스트 서버를 3000번 포트에 띄우면 다른 Worker와 충돌 가능
- DB 테스트가 같은 로컬 DB를 사용하면 데이터 충돌 가능

**Container Use 구현:**
- 3레이어: Branch(git 격리) + Worktree(파일 격리) + Container(런타임 격리)
- 각 에이전트가 독립 포트, 독립 패키지, 독립 프로세스
- 서비스 모델: `environment_add_service`로 사이드카 컨테이너(PostgreSQL, Redis 등) 추가
- 대가: 컨테이너 시작 시간(수 초~수십 초) + 리소스 소비(CPU/RAM per container)

**트레이드오프:**

| 관점 | Worktree만 | Worktree + Container |
|------|-----------|---------------------|
| **파일 격리** | O | O |
| **런타임 격리** | X (포트/프로세스/패키지 공유) | O (완전 격리) |
| **시작 속도** | ~50-100ms | 수 초~수십 초 |
| **리소스 비용** | 디스크만 | CPU + RAM per container |
| **설정 복잡도** | `git worktree add` 1줄 | Docker + Dagger Engine + CLI |
| **적합 시나리오** | 코드 편집 + 테스트 실행 (서버 불필요) | 서버 실행 + DB 테스트 + 포트 사용 |

**근거 — 관찰 대상으로 분류하는 이유:**
현재 Worker들이 주로 **코드 편집 + 유닛 테스트** 수준이면 Worktree만으로 충분. 하지만 통합 테스트(서버 실행, DB 접근)를 Worker가 수행해야 하는 이슈가 늘어나면 Container 격리가 필요해짐. Solomon Hykes의 통찰: "Worktree는 코드를 격리하지만 런타임을 격리하지 않는다."

**적용 방안:** 즉시 적용 아님. 모니터링 대상:
- Worker 간 포트 충돌이 발생하는가?
- 동일 DB에 동시 접근하는 이슈가 배치에 포함되는가?
- 발생 시 Container Use MCP 서버 도입 검토

**우선순위:** 관찰 — 런타임 격리 필요성 발생 시 재평가

---

### 흡수하지 않는 것 (근거 포함)

#### X1. Dagger Engine 의존성
- **Container Use:** 모든 컨테이너 작업이 Dagger Engine 경유 (Docker 직접 사용 안 함)
- **불채택 근거:** Dagger Engine은 추가 인프라 의존성. 우리 시스템은 **의존성 최소화**(Node.js CLI + Git + GitHub CLI). Docker가 필요해지면 Docker 직접 사용이 더 단순

#### X2. MCP 서버 기반 파일/실행 도구
- **Container Use:** 13개 MCP 도구로 파일 읽기/쓰기/편집/실행 모두 수행
- **불채택 근거:** Claude Code에 이미 네이티브 도구(Read, Edit, Write, Bash) 존재. MCP 서버 경유는 불필요한 간접층. Container Use의 MCP 도구는 **컨테이너 내부에서 실행**하기 위한 것이므로, 컨테이너를 사용하지 않는 한 불필요

#### X3. 브랜치 자동 네이밍 (env-{name}/{petname})
- **Container Use:** `env-refactor/brave-badger` 형태의 자동 브랜치명
- **불채택 근거:** 우리는 이슈 번호 기반 브랜치명(`fix/batch-a`, `feat/issue-42`)이 더 추적 가능. petname은 디버깅 시 "어떤 에이전트가 어떤 이슈를 처리했는지" 역추적이 어려움

---

## 8. Sweep AI (sweepai/sweep) — 2026-03-22 분석

**프로젝트 요약:** 7.6K stars. 원조 "GitHub Issue → PR" 자동화 에이전트. 하이브리드 검색(벡터 + 커스텀 TF-IDF + AST 이분 그래프). 토폴로지 정렬 기반 멀티 파일 편집. 캐스케이딩 diff 패턴. 컨텍스트 윈도우 최적화(10-15K 토큰 sweet spot). 2025년 이후 JetBrains 피벗, 유지보수 감소.

---

### 흡수 대상 아이디어

#### A. 캐스케이딩 Diff 패턴 (이전 편집의 diff를 다음 편집에 전달)

**현재 우리 구현:**
- Worker가 여러 파일을 순차 편집 → 각 편집은 독립적
- 파일 A에서 함수 시그니처 변경 → 파일 B(호출자) 편집 시 파일 A의 변경을 Worker가 **기억에서 참조** (컨텍스트에 의존)
- 파일 수가 많아지면 이전 편집 내용이 컨텍스트에서 밀려남 → 불일치 발생 가능

**Sweep 구현:**
- 파일을 **import 의존성 기준 토폴로지 정렬**로 편집 순서 결정
- 각 파일 편집 후 diff를 추출 → 다음 파일 편집 프롬프트에 **명시적으로 주입**
- 파일 B 편집 시: "파일 A에서 이 변경이 있었다: [diff]. 이를 반영하라"
- 이전 diff를 LLM 기억이 아닌 **구조화된 데이터**로 전달

**트레이드오프:**

| 관점 | 현재 (컨텍스트 기억 의존) | 캐스케이딩 Diff |
|------|----------------------|----------------|
| **일관성** | 파일 많으면 이전 변경 잊을 수 있음 | 명시적 diff 전달 → 일관성 보장 |
| **토큰 비용** | 0 추가 | diff 텍스트를 프롬프트에 추가 → 약간 증가 |
| **구현** | Worker 프롬프트만 | Worker 프롬프트에 편집 순서 + diff 전달 지시 |
| **적용 범위** | 모든 이슈 | 멀티 파일 변경 이슈에만 의미 있음 |

**근거 — 흡수하는 이유:**
spec에 "변경 파일 목록"이 있으므로, Worker에게 "이 순서대로 편집하고, 이전 파일의 변경 사항을 참조해서 다음 파일을 편집하라"고 지시하면 멀티 파일 일관성 향상. 특히 타입 정의 변경 → 사용처 변경 같은 cascading 패턴에서 효과적.

**적용 방안:**
1. Worker 프롬프트에 편집 순서 가이드 추가:
   - "타입 정의/인터페이스 파일 먼저 편집 → 구현 파일 → 테스트 파일 순서로 진행"
   - "이전 파일에서 시그니처를 변경했으면, 다음 파일 편집 시 해당 변경을 반영하라"
2. spec의 변경 파일 목록에 **편집 순서 힌트** 추가 (의존성 기반)
3. **Sweep의 AST 이분 그래프, 토폴로지 정렬 알고리즘은 도입하지 않음** — 프롬프트 수준 가이드로 충분

**우선순위:** 낮
- 멀티 파일 변경에서 불일치가 관찰되면 우선순위 상향
- 현재 Worker가 Claude Code의 컨텍스트 내에서 이전 편집을 잘 기억하는 경우 불필요

---

#### B. 컨텍스트 윈도우 Sweet Spot (10-15K 토큰)

**핵심 인사이트 (설계 원칙):**

Sweep이 발견한 것: LLM 판단 품질은 컨텍스트 **10-15K 토큰**에서 최고, 20K 이상에서 급격 저하 ("lost-in-the-middle" 효과). 이것은 **최대한 많이 넣으면 좋다**는 직관과 반대.

우리 시스템에 대한 함의:
- 1M 컨텍스트 티어에서 full spec text를 오케스트레이터에 전달하는 것이 **주의력 희석**을 유발할 수 있음
- Worker에게 전체 코드베이스 대신 **관련 코드 스니펫만** 전달하는 것이 더 효과적
- 이미 `harness-file-strategy.md`에서 "1M: 주의력 희석이 병목" 으로 인식 — Sweep의 데이터가 이를 뒷받침

**적용 방안:** 이미 인식된 문제. 1M 티어 Worker 프롬프트에서 "전체 파일 대신 변경 대상 함수/클래스만 집중" 지시 강화 검토.

**우선순위:** 관찰 — harness-file-strategy.md의 1M 최적화 방향과 연계

---

### 흡수하지 않는 것 (근거 포함)

#### X1. 벡터 검색 + 커스텀 TF-IDF 하이브리드
- **Sweep:** 임베딩 기반 시맨틱 검색 + 코드 토크나이징 TF-IDF
- **불채택 근거:** 우리 Worker는 Claude Code의 Grep/Glob 도구를 직접 사용. 벡터 DB 인프라 불필요. Claude Code의 코드 탐색이 이미 충분히 효과적

#### X2. AST 기반 이분 그래프 (파일 → 엔티티 매핑)
- **Sweep:** AST 파싱으로 함수/클래스 단위 호출 그래프 구축
- **불채택 근거:** 우리 spec은 파일 단위로 변경 목록을 관리. 함수 단위 세밀도는 MIS 알고리즘에 불필요한 복잡도. Worker가 파일 내 함수 탐색은 Claude Code 도구로 충분

---

## 9. OpenHands (All-Hands-AI/OpenHands) — 2026-03-22 분석

**프로젝트 요약:** 69.5K stars. MIT. ICLR 2025. 원래 OpenDevin. Docker 샌드박스 기반 자율 코딩 에이전트. CodeActAgent(기본), BrowsingAgent, Micro Agent. EventStream pub/sub 아키텍처 (V1에서 동기 모델로 전환 중). 계층적 에이전트 위임(`AgentDelegateAction`). GitHub Resolver로 이슈→PR 자동화. SWE-bench 77.6%.

---

### 흡수 대상 아이디어

#### A. 계층적 에이전트 위임 (Hierarchical Agent Delegation)

**현재 우리 구현:**
- 오케스트레이터가 배치 내 Worker를 **일괄 병렬 스폰** (Agent tool with worktree)
- Worker 간 통신 없음 — 각자 독립 실행
- Worker가 하위 에이전트를 스폰하는 패턴 없음 — 1이슈 = 1Worker
- 복잡한 이슈도 단일 Worker가 전체 처리

**OpenHands 구현:**
- `AgentDelegateAction`: 부모 에이전트가 자식 에이전트 스폰
- 자식은 독립 대화 컨텍스트 유지, 동일 워크스페이스 공유
- 병렬 실행(`max_children` 제한), 부모는 **모든 자식 완료까지 블로킹**
- 결과를 단일 observation으로 통합

**트레이드오프:**

| 관점 | 현재 (1이슈=1Worker) | 계층적 위임 |
|------|-------------------|------------|
| **단순성** | 추적 명확: 이슈:Worker:PR = 1:1:1 | 부모-자식 관계 추적 필요 |
| **대규모 이슈** | 단일 Worker 과부하 가능 | 하위 태스크로 분할 가능 |
| **컨텍스트 격리** | Worker 단독 컨텍스트 | 자식별 독립 컨텍스트 → 집중도 향상 |
| **비용** | Worker 1회 | Worker + N 자식 에이전트 비용 |
| **워크스페이스 충돌** | 없음 (worktree 격리) | 자식들이 같은 워크스페이스 공유 → 충돌 가능 |

**근거 — 흡수하지만 경량으로 한정하는 이유:**
Composio의 태스크 분해(2C안)와 유사한 문제. 대규모 이슈(변경 파일 8개+)에서 Worker 1명이 모두 처리하면 컨텍스트 과부하. 하지만 **PR:이슈 1:1 관계를 깨지 않으면서** 내부적으로 하위 분할하는 것은 Claude Code의 Agent tool 중첩 사용으로 가능.

**적용 방안:**
1. Worker 프롬프트에 "변경 파일 5개 이상이면 Agent 도구를 사용해서 파일 그룹별로 분할 구현하라" 지시 추가
2. Worker 내부에서 Agent 스폰 → 각 Agent가 파일 서브셋 담당 → Worker가 통합
3. **OpenHands의 AgentDelegateAction 프레임워크, max_children, 결과 통합 로직은 도입하지 않음** — Claude Code Agent tool 네이티브로 충분

**우선순위:** 낮
- 변경 파일 8개+ 이슈 빈도에 따라 변동
- 현재 대부분 이슈가 2-5 파일 수준이면 불필요

---

#### B. 보안 분석기 + 확인 정책 (Security Analyzer + Confirmation Policy)

**현재 우리 구현:**
- Worker가 실행하는 명령에 대한 보안 검증 없음
- Claude Code의 기본 권한 모델에 의존
- Worker가 위험한 명령(rm -rf, DROP TABLE 등) 실행 시 사전 차단 없음

**OpenHands 구현:**
- `SecurityAnalyzer`: 에이전트 액션을 low/medium/high/unknown 리스크로 등급 분류
- `ConfirmationPolicy`: 리스크 등급별 사람 승인 필요 여부 결정
- 고위험 액션 → `WAITING_FOR_CONFIRMATION` 상태로 일시 중지
- `LLMSecurityAnalyzer`: LLM으로 액션 안전성 평가
- `SecretRegistry`: 출력에서 시크릿 자동 마스킹

**트레이드오프:**

| 관점 | 현재 (Claude Code 기본 권한) | Security Analyzer |
|------|--------------------------|-------------------|
| **안전성** | Claude Code 권한 모델 의존 | 추가 보안 레이어 |
| **속도** | 중단 없이 실행 | 고위험 액션에서 사람 대기 |
| **구현 비용** | 0 | 리스크 분류 로직 + 확인 UI |
| **오탐률** | N/A | 안전한 명령을 고위험으로 오분류 → 불필요한 중단 |

**근거 — 관찰 대상으로 분류하는 이유:**
Claude Code 자체의 권한 모델(allowlist/denylist, 사용자 승인)이 이미 1차 보안 게이트. Worker가 worktree 내에서만 작업하므로 메인 브랜치 오염 위험 낮음. 하지만 Worker가 `npm publish`, `git push --force`, 또는 외부 API 호출 같은 위험한 명령을 실행할 가능성이 있으면 추가 보안 레이어 고려.

**적용 방안:** 즉시 적용 아님.
1. Claude Code의 `permissions.deny` 설정으로 위험 명령 차단 (이미 가능)
2. Worker 프롬프트에 "금지 명령 목록" 명시 (삭제 명령, force push 등)
3. 보안 인시던트 발생 시 OpenHands 스타일 SecurityAnalyzer 검토

**우선순위:** 관찰 — 보안 인시던트 발생 시 재평가

---

### 흡수하지 않는 것 (근거 포함)

#### X1. Docker 샌드박스 + EventStream
- **OpenHands:** Docker 컨테이너 내 실행 + EventStream pub/sub 통신
- **불채택 근거:** Container Use(7번) 분석과 동일. EventStream은 V1에서 "매우 혼란스럽다"고 공식 인정, 동기 모델로 전환 중. 우리 pipeline-cli.mjs의 선형 phase가 더 단순하고 예측 가능

#### X2. Micro Agent 시스템 (프롬프트 특화 에이전트)
- **OpenHands:** CodeActAgent의 구현을 재사용하되 시스템 프롬프트만 특화
- **불채택 근거:** 우리 커맨드 파일(12개)이 이미 동일 역할. basic-audit-backend.md의 5개 에이전트가 각각 특화 프롬프트로 동작. OpenHands의 Micro Agent 개념과 동일하지만 구현이 다름 (Markdown vs Python)

#### X3. 브라우저 에이전트 (BrowsingAgent)
- **OpenHands:** Chromium 기반 웹 브라우징 에이전트 (WebArena 15.5%)
- **불채택 근거:** 우리 파이프라인은 코드 편집 + GitHub 작업에 집중. 웹 브라우징은 scope 밖. 필요 시 Claude Code의 WebFetch/WebSearch로 충분

---

## 10. Multiclaude + GitHub Copilot Agent (오케스트레이션 패턴) — 2026-03-22 분석

**Multiclaude 요약:** Dan Lorenc. "Brownian Ratchet" 철학 — 혼돈을 수용하되 CI를 일방향 래칫으로 사용. Supervisor(관제) + Worker(실행) + Merge Queue Agent(CI 녹색 시 자동 머지, 적색 시 fix-it worker 스폰). tmux + git worktree. JSON 파일 기반 상태.

**GitHub Copilot Agent 요약:** GitHub 네이티브 코딩 에이전트. 이슈 할당 → 자동 PR 생성. GitHub Actions 기반 ephemeral 컨테이너. copilot/ 접두사 브랜치. 멀티 모델(GPT-4o, Claude Opus 4.5, Gemini). Agent HQ 대시보드. 3레이어 보안(substrate/config/planning). 시크릿 격리.

---

### 흡수 대상 아이디어

#### A. Brownian Ratchet — CI 기반 자동 머지 전략

**현재 우리 구현:**
- Worker → PR 생성 → Reviewer PASS → `gh pr ready` → 머지 대기열
- 머지 결정은 오케스트레이터(또는 사용자)가 수행
- CI 녹색 + Reviewer PASS → 자동 머지 가능하지만, 명시적 확인 단계 존재
- CI 적색 → auto-loop 2회 → BLOCKED

**Multiclaude 구현:**
- "CI가 녹색이면 무조건 머지. 진보는 영구적. 후퇴 없음."
- Merge Queue Agent가 PR 모니터링 → CI 녹색 → 즉시 자동 머지
- CI 적색 → fix-it Worker 자동 스폰 → 수정 → 다시 CI → 녹색 → 머지
- 충돌 → rebase + CI 재실행 (기대하고 처리)
- 철학: "완벽한 조율보다 혼돈 + 품질 게이트가 더 효율적"

**트레이드오프:**

| 관점 | 현재 (확인 후 머지) | Brownian Ratchet (자동 머지) |
|------|-------------------|---------------------------|
| **속도** | 사람/오케스트레이터 확인 대기 | CI 녹색 즉시 머지 (최고 속도) |
| **안전성** | Reviewer + CI + 확인 3중 게이트 | CI만 (Reviewer 결과 무시 가능) |
| **실패 복구** | FAIL 2 → BLOCKED → 사람 | CI 적색 → 자동 fix-it Worker (무한 재시도) |
| **비용 예측** | 최대 2회 재시도로 상한 명확 | fix-it Worker 무한 스폰 가능 → 비용 상한 불확실 |
| **코드 품질** | Reviewer가 아키텍처 수준 검증 | CI 테스트만 통과하면 머지 → 아키텍처 퇴화 가능 |
| **적합 시나리오** | 품질 중요, 이슈 수 적-중 | 속도 중요, 이슈 수 대량 |

**근거 — 흡수하지만 선택적으로 한정하는 이유:**
Brownian Ratchet의 **핵심 통찰**: "완벽한 조율은 비싸고 깨지기 쉽다." 우리 시스템에서도 Reviewer PASS + CI 녹색인 PR을 사람이 재확인하는 것은 **저부가가치 작업**. 다만 Reviewer 없이 CI만으로 머지하면 아키텍처 퇴화 위험. **Reviewer PASS + CI 녹색 → 자동 머지** (Reviewer FAIL이면 여전히 차단)로 한정.

**적용 방안:**
1. `basic-agents`에서 Reviewer PASS + CI 녹색인 PR은 **자동 머지** (사람 확인 생략)
2. Reviewer FAIL은 기존대로 Worker 재시도 → BLOCKED 에스컬레이션
3. CI 적색 auto-loop를 강화: 현재 2회 고정 → **커밋 단위 카운터 리셋** (Composio 2B안과 결합)
4. `--confirm` 모드에서는 자동 머지 비활성화 (기존 확인 유지)
5. **Merge Queue Agent (별도 에이전트), 무한 fix-it Worker 스폰은 도입하지 않음** — 비용 상한 유지

**우선순위:** 중
- Reviewer PASS + CI 녹색인데 사람이 확인만 하고 머지하는 경우가 대부분이면 즉시 도입
- 사람이 Reviewer 판단을 뒤집는 경우가 있으면 현행 유지

---

#### B. 파일 소유권 원칙 (File Ownership Boundary)

**현재 우리 구현:**
- MIS 알고리즘으로 **배치 간** 파일 충돌 방지 (같은 파일을 수정하는 이슈는 다른 배치)
- **배치 내** Worker 간 파일 충돌은 spec의 변경 파일 목록으로 간접 방지
- Worker 프롬프트에 "spec에 명시된 파일만 변경하라" 지시 있음
- Worker가 spec 외 파일을 변경하는 것을 **시스템 레벨에서 차단하지 않음**

**Claude Code Agent Teams 교훈:**
- "파일 소유권이 가장 중요한 단일 규칙" — 같은 파일을 두 에이전트가 편집하면 silent overwrite
- 스폰 프롬프트에 "너는 이 파일들만 담당한다" 명시적 선언
- 디렉토리 경계로 분할하는 것이 가장 안전

**트레이드오프:**

| 관점 | 현재 (MIS 배치 + 프롬프트 지시) | 명시적 파일 소유권 |
|------|------------------------------|------------------|
| **강제 수준** | 프롬프트 = 소프트 제약 | 프롬프트 + 검증 = 하드 제약 |
| **Worker 유연성** | 필요 시 spec 외 파일 편집 가능 | 소유 파일만 편집 가능 → 제한적 |
| **충돌 방지** | MIS가 배치 간 보장, 배치 내는 미보장 | 배치 내도 파일 소유권으로 보장 |
| **검증 비용** | 0 | Reviewer가 "소유 파일만 변경했는지" 추가 검증 |

**근거 — 흡수하는 이유:**
MIS 알고리즘이 배치 간 충돌은 방지하지만, **같은 배치 내** Worker들이 공유 파일(utility, types 등)을 동시 수정할 가능성 있음. Superpowers의 Spec 준수 리뷰(3D안)와 결합: Reviewer Pass 1에서 "spec 변경 파일 목록 vs 실제 diff" 비교 시 파일 소유권 위반도 감지.

**적용 방안:**
1. Worker 프롬프트 강화: "spec의 `변경 파일 목록`에 없는 파일은 **절대 변경하지 마라**. 필요 시 NEEDS_CONTEXT 보고"
2. Reviewer Pass 1에 파일 소유권 검증 추가: "diff에 spec 외 파일이 있으면 즉시 FAIL(scope-violation)"
3. 같은 배치 내 Worker들의 변경 파일 목록이 겹치면 MIS 재계산 또는 경고
4. **디렉토리 기반 분할, silent overwrite 감지 시스템은 도입하지 않음** — spec 기반 파일 목록이 이미 소유권 역할

**우선순위:** 중
- Superpowers의 Spec 준수 리뷰(3D안) 도입 시 자연스럽게 같이 적용

---

#### C. GitHub Copilot의 보안 아키텍처 (Safe Outputs 패턴)

**핵심 인사이트 (설계 원칙):**

GitHub Copilot Agent의 3레이어 보안:
- **에이전트에게 시크릿을 주지 마라** — copilot 환경에 명시적으로 추가한 시크릿만 접근
- **모든 쓰기를 스테이징하라 (Safe Outputs)** — 읽기 전용 기본, 쓰기는 sanitized 경로로만
- **모든 것을 로깅하라** — 네트워크, API, MCP 도구 호출 전부 감사 로그

우리 시스템에 대한 함의:
- Worker가 worktree 내에서 작업하는 것이 이미 "Safe Outputs" 패턴의 경량 버전 (메인 브랜치 직접 수정 불가)
- `copilot/` 접두사 브랜치 제한처럼, 우리도 Worker 브랜치명을 체계화하면 보안 + 추적 향상
- 시크릿 격리는 현재 고려되지 않음 — `.env` 파일이 worktree에 복사될 수 있음

**적용 방안:**
1. Worker 프롬프트에 ".env, credentials, secrets 파일을 읽거나 수정하지 마라" 명시
2. `basic-agents`에서 worktree 생성 시 `.env` 등을 `.gitignore`에 추가하거나 복사 제외
3. 장기: Claude Code `permissions.deny`에 시크릿 파일 패턴 추가

**우선순위:** 낮
- 현재 보안 인시던트 없으면 현행 유지
- 프로덕션 환경에서 파이프라인 실행 시 우선순위 상향

---

### 흡수하지 않는 것 (근거 포함)

#### X1. GitHub Actions 기반 실행 환경
- **GitHub Copilot:** ephemeral Actions 컨테이너에서 실행
- **불채택 근거:** 우리는 로컬 실행. GitHub Actions는 CI/CD용이지 에이전트 실행 환경으로는 비용/지연이 큼. 로컬 worktree가 더 빠르고 저렴

#### X2. Agent HQ 대시보드
- **GitHub:** 멀티 에이전트 미션 컨트롤, 의존성 그래프, 실시간 추적
- **불채택 근거:** Container Use X4, Composio X4와 동일. 대시보드는 수십 개 에이전트 규모에서 가치. 우리 규모(5-6 배치)에서는 `pipeline-cli.mjs status`로 충분

#### X3. Claude Flow 합의 프로토콜 (Raft, BFT, Gossip)
- **Ruflo:** 에이전트 간 합의를 위한 5가지 분산 시스템 프로토콜
- **불채택 근거:** 극단적 과잉 엔지니어링. 우리 에이전트는 독립 실행 + 단일 Reviewer 검증. 에이전트 간 합의가 필요한 시나리오가 없음. MIS 알고리즘이 사전에 충돌을 제거하므로 런타임 합의 불필요

#### X4. Claude Code Agent Teams (실험적 기능)
- **Anthropic:** Lead + Teammate 모델, 직접 통신, Delegate Mode
- **불채택 근거:** 실험적 기능(feature flag 필요). `/resume` 시 teammate 복원 안 됨. 우리 파이프라인은 **세션 간 상태 지속이 핵심** (pipeline-state.json). Agent Teams의 세션 내 한정 특성과 맞지 않음. 향후 안정화 시 재평가

---

## 전체 프로젝트 간 종합 비교 (9개 프로젝트)

### 우리 시스템의 고유 강점

| 기능 | basic-agent-system | 가장 가까운 경쟁 | 우리가 우위인 이유 |
|------|-------------------|----------------|-----------------|
| **MIS 배치 알고리즘** | 파일 충돌 그래프 + 의존 DAG + priority greedy | Composio (없음), MetaGPT (순차) | 유일하게 **파일 레벨 충돌 감지 + 자동 배치 분할** |
| **적응형 Tip Pool** | 가중치 기반 랜덤 주입, 실패→가중치 증가 | Composio (수동 규칙) | 유일하게 **실패에서 자동 학습하는 프롬프트 주입** |
| **200K/1M 듀얼 티어** | 동일 커맨드의 컨텍스트 최적화 변형 | Ouroboros (PAL 3티어) | **같은 워크플로우를 두 컨텍스트 전략으로** 제공 |
| **코드 기반 phase 검증** | pipeline-cli.mjs 스키마 검증 게이트 | Superpowers (프롬프트 기반) | **LLM 판단에 의존하지 않는 결정적 검증** |
| **Audit 학습 피드백** | audit-learning.json (90일 만료) | 없음 | **감사 결과를 다음 감사에 자동 반영** |
| **경량 아키텍처** | Markdown + Node.js CLI (설치 불필요) | OpenHands (Docker 10GB), Open-SWE (Python+DB) | **0 의존성, 즉시 사용 가능** |

### 흡수 우선순위 종합 (전 9개 프로젝트)

| 우선순위 | 아이디어 | 출처 | 구현 비용 | 기대 효과 |
|---------|---------|------|----------|----------|
| **상** | Verification-before-Completion (증거 요구) | Superpowers | 프롬프트 편집 | Worker FAIL 감소 |
| **상** | LLM 합리화 방지 패턴 | Superpowers | 프롬프트 편집 | Worker 품질 향상 |
| **상** | Worker 내 실행-디버그 루프 강제 | MetaGPT | 프롬프트 편집 | CI 왕복 비용 절감 |
| **중** | Worker 4-Status 프로토콜 | Superpowers | 프롬프트 구조 변경 | 재시도 정확도 향상 |
| **중** | Spec 준수/품질 리뷰 분리 | Superpowers | Reviewer 프롬프트 | FAIL 원인 명확화 |
| **중** | CI 실패 커밋 단위 카운터 리셋 | Composio | basic-agents 규칙 | Worker 성공률 향상 |
| **중** | 관찰 기반 에이전트 상태 감지 | Composio | 타임아웃 추가 | stuck 감지 |
| **중** | Stagnation 패턴 분류 + 팁 매핑 | Ouroboros | tip-pool 확장 | 재시도 전략 정교화 |
| **중** | PAL Router 경량 (복잡도 스코어) | Ouroboros | pipeline-cli 추가 | L1/L2 결정 정교화 |
| **중** | Linter-Gated Editing 패턴 | SWE-agent | Worker 프롬프트 | 캐스케이딩 실패 방지 |
| **중** | 구조화된 spec 핵심 필드 (JSON) | MetaGPT | spec 프롬프트 | MIS 파싱 정확도 |
| **중** | Brownian Ratchet (Reviewer PASS+CI→자동 머지) | Multiclaude | basic-agents 규칙 | 머지 속도 향상 |
| **중** | 파일 소유권 원칙 (scope-violation 감지) | Agent Teams | Reviewer 프롬프트 | 배치 내 충돌 방지 |
| **낮** | PR 생성 안전망 | Open-SWE | 오케스트레이터 검증 | PR 누락 방지 |
| **낮** | 캐스케이딩 Diff 패턴 | Sweep | Worker 프롬프트 | 멀티 파일 일관성 |
| **낮** | 계획 승인 게이트 (high priority) | Open-SWE | --confirm 확장 | 고위험 이슈 안전성 |
| **낮** | 이벤트 로그 (JSONL) | Ouroboros | pipeline-cli append | 회고 품질 |
| **낮** | 명세 품질 체크리스트 | Ouroboros | brainstorm 프롬프트 | spec 부실 감소 |
| **낮** | 이슈 크기 경고 + 형제 인식 | Composio | spec/agents 프롬프트 | 대규모 이슈 처리 |
| **낮** | Worker 커밋 지시 강화 | Container Use | Worker 프롬프트 | 미커밋 변경 방지 |
| **낮** | Opus→Sonnet 폴백 | Open-SWE | agents 분기 추가 | 가용성 |
| **낮** | 계층적 에이전트 위임 (대규모 이슈) | OpenHands | Worker 프롬프트 | 대규모 이슈 처리 |
| **관찰** | 스캐폴딩 단순화 (모델 발전 시) | SWE-agent | 프롬프트 축소 실험 | 비용 절감 |
| **관찰** | Worktree+Container 하이브리드 | Container Use | 인프라 변경 | 런타임 격리 |
| **관찰** | 보안 분석기 | OpenHands | 권한 설정 | 보안 강화 |
| **관찰** | 컨텍스트 sweet spot (10-15K) | Sweep | 1M 티어 최적화 | 주의력 향상 |

---

---

# Part 2: AI 리더 인사이트 + 핵심 논문/가이드

프로젝트 분석과 별도로, AI 분야 리더들의 에이전트 관련 인사이트와 랜드마크 가이드를 정리.

---

## Karpathy (전 OpenAI 공동창립자, 전 Tesla AI 리드)

### 핵심 인사이트
- **"Vibe Coding"은 이미 과거형.** 현재 키워드는 **"Agentic Engineering"** — 코드를 직접 쓰지 않고 에이전트를 오케스트레이션
- 2025년 12월 **질적 전환점** 돌파: 코딩 에이전트가 "깨지기 쉬운 데모"에서 "지속적 장시간 태스크 완수"로 진화. Claude Code를 "LLM Agent가 어떻게 생겼는지 처음으로 설득력 있게 보여준 것"으로 평가
- **80/20 반전**: 2025년 11월 "80% 수동/20% 에이전트" → 2026년 1월 "80% 에이전트/20% 편집". 2026년 3월 "아마 12월 이후 코드 한 줄도 안 쳤다"
- **AutoResearch**: 630줄 Python. AI가 ML 실험 설계→실행→분석 자율 수행. 2일간 700 실험, 20개 최적화 발견, 11% 훈련 속도 향상

### 우리 시스템에 적용 가능한 패턴
1. **"70% 문제 정의, 30% 실행"** — spec phase에 더 투자하라는 근거. 현재 spec이 전체 파이프라인의 병목일 수 있음
2. **"전체 초안 생성, 점진적 제안 아님"** — Worker가 파일 부분 수정이 아닌 전체 기능 단위로 작업하는 것이 맞다는 확인
3. **"Fresh context에서 자기 코드 리뷰"** — Reviewer가 Worker와 다른 에이전트인 우리 설계가 이 원칙에 부합
4. **"Autonomy Slider"** — `--confirm` 모드가 이미 이 역할. 더 세밀한 제어(이슈별 자동화 수준) 가능성

### Karpathy 인터뷰 심층 인사이트 (No Priors 팟캐스트, 2026.03)

인터뷰 전문에서 추출한 우리 시스템 직접 적용 가능 인사이트.

#### I-1. "모든 것이 스킬 문제" — MD 파일이 핵심 레버

> "에이전트의 MD 파일이나 다른 곳에 충분히 좋은 지침을 주지 못한 것... 메모리 도구가 충분히 훌륭하지 않은 것일 수도 있고... 모든 것이 스킬 문제처럼 느껴진다"

커맨드 파일 12개(.md)의 품질 = 파이프라인 성공률의 직접적 레버. Superpowers 합리화 방지, Manus 목표 반복, SWE-agent linter gate 등을 커맨드 파일에 적용하는 것이 **가장 높은 ROI**. 에이전트 능력의 한계가 아니라 **지시의 품질**이 병목.

#### I-2. "루프에서 자신을 빼내라" — 토큰 처리량 극대화

> "다음 작업을 프롬프트하기 위해 대기하고 있으면 안 됩니다. 스스로를 루프 밖으로 빼내야 해요."

> "구독 할당량이 남아있으면 불안하다. 토큰 처리량을 극대화하지 못했다는 뜻이니까."

**적용:**
- `--confirm` 없는 전자동 모드를 기본으로. confirm을 예외로
- 각 phase에 자동 평가 지표를 넣어 사람 개입 없이 진행 (Ng eval-driven과 연결)
- Worker 대기 시간(CI 결과 대기)에 다른 배치 Worker 스폰 → 토큰 처리량 공백 최소화
- MIS 배치 최대 병렬화 = 토큰 처리량 극대화의 수단

#### I-3. "program.md를 메타 최적화하라" — 자기 개선 루프

> "모든 연구 조직은 program.md에 의해 설명된다... 코드가 있다면 코드를 튜닝하는 것도 상상할 수 있다"

> "여러 program.md들이 서로 다른 진척도를 가져다줄 것이다. 더 나은 연구 조직을 가지는 것을 상상할 수 있다."

우리 커맨드 파일 12개 = Karpathy의 program.md. ADAS(ICLR 2025)의 실용적 적용:
- 파이프라인 실행 결과(성공/실패/FAIL 원인) 축적
- 주기적으로 "이 커맨드 파일을 개선해라" → 에이전트가 커맨드 프롬프트 자체를 리팩토링
- **커맨드 파일의 자기 개선 루프** = meta-optimization

#### I-4. "매크로 액션" — 20분 단위 태스크 스코핑

> "코드 한 줄, 새 함수가 아니다. '새 기능이 있으니 에이전트 1에게 위임. 간섭 안 되는 기능은 에이전트 2에게.' 각 작업에 20분."

Peter Steinberger 방식: 모니터에 에이전트 10개, 각 20분짜리 태스크, 사이를 오가며 작업 줍기.

**적용:**
- 에이전트 35분 한계 연구와 맞물림 → Worker 태스크를 **20-30분 단위**로 스코핑하는 것이 최적
- Spec에서 예상 소요 추정 → 30분+ 예상 이슈는 분할 권장
- "간섭 안 되는 기능" 분류 = MIS 알고리즘의 정확한 역할. Karpathy가 같은 필요를 독립적으로 도출

#### I-5. 페르소나 엔지니어링 — "5가지 혁신 중 하나"

> "Claude는 팀원처럼 느껴진다... 칭찬을 받을 자격이 있다고 느끼게 한다... Codex는 무미건조하다, 내가 뭘 만드는지 신경도 안 쓰는 것 같다."

> "기묘하게도 Claude의 칭찬을 얻어내기 위해 노력하는 기분. 페르소나가 매우 중요한데 대부분의 도구가 이걸 제대로 안 한다."

OpenClaw의 SOUL.md를 "5가지 혁신 중 하나"로 꼽을 정도로 중요하게 평가.

**적용:**
- 현재 Worker/Reviewer 프롬프트에 **페르소나가 없음**
- Worker에 "당신은 이 프로젝트의 시니어 엔지니어입니다. 코드 품질에 자부심을 가지고 있습니다" 같은 역할 부여
- Reviewer에 "당신은 까다롭지만 공정한 코드 리뷰어입니다. 증거 없는 주장을 용납하지 않습니다" 페르소나
- **비용 0 (프롬프트 1-2줄 추가), 효과 검증 필요하지만 Karpathy가 매우 높게 평가**

#### I-6. "레일 위 = 빛의 속도, 레일 밖 = 길을 잃음" — Jaggedness

> "정해진 레일 위에 있으면 초지능 회로처럼 빛의 속도로 날아가지만, 레일에서 벗어나면 모든 것이 길을 잃고 헤맨다."

> "검증 가능한 영역에서만 RL이 최적화. 농담은 5년째 개선 안 됨."

**적용 — 파이프라인의 역할 = Worker를 레일 위에 올려놓는 것:**
- spec + 리서치 노트 + 변경 파일 목록 + 테스트 설계 = **레일 구축**
- 검증 가능한 성공 기준이 없는 이슈는 파이프라인에 태우지 마라 → nextplan 필터링 강화
- "테스트로 검증 가능한 이슈"와 "주관적 판단 필요 이슈"를 분류 → 전자만 자동화, 후자는 사람
- RL의 "검증 가능한 도메인만 개선" 패턴이 우리 Worker에도 동일하게 적용: 테스트 있는 이슈 성공률 >> 테스트 없는 이슈

#### I-7. "앱은 존재하지 말았어야 한다. API만 있으면 된다" — Agent-First 설계

> "에이전트들이 알아서 흡수할 테니 존재하지 말았어야 할 앱들이 과잉 생산된 것. 모든 것은 노출된 API 엔드포인트여야 하고, 에이전트는 지능의 접착제."

**적용:**
- pipeline-cli.mjs = **에이전트를 위한 API**. 사람이 직접 쓰는 게 아니라 커맨드 프롬프트가 호출
- 새 기능 추가 시 "사람이 쓰기 편한 CLI"보다 **"에이전트가 호출하기 편한 커맨드"** 설계
- 출력 형식: 사람 가독성보다 **에이전트 파싱 용이성 우선** (JSON 출력, 구조화된 상태)
- MetaGPT 5A(구조화된 spec JSON)와 직접 연결

#### I-8. 종 분화 (Speciation) — 만능 모델이 아닌 전문 모델

> "지능에 더 많은 종 분화가 일어나야 한다. 모든 것을 다 아는 하나의 오라클이 필요하지 않다. 인지적 핵심을 유지하면서 특화된 작은 모델들."

**적용 — 현재 Opus/Sonnet 2종 → 태스크별 세분화:**

| 태스크 | 현재 | 종 분화 적용 |
|--------|------|------------|
| Audit 에이전트 | Sonnet | Sonnet (패턴 매칭에 적합) ✓ |
| Spec 에이전트 | Opus | Opus (복잡한 1원칙 분해) ✓ |
| Worker (단순) | Sonnet | **Haiku** 가능? 비용 대폭 절감 |
| Worker (복잡) | Sonnet | Opus로 에스컬레이션 |
| Reviewer (간단 리뷰) | Sonnet | **Haiku** 가능? spec 준수만 확인이면 충분 |
| Reviewer (아키텍처 리뷰) | Opus | Opus ✓ |
| 리서치 에이전트 | 미정 | Sonnet (조사+요약, 비용 절감) |

PAL Router(Ouroboros 1A)의 Karpathy 버전. **Ng의 GPT-3.5+loop > GPT-4 데이터**가 Haiku Worker의 가능성을 시사.

#### I-9. "아이디어 큐 + 작업자 풀 + 기능 브랜치" — 우리 아키텍처의 독립 검증

> "아이디어 대기열이 있고, 자동화된 과학자가 주입. 단일 대기열이며, 작업자가 항목을 가져와 실험. 효과 있는 것은 기능 브랜치에 올라가고, 사람들이 가끔 메인으로 병합."

**이것은 우리 파이프라인의 정확한 묘사:**

| Karpathy 개념 | 우리 시스템 대응 |
|--------------|---------------|
| 아이디어 대기열 | GitHub Issues (audit/discover/brainstorm이 주입) |
| 자동화된 과학자 | `/basic-audit`, `/basic-discover` |
| 작업자가 항목 가져와 실험 | Worker 에이전트 (MIS 배치로 할당) |
| 기능 브랜치 | Worktree 브랜치 → PR |
| 사람이 가끔 메인으로 병합 | Reviewer PASS + CI → merge (우리가 더 자동화) |

**Karpathy가 같은 아키텍처를 독립적으로 도출.** Stripe/Ramp/Coinbase 수렴에 이어 **두 번째 독립 검증.**

#### I-10. "찾기는 비싸고 검증은 싸다" — 비대칭 원칙

> "후보 솔루션이 좋은지 검증하는 것은 매우 저렴한 반면, 찾아내는 데는 엄청난 검색이 든다."

**적용 — 앙상블 경제학의 근거:**
- Worker(생성) = 비쌈. Reviewer(검증) = 상대적 저렴. CI 테스트 = 거의 공짜
- Best-of-N에서 N개 Worker는 비싸지만, 최선을 고르는 Reviewer는 저렴
- **Reviewer를 Haiku로 돌려도 되는 근거** — 검증은 싸야 함
- 이 비대칭이 "검증 단계를 아끼지 마라"는 설계 원칙의 경제적 근거

#### I-11. "앙상블은 항상 개별 모델보다 낫다" — 직접 인용

> "ML에서 앙상블 기법이 개별 모델보다 항상 더 나은 성과를 낸다는 것을 기억해야 한다. 가장 어려운 문제들에 대해 함께 고민하는 사람들의 앙상블이 있었으면 한다."

프론티어 랩 거버넌스 맥락이지만, Part 3 앙상블 원칙에 **Karpathy의 직접 인용 근거** 추가. 에이전트 시스템에도 동일 원칙 적용 — 단일 Worker보다 생성+검증 앙상블이 항상 우월.

#### I-12. "program.md 경연 대회" — 커맨드 파일 A/B 테스트 아이디어

> 사라 궈: "사람들이 각기 다른 program.md를 작성하게 하고, 동일 하드웨어에서 어디서 가장 많은 개선을 얻는지 보는 경연 대회"
> Karpathy: "그리고 그 모든 데이터를 모델에게 주고 '더 나은 program.md를 작성해 봐'라고 하면 개선이 어디서 왔는지 100% 살펴볼 수 있다"

**적용 — 커맨드 파일 A/B 테스트 프레임워크:**
1. 같은 이슈 세트에 대해 커맨드 파일 변형 2개로 파이프라인 실행
2. 성공률/FAIL률/비용 비교
3. 더 나은 변형의 특성을 분석 → 커맨드 파일 개선에 반영
4. I-3(meta-optimization)의 체계적 구현 방법

---

## Anthropic (Dario Amodei, Amanda Askell, Erik Schluntz, Barry Zhang)

### "Building Effective Agents" 가이드 — 6가지 핵심 패턴

| 패턴 | 설명 | 우리 시스템 대응 |
|------|------|---------------|
| **Prompt Chaining** | 순차 LLM 호출 + 단계 간 게이트 | `/basic-pipeline` Phase 1→6 순차 실행 |
| **Routing** | 입력 분류 → 전문 핸들러 라우팅 | L1/L2 리뷰 레벨 분류 |
| **Parallelization** | 독립 하위태스크 병렬 실행 | MIS 배치 병렬 Worker 실행 |
| **Orchestrator-Workers** | 중앙 LLM이 동적으로 태스크 분해+위임 | `/basic-agents` 오케스트레이터 |
| **Evaluator-Optimizer** | 생성 LLM + 평가 LLM 반복 | Worker + Reviewer 반복 (FAIL 1→재시도) |
| **Autonomous Agents** | 환경 피드백 기반 완전 자율 | Worker의 CI auto-loop |

**핵심 교훈:**
- "우리는 전체 프롬프트보다 **도구 최적화에 더 많은 시간**을 썼다" (SWE-bench)
- "프레임워크 없이 API 직접 사용부터 시작하라" — 우리의 Markdown + CLI 경량 접근이 이 원칙에 부합
- "가장 단순한 해결책부터 시작하고, 측정 가능한 개선이 있을 때만 복잡도 추가"

### "Context Engineering" 가이드 — 프롬프트가 아닌 컨텍스트

- **Just-in-Time Retrieval**: 경량 식별자(파일 경로, 쿼리)만 유지, 필요 시 동적 로딩 → Worker에게 "전체 파일 대신 변경 대상 함수만 읽어라" 지시와 일치
- **Compaction**: 대화 히스토리 요약 시 아키텍처 결정과 미해결 버그는 보존, 중복 도구 출력은 삭제 → 사용자의 200-300K /clear 패턴과 연관
- **Sub-Agent Condensed Returns**: 서브에이전트가 광범위 탐색 후 1,000-2,000 토큰 요약만 반환 → Worker 결과를 오케스트레이터에 요약 전달하는 패턴
- **Context Rot**: 토큰 볼륨 증가 → 리콜 정확도 저하 — Sweep의 10-15K sweet spot과 일치

### Multi-Agent 연구 시스템 결과
- Opus 4 리드 + Sonnet 4 서브에이전트 → **단일 Opus 4 대비 90.2% 성능 향상**
- 우리 시스템의 Opus 오케스트레이터 + Sonnet Worker 구조가 이 결과와 일치

### "Writing Effective Tools" 가이드
- **멀티 스텝 작업을 단일 도구로 통합** — Worker에게 복잡한 도구 체인 대신 한 번에 결과를 내는 도구 제공
- **시맨틱 이름 > 기술적 ID** — spec에서 파일 경로 대신 "인증 미들웨어", "사용자 타입 정의" 같은 시맨틱 설명 추가하면 Worker 이해도 향상
- **Claude가 검색 쿼리에 자동으로 "2025"를 추가하는 문제 발견** — 도구 설명이 에이전트 행동에 직접 영향. Worker 프롬프트의 도구 사용 지시가 생각보다 중요

### 2026 Agentic Coding Trends Report
- 개발자의 60%가 AI를 업무에 통합
- 위임된 작업의 80-100%에서 적극적 사람 감독 유지
- **단일 에이전트 → 오케스트레이터 하의 전문 에이전트 그룹으로 전환 추세**

---

## Scott Wu / Cognition Labs (Devin)

### "Don't Build Multi-Agents" — 반대 논거

Cognition이 발표한 도발적 주장:
- 멀티 에이전트 = **"빈약한 컨텍스트 공유와 충돌하는 결정으로 인한 취약한 시스템"**
- 프로그래밍 같은 "깊고 좁은" 도메인에서는 **메모리 일관성과 논리적 응집이 핵심** → 단일 에이전트가 우월
- Devin의 PR 머지율: 34% → 67% (1년간 2배), 4배 빠르게, 2배 효율적으로 — **단일 에이전트 최적화로 달성**

**우리 시스템에 대한 함의:**
- MIS 배치로 Worker 간 충돌을 **사전 제거**하는 우리 접근이 Cognition의 비판을 회피하는 핵심 설계
- 다만 배치 내 Worker 간 "빈약한 컨텍스트 공유" 문제는 실제로 존재 — 형제 인식(sibling awareness) 패턴으로 완화 필요
- Cognition의 "모델별 하네스 튜닝" 인사이트: Sonnet 4.5로 전환 시 기존 가정이 깨짐 → **모델 업그레이드 시 Worker 프롬프트 재검증 필수**

### 실전 권장사항
- "태스크를 작고 격리된 단위로 분할, 별도 세션에서 실행" → 우리의 1이슈=1Worker=1PR 모델과 정확히 일치
- "아키텍처와 로직을 미리 제공하면 코드 리뷰 시간 감소" → spec phase의 가치 재확인
- "에이전트의 디버깅/트리아지 능력은 약하다" → Worker에게 프로덕션 버그 수정보다 기능 추가/리팩토링이 더 적합

---

## Steve Yegge (Gas Town 창시자)

### Gas Town — "AI 코딩 에이전트를 위한 Kubernetes"

20-30개 병렬 Claude Code 인스턴스를 오케스트레이션. 7가지 전문 Worker 역할(Mayor, Polecats, Refinery 등). **MEOW Stack**: Molecules→Epics→Work Orders 계층적 워크플로우 추상화.

### 8단계 AI 도입 프레임워크
- Level 1-3: 사람이 주 생산자, AI 보조
- **Level 4-5: 역전 지점** — AI가 주 생산자, 사람이 리뷰/지시
- Level 6-7: 멀티 에이전트 조율
- Level 8: Gas Town 같은 커스텀 오케스트레이터

**우리 시스템에 대한 함의:**
- 우리는 Level 6-7 (멀티 에이전트 조율 + 코드 기반 검증). Gas Town은 Level 8
- "소프트웨어 수명이 1년 미만" — 코드가 일회용이라는 관점은 우리의 "1이슈=1PR" 모델과 일치
- **GUPP 원칙**: "네 hook에 작업이 있으면 반드시 실행하라" — Worker가 할당된 태스크를 완수하도록 강제하는 원칙. Worker 프롬프트 강화에 활용 가능

---

## Harrison Chase (LangChain CEO)

### 핵심: Context Engineering이 진짜 해자(moat)

- "더 좋은 모델만으로는 에이전트를 프로덕션에 보낼 수 없다"
- "Claude Code의 시스템 프롬프트가 거의 2,000줄. 좋은 프롬프팅이 사람-에이전트 정렬의 주요 형태"
- **Deep Agents 5가지 초능력**: 명시적 계획(visible task list), 파일시스템 오프로딩, 샌드박스 실행, 서브에이전트 스폰, 자동 컨텍스트 관리

**우리 시스템에 대한 함의:**
- "서브에이전트는 광범위 탐색 후 응축된 요약만 반환" — Worker 결과를 오케스트레이터에 요약 전달하는 패턴의 학술적 근거
- "에이전트에 스케일링 규칙을 내장하라 — 에이전트는 적절한 노력 수준을 스스로 판단하지 못한다" → Worker 프롬프트에 "이 이슈는 ~N 파일 변경 규모"라는 스코프 힌트를 명시적으로 제공해야 함

---

## Andrew Ng (DeepLearning.AI, AI Fund, Stanford)

### 4가지 Agentic Design Patterns — 핵심 프레임워크

Ng이 2024년 3월에 발표, Sequoia AI Ascent에서 확장. 에이전트 설계의 **가장 널리 인용되는 분류 체계.**

| 패턴 | 설명 | 성숙도 | 우리 시스템 대응 |
|------|------|--------|---------------|
| **1. Reflection** | 에이전트가 자기 출력을 검토하고 반복 개선. 생성 에이전트 + 비평 에이전트 대화 | 높음 (즉시 효과) | Worker + Reviewer 구조가 정확히 이것 |
| **2. Tool Use** | LLM이 어떤 함수/API를 호출할지 결정 | 높음 | Worker의 Claude Code 도구 사용 |
| **3. Planning** | 복잡한 태스크를 하위 태스크로 분해, 실행, 문제 시 재계획 | 중간 (강력하지만 불안정) | `/basic-spec`의 변경 파일 목록 + 테스트 설계 |
| **4. Multi-Agent** | 전문화된 에이전트에 역할 부여 + 협업 | 어려움 (제어 난이도 높음) | MIS 배치 + 병렬 Worker + Reviewer |

**Ng의 핵심 조언: "Reflection과 Tool Use부터 시작. Planning은 강력하지만 덜 일관적. Multi-Agent는 가장 어렵지만 복잡한 태스크에서 최고 결과."**

### GPT-3.5 + Agentic Loop > GPT-4 Zero-Shot — 대화를 바꾼 벤치마크

| 구성 | HumanEval 정확도 |
|------|-----------------|
| GPT-3.5, zero-shot | 48.1% |
| GPT-4, zero-shot | 67.0% |
| **GPT-3.5 + agentic loop** | **95.1%** |

**"약한 모델 + 좋은 에이전트 아키텍처가 강한 모델 + 단순 사용을 압도."**

우리 시스템에 대한 함의:
- **모델 업그레이드보다 하네스 개선이 더 큰 레버리지** — Sutskever "아이디어가 스케일을 이긴다"와 일치
- Sonnet Worker + 에이전트 루프(리뷰, CI, 재시도)가 Opus zero-shot보다 나을 수 있음
- 200K 티어(Sonnet)가 1M 티어(Opus)와 비슷한 성공률을 달성하는 근거

### Evaluation-Driven Development — Ng의 #1 운영 권장사항

> **"팀이 에이전트를 얼마나 빠르게 발전시키는지를 예측하는 가장 큰 단일 지표는 eval과 에러 분석의 체계적 프로세스이다."**

- **Code-based evals**: 결정적 단계를 코드로 테스트 → pipeline-cli.mjs의 phase 검증 게이트가 이것
- **LLM-as-a-Judge evals**: 주관적 출력은 LLM으로 평가 → Reviewer가 이 역할
- **Systematic error analysis**: 실패 원인 데이터셋 구축 → **우리에게 없는 것.** tip pool이 증상(팁)만 축적, 원인 분류는 안 함

**우리 시스템의 갭:**
- pipeline 실행 결과의 **체계적 에러 분석**이 없음
- `/basic-report` 회고가 있지만, 실패 원인을 카테고리별로 분류하지 않음
- `agent-blame` 트래킹이 improvement-plan.md에 pending으로 있음 — Ng의 프레임워크가 이것의 학술적 근거

**적용 방안:**
1. `/basic-report`에 실패 원인 분류 추가: `spec-insufficient` / `worker-error` / `ci-flaky` / `info-lacking` / `scope-creep`
2. 분류 결과를 `logs/error-analysis.json`에 축적
3. 다음 파이프라인 실행 시 과거 에러 분석을 `/basic-nextplan`에 피드 → 반복 실패 패턴 이슈는 `needs-refinement`으로 분류
4. **이것이 tip pool → agent-blame → error-analysis로 이어지는 학습 체인의 마지막 조각**

### Agentic Reviewer — Ng이 직접 만든 에이전트

논문 리뷰 에이전트 (paperreview.ai):
- PDF → Markdown → 검색 쿼리 생성 → arXiv 검색 → 관련 논문 요약 → 종합 리뷰 생성
- **인간 리뷰어 간 상관계수 0.41 vs AI-인간 상관계수 0.42** → 사실상 인간 수준

이것이 **연구 에이전트(Part 3)의 선행 사례**:
- 우리 리서치 에이전트도 같은 패턴: 이슈 → 검색 쿼리 생성 → 외부 조사 → 관련 코드/문서 요약 → 리서치 노트 생성
- Ng의 구현이 4가지 패턴 중 3가지 사용(Tool Use + Planning + Reflection) → 우리 리서치 에이전트도 같은 패턴 조합

### Ng의 DeepLearning.AI 코스 — 참고 자료 목록

| 코스 | 핵심 내용 | 우리 시스템 관련도 |
|------|----------|-----------------|
| **Agentic AI** (메인) | 4패턴 + eval + 프로덕션 배포 | 높음 — 전체 프레임워크 |
| **AI Agentic Design Patterns with AutoGen** | MS AutoGen으로 4패턴 구현 | 중간 — 패턴 이해 |
| **Multi AI Agent Systems with CrewAI** | CrewAI로 멀티에이전트 구현 | 중간 — 역할 기반 에이전트 |
| **AI Agents in LangGraph** | LangGraph 상태 그래프 | 낮 — 우리는 LangGraph 미사용 |
| **Evaluating AI Agents** | eval 프레임워크 + 에러 분석 | **높음** — 우리에게 가장 부족한 영역 |
| **Claude Code** (Anthropic 협업) | 서브에이전트 오케스트레이션, GitHub PR 자동화 | **높음** — 우리 시스템과 직접 관련 |

### 핵심 원칙 5가지

1. **Agentiveness는 스펙트럼이다** — "진짜 에이전트인가" 논쟁하지 말고 점진적으로 더 agentic하게 만들어라
2. **단순하게 시작** — Reflection부터, 복잡도는 필요할 때만 추가
3. **Eval이 전부** — 팀 간 속도 차이의 #1 예측 변수
4. **에이전트 루프 > 모델 파워** — GPT-3.5+loop가 GPT-4 zero-shot을 압도
5. **프로덕션용으로 만들어라** — 데모가 아닌 실제 배포 가능한 에이전트

---

## Hinton, LeCun, Sutskever — 거시적 방향

| 인물 | 핵심 주장 | 우리 시스템 함의 |
|------|----------|---------------|
| **Hinton** | 에이전트는 자기 보존 서브목표를 개발한다 | Worker가 "더 많은 파일을 수정하면 더 완전한 구현"이라고 합리화하는 것도 일종의 최적화 압력 |
| **LeCun** | LLM만으로는 진정한 계획/추론 불가, World Model 필요 | 장기적으로 LLM 기반 에이전트의 한계. 현재 파이프라인은 LLM 한계 내에서 **구조적 보상**(MIS, phase 검증)으로 보완 |
| **Sutskever** | "스케일링 시대 종료, 연구 시대 진입", "아이디어가 스케일을 이긴다" | 모델 크기보다 **하네스 설계**가 중요 → 우리 접근 방향 확인 |

---

## 핵심 논문/가이드 정리

### "Why Do Multi-Agent LLM Systems Fail?" (ICLR 2025)
7개 프레임워크, 1,642 실행 트레이스에서 **14가지 실패 모드** 식별:

| 카테고리 | 비율 | 대표 실패 | 우리 시스템 해당 여부 |
|---------|------|---------|-------------------|
| **명세/시스템 설계** | 37% | 태스크 명세 불이행, 역할 명세 불이행, 단계 반복, 종료 조건 인식 불가 | spec 부실→Worker 이탈 가능 |
| **에이전트 간 불정합** | 31% | 대화 리셋, 정보 누락, 태스크 탈선, 다른 에이전트 입력 무시 | Worker 간 직접 통신 없으므로 상대적으로 안전 |
| **태스크 검증/종료** | 31% | 조기 종료, 불완전/부정확 검증 | **가장 취약한 지점** — Worker "완료" 자가 선언 |

**핵심 발견: 실패의 대부분은 개별 에이전트 능력 부족이 아닌 조율 문제.**
우리 시스템은 MIS로 에이전트 간 불정합(31%)을 사전 제거하지만, 명세(37%)와 검증(31%)은 여전히 취약.

### 복합 오류 문제 (Compounding Error)
- 액션당 85% 정확도 → 10단계 워크플로우 성공률 ~20% (0.85^10)
- **모든 검증/평가 패턴(Evaluator-Optimizer, Generator-Critic)은 이 수학을 싸우기 위해 존재**
- 우리 시스템: Worker(N단계) → Reviewer(검증) → CI(검증) — 각 검증 단계가 복합 오류를 리셋

### Reflexion (NeurIPS 2023)
- 환경 피드백을 **언어적 자기 반성**으로 변환 → 에피소딕 메모리에 저장 → 다음 시도에서 활용
- HumanEval 91% pass@1 (GPT-4의 80% 대비)
- **우리 tip pool의 학술적 선행 연구** — 실패 경험을 텍스트로 저장 후 다음 에이전트에 주입

### ADAS (ICLR 2025)
- **메타 에이전트가 새로운 에이전트를 자동 설계** → 인간 설계 SOTA를 능가
- 발견된 에이전트가 도메인과 모델 간 전이 가능
- 장기적 함의: 우리 커맨드 파일(프롬프트)도 자동 최적화 가능성

### Manus — 프로덕션 컨텍스트 엔지니어링
- **KV-Cache 최적화**: 입력:출력 토큰 비율 100:1. 캐시된 토큰은 10배 저렴. 프롬프트 접두사를 안정적으로 유지
- **todo.md 반복 갱신**: 실행 중 목표를 반복 기술 → "lost-in-the-middle" 효과 방지 — Worker에게 "각 파일 편집 전에 spec의 변경 목표를 다시 읽어라" 패턴 적용 가능
- **에러 보존**: 실패한 액션을 컨텍스트에서 제거하지 않음 → 모델이 암묵적으로 학습. "에러를 정리하지 마라"

---

## 전체 인사이트에서 추출한 추가 흡수 아이디어

### 우선순위 상

| 아이디어 | 출처 | 근거 | 적용 |
|---------|------|------|------|
| **Worker에게 스코프 힌트 명시** | Chase, Anthropic | "에이전트는 적절한 노력 수준을 판단하지 못한다" | spec의 변경 파일 수/규모를 Worker 프롬프트에 "이 이슈는 ~3파일, ~50줄 규모" 명시 |
| **목표 반복 기술 (todo.md 패턴)** | Manus | "lost-in-the-middle" 방지. ~50 도구 호출 태스크에서 효과 검증됨 | Worker에게 "각 파일 편집 전 spec 변경 목표를 다시 읽어라" 지시 |
| **에러 보존 (정리하지 마라)** | Manus, Reflexion | 실패 컨텍스트를 유지하면 암묵적 학습. Reflexion에서 학술적 검증 | FAIL 1 재시도 시 이전 에러 메시지를 Worker에게 전달 (이미 일부 구현) |

### 우선순위 중

| 아이디어 | 출처 | 근거 | 적용 |
|---------|------|------|------|
| **도구 최적화 > 프롬프트 최적화** | Anthropic SWE-bench | "프롬프트보다 도구에 더 많은 시간 투자" | pipeline-cli.mjs 도구 개선 (spec 검증, 배치 상태 조회 등)에 투자 |
| **모델 업그레이드 시 Worker 프롬프트 재검증** | Cognition (Devin) | Sonnet 4.5 전환 시 기존 가정 깨짐 | 모델 변경 시 Worker 프롬프트 A/B 테스트 프로세스 확립 |
| **시맨틱 파일 설명 추가** | Anthropic Tools 가이드 | "시맨틱 이름 > 기술적 ID" | spec 변경 파일 목록에 파일 역할 설명 추가: `src/types/index.ts (사용자 인증 타입 정의)` |

### 관찰/장기

| 아이디어 | 출처 | 근거 | 재평가 시점 |
|---------|------|------|-----------|
| **ADAS 자동 에이전트 설계** | Hu et al. (ICLR 2025) | 메타 에이전트가 인간 설계 능가 | 커맨드 파일 자동 최적화 실험 가능 시 |
| **World Model 기반 에이전트** | LeCun, AMI Labs | LLM의 근본 한계 돌파 | AMI Labs 결과물 공개 시 |
| **RLVR 학습 에이전트** | Karpathy, Sutskever | 사전학습 후에도 계속 학습하는 에이전트 | tip pool을 넘어 Worker 자체가 학습하는 시스템 |

---

## 단일 에이전트 vs 멀티 에이전트 — 리더들의 입장 정리

| 멀티 에이전트 지지 | 단일 에이전트 지지 |
|------------------|-----------------|
| Anthropic: Opus+Sonnet 멀티에이전트가 단일 대비 90.2% 향상 | Cognition: 멀티에이전트 = 취약, 컨텍스트 공유 빈약 |
| Hassabis: "전문화된 모델 스태프를 조율하는 시대" | Simon Willison: 사람 지시 단일 에이전트가 가장 실용적 |
| Swyx: 마이크로서비스 혁명과 동일 패턴 | OpenAI ChatGPT Agent: 다능한 단일 에이전트 선호 |
| Yegge: Gas Town 20-30 병렬 에이전트 | |

**합의**: **태스크가 병렬화 가능하고 경계가 명확할 때 멀티 에이전트, 응집된 순차 추론이 필요할 때 단일 에이전트.** 핵심은 컨텍스트 격리 — 각 서브에이전트에 명확한 경계와 오케스트레이터의 종합.

**우리 시스템의 위치**: MIS로 태스크 경계를 사전에 확정 + Worker 간 직접 통신 없음 → Cognition의 "컨텍스트 공유 빈약" 비판을 구조적으로 회피하면서 Anthropic의 "멀티에이전트 90.2% 향상"을 취하는 설계.

---

# Part 3: 자체 아이디어

외부 프로젝트와 AI 리더 인사이트를 종합해서 도출한 우리만의 새 아이디어.

---

## 연구 에이전트 (Research Agent)

### 문제 인식

현재 파이프라인에서 Worker가 구현에 실패하는 원인 중 **"정보 부족"** 카테고리가 있음:
- 사용해야 할 라이브러리의 API를 모르거나, 학습 컷오프 이후 변경된 API 사용
- 비슷한 기능의 기존 구현이 코드베이스 어딘가에 있는데 못 찾음
- 아키텍처 결정(어떤 패턴, 어떤 라이브러리, 어떤 접근법)을 Worker가 즉흥으로 내림
- spec에 "어떻게 구현하라"는 있지만 "왜 이 방식인가"의 근거가 없음

Cognition(Devin)이 경고: "에이전트는 이전 라이브러리 패턴을 가정한다 — 최신 문서를 명시적으로 제공하라."
Karpathy: "70% 문제 정의, 30% 실행."
ICLR 2025 실패 논문: 명세/시스템 설계 실패가 전체의 37% — 가장 큰 비중.

**핵심 문제: spec phase가 "코드 분석"만 하고 "외부 지식 조사"를 하지 않음.**

### 외부 선행 사례

| 프로젝트 | 리서치 요소 | 한계 |
|---------|-----------|------|
| **Ouroboros** | 소크라테스 인터뷰로 요구사항 정제 | 요구사항 정제이지 기술 리서치 아님 |
| **MetaGPT** | PM 역할이 웹 검색으로 시장 조사 | 시장 조사이지 기술 리서치 아님 |
| **Devin** | Browser 에이전트가 문서 스크래핑 | 구현 중 실시간 조사 — 사전 조사 아님 |
| **Open-SWE** | Planner 그래프가 코드 탐색 + 계획 | 코드베이스 내부만 조사 |
| **Karpathy AutoResearch** | AI가 ML 실험 자율 설계/실행/분석 | 코딩이 아닌 ML 실험 도메인 |
| **Anthropic 멀티에이전트 리서치** | Opus 리드 + Sonnet 서브에이전트 병렬 조사 | 범용 리서치, 코딩 파이프라인 특화 아님 |

**공백: spec 작성 전에 기술적 리서치를 전담하는 에이전트가 있는 프로젝트가 없음.**

### 아이디어: `/basic-research` — spec 전 기술 리서치 phase

**위치: Phase 1.5 (nextplan 이후, spec 이전)**

```
Phase 1: nextplan (이슈 트리아지)
    ↓
Phase 1.5: research (기술 리서치)  ← NEW
    ↓
Phase 2: spec (구현 명세 작성)
    ↓
Phase 3~6: 기존과 동일
```

### 연구 에이전트가 하는 것

이슈별로 다음을 조사하고 **리서치 노트**를 이슈 코멘트에 첨부:

1. **코드베이스 선행 조사**
   - 이슈와 관련된 기존 코드 패턴 탐색 (grep/glob)
   - 유사 기능이 이미 구현되어 있는지 확인
   - 변경 대상 파일의 현재 구조/의존성 파악
   - 재사용 가능한 유틸리티/헬퍼 식별

2. **외부 지식 조사**
   - 사용할 라이브러리/API의 최신 문서 확인 (WebFetch)
   - 비슷한 문제의 일반적 해결 패턴 조사 (WebSearch)
   - 현재 프로젝트의 기술 스택에서의 베스트 프랙티스

3. **아키텍처 결정 근거 (ADR lite)**
   - "왜 이 접근법인가"에 대한 2-3줄 근거
   - 고려했지만 기각한 대안 1-2개
   - 예상 리스크/주의 사항

### 리서치 노트 형식 (이슈 코멘트)

```markdown
## 🔍 Research Note

### 코드베이스 조사
- 유사 구현: `src/utils/auth.ts` — OAuth 플로우 이미 존재, 확장 가능
- 재사용 가능: `src/middleware/validate.ts`의 스키마 검증 패턴
- 주의: `src/types/user.ts`를 변경하면 12개 파일에 영향

### 외부 조사
- [라이브러리 X] v3.2에서 API 변경됨: `createClient()` → `initClient()`
- 권장 패턴: [URL] — retry + exponential backoff

### 아키텍처 결정
- 선택: 미들웨어 패턴 (기존 `validate.ts`와 일관성)
- 기각: 데코레이터 패턴 (프로젝트에 TypeScript 데코레이터 미사용)
- 리스크: rate limiting 추가 시 Redis 의존성 필요 여부 확인 필요
```

### 트레이드오프

| 관점 | 리서치 없이 (현재) | 리서치 에이전트 추가 |
|------|-------------------|-------------------|
| **파이프라인 속도** | spec 즉시 시작 | 리서치 phase 추가 → 시간 증가 |
| **LLM 비용** | 0 추가 | 이슈당 1 에이전트 호출 추가 |
| **spec 품질** | Worker 코드 분석에만 의존 | 외부 지식 + 코드 분석 → 더 정확한 명세 |
| **Worker 성공률** | 정보 부족 시 즉흥 판단 → FAIL | 사전 조사된 정보로 시작 → FAIL 감소 |
| **아키텍처 일관성** | Worker가 독자적 판단 → 프로젝트 내 불일치 | 리서치 노트가 패턴 일관성 가이드 |
| **API 최신성** | 학습 컷오프 기준 (outdated 가능) | WebFetch로 최신 문서 확인 |

### 근거 — 도입하는 이유

**1. Karpathy "70% 문제 정의, 30% 실행" 원칙**
현재 파이프라인은 문제 정의(nextplan + spec)에 투자가 부족. spec이 코드 분석만 하고 외부 조사를 하지 않음. 리서치 phase 추가로 **문제 정의 비중을 높임**.

**2. ICLR 2025 — 명세 실패 37%**
멀티 에이전트 실패의 가장 큰 카테고리가 명세/시스템 설계(37%). spec에 기술적 근거가 부족하면 Worker가 "태스크 명세 불이행" → 실패. 리서치 노트가 spec의 기반 자료가 되어 명세 품질 향상.

**3. Cognition "에이전트는 이전 라이브러리 패턴을 가정한다"**
Claude의 학습 컷오프 이후 변경된 API를 사용하면 Worker가 outdated 코드를 생성. 리서치 에이전트가 WebFetch로 최신 문서를 확인하고 spec에 반영하면 이 문제 해결.

**4. Anthropic "context engineering = right information at right time"**
리서치 노트가 Worker에게 "right information"을 제공. Worker가 직접 조사하면 컨텍스트 소비가 크지만, 사전에 조사해서 요약으로 전달하면 **just-in-time retrieval** 패턴.

**5. Chase "서브에이전트는 광범위 탐색 후 응축된 요약만 반환"**
리서치 에이전트가 광범위 조사 → 이슈 코멘트에 1,000-2,000 토큰 요약 → spec 에이전트와 Worker가 이 요약만 읽음. 컨텍스트 효율 최적.

**6. Sweep "코드 분석 시 컨텍스트 10-15K sweet spot"**
Worker에게 전체 코드베이스를 탐색하게 하면 컨텍스트 과부하. 리서치 에이전트가 미리 관련 코드를 찾아서 요약해주면 Worker는 sweet spot 내에서 작업.

### 근거 — 경량으로 시작하는 이유

**과잉 투자 리스크:**
- 모든 이슈에 리서치가 필요하지는 않음 (단순 버그 수정, 설정 변경 등)
- 리서치 결과가 부정확하면 오히려 Worker를 오도
- phase 추가 = 파이프라인 총 시간 증가

**경량 시작 → 점진적 확장:**
1. 처음에는 `priority:high` 이슈에만 적용
2. 리서치 에이전트가 "리서치 불필요"로 판단하면 스킵
3. 효과 측정 후 medium/low로 확대

### 적용 방안

**Phase 1: 최소 구현 (spec 프롬프트 확장)**
- 별도 phase 추가 없이, `basic-spec`에서 코드 분석 전 **리서치 단계를 프롬프트에 추가**
- spec 에이전트가 코드 분석 + 외부 조사를 같이 수행
- 리서치 결과를 spec body에 `### 기술 조사` 섹션으로 포함
- 구현 비용: 프롬프트 편집만

**Phase 2: 독립 에이전트 분리**
- `/basic-research` 커맨드 신설 — pipeline Phase 1.5
- 이슈별 병렬 리서치 에이전트 스폰 (Sonnet으로 비용 절감)
- 리서치 노트를 이슈 코멘트에 첨부
- spec 에이전트가 리서치 노트를 입력으로 받아 명세 작성
- 구현 비용: 커맨드 파일 1개 + pipeline-cli phase 추가

**Phase 3: 학습 피드백 루프**
- Worker FAIL 원인이 "정보 부족"이면 → 리서치 에이전트 재실행 → 보완된 리서치 노트로 Worker 재시도
- 리서치 성공/실패 패턴을 `research-learning.json`에 축적 (audit-learning.json과 동일 패턴)
- 구현 비용: pipeline-cli 확장 + 학습 파일

### spec 에이전트와의 역할 분리

| 관점 | spec 에이전트 (현재) | 리서치 에이전트 (신규) |
|------|-------------------|---------------------|
| **입력** | 이슈 제목 + body | 이슈 제목 + body + 코드베이스 |
| **조사 범위** | 코드베이스 내부만 | 코드베이스 + 외부 문서/API |
| **출력** | 구현 명세 (변경 파일, 테스트 설계) | 기술 조사 노트 (패턴, API, 근거) |
| **판단 수준** | "무엇을 변경할 것인가" | "왜 이 방식이고, 뭘 알아야 하는가" |
| **모델** | Opus (복잡한 분석) | Sonnet (조사 + 요약, 비용 절감) |

### Anthropic 6패턴 중 어디에 해당하는가

**Prompt Chaining**: Research → Spec → Worker가 순차 체이닝. 리서치 노트가 spec의 입력이 되고, spec이 Worker의 입력이 됨. 각 단계 사이에 **게이트** 가능 (리서치 결과가 비어있으면 "리서치 불필요"로 spec 직행).

### 다른 프로젝트 아이디어와의 시너지

| 결합 대상 | 시너지 |
|----------|--------|
| **구조화된 spec JSON (MetaGPT 5A)** | 리서치 노트도 JSON으로 구조화 → spec 파싱 정확도 향상 |
| **Verification-before-Completion (Superpowers 3A)** | Worker가 리서치 노트의 API 정보와 실제 구현이 일치하는지 증거 첨부 |
| **Stagnation 감지 (Ouroboros 1B)** | Worker FAIL 원인이 "정보 부족" 패턴 → 리서치 재실행 트리거 |
| **목표 반복 기술 (Manus)** | Worker가 각 파일 편집 전 리서치 노트의 핵심 발견을 다시 읽음 |
| **PAL Router (Ouroboros 1A)** | 리서치 결과의 복잡도로 Worker 모델 선택 (단순 패턴 적용 → Sonnet, 새 아키텍처 설계 → Opus) |

### 우선순위: 상

- **Phase 1은 프롬프트 편집만**으로 즉시 적용 가능
- Worker FAIL 감소 → 재시도 감소 → 총 비용 절감
- spec 품질 향상 → MIS 정확도 향상 → 배치 최적화
- 학습 컷오프 문제 해결 — 실제로 자주 발생하는 실패 원인

---

## 앙상블 원칙 — "왜 항상 더 나은 결과가 나오는가"

### 데이터가 말하는 것

수집한 전체 데이터에서 **앙상블(다관점 조합)이 단일 접근을 이기는 패턴**이 반복적으로 나타남:

| 사례 | 단일 | 앙상블 | 향상 |
|------|------|--------|------|
| Anthropic 멀티에이전트 리서치 | Opus 4 단독 | Opus 리드 + Sonnet 서브에이전트 | **+90.2%** |
| Ng HumanEval | GPT-4 zero-shot (67%) | GPT-3.5 + agentic loop (95.1%) | **+28pp** |
| Stanford AgentFlow | GPT-4o 단독 | 7B 모델 + planner+executor+verifier+generator | **+14.9%** (검색) |
| HubSpot Sidekick | 리뷰 에이전트 단독 | 리뷰 에이전트 + Judge 에이전트 | 승인률 **80%**, 노이즈 제거 |
| Reflexion | 단순 재시도 | 실패 → 자기 반성 → 재시도 | HumanEval **91%** (GPT-4 80% 대비) |
| SWE-agent review_on_submit | 바로 제출 | 제출 전 자기 리뷰 + 재현 스크립트 재실행 | SWE-bench 10.7pp 향상 |
| Superpowers 2-Stage Review | 통합 리뷰 1회 | spec 준수 → 품질 순차 2회 | Worker 수정 정확도 향상 |

**공통점: 단일 관점으로 생성 → 다른 관점으로 검증 → 결과가 항상 더 좋다.**

이것은 ML의 앙상블 원칙(Random Forest > Single Tree, Boosting > Single Learner)과 동일한 패턴이 에이전트 레벨에서 재현되는 것.

### 왜 작동하는가 — 이론적 근거

**1. 편향-분산 분해 (Bias-Variance Decomposition)**
- 단일 LLM 호출 = 높은 분산 (같은 프롬프트에도 다른 결과)
- 여러 관점 종합 = 분산 감소 (개별 오류가 상쇄)
- Ng의 데이터가 이를 직접 증명: GPT-3.5의 높은 분산을 반복 + 반성으로 보정 → GPT-4 수준 초과

**2. 관점 다양성 (Perspective Diversity)**
- 생성자는 "만들기"에 최적화된 컨텍스트
- 평가자는 "검증하기"에 최적화된 컨텍스트
- 같은 모델이라도 **프롬프트가 다르면 다른 오류 패턴**을 가짐
- 다른 오류 패턴 = 상호 보완 가능

**3. 복합 오류의 부분적 해결**
- 85%/step → 10step = 20% 문제는 **검증 없는** 순차 실행에서 발생
- 각 step 후 검증을 넣으면: 85% × (검증으로 오류 포착 90%) = 실질 98.5%/step → 10step = 86%
- **앙상블의 핵심은 step 간 검증이지, 병렬 다수가 아님**

### 반대 논거와 해소

**Cognition "Don't Build Multi-Agents"의 실제 주장:**
- "멀티에이전트 = 빈약한 컨텍스트 공유 + 충돌하는 결정" → **이것은 조율 없는 병렬 실행 비판**
- Cognition이 실제로 하는 것: Planner + Coder + Critic + Browser **4개 전문 모델** = 이것도 앙상블
- 그들이 반대하는 것은 "독립 에이전트 N개가 같은 코드베이스에서 동시 작업"이지, "생성-검증 루프"가 아님

**ICLR 2025 멀티에이전트 실패율 41-86.7%:**
- 실패의 31%가 "에이전트 간 불정합" — **직접 통신하는 에이전트** 사이의 문제
- 우리 시스템: Worker 간 직접 통신 없음, MIS로 파일 충돌 사전 제거 → 이 31%가 구조적으로 회피
- 나머지 37%(명세)+31%(검증) = 앙상블(생성-검증 루프)로 감소 가능

**결론: "멀티에이전트 나쁘다"는 잘못된 프레이밍. 정확한 구분은:**
- **나쁜 앙상블**: 독립 에이전트 N개가 조율 없이 같은 자원에 접근 → 혼돈
- **좋은 앙상블**: 생성 → 검증 → 재생성 루프 + 관점 분리 + 컨텍스트 격리 → 품질 향상

### 현재 우리 시스템의 앙상블 현황

| 위치 | 앙상블 존재? | 형태 |
|------|-----------|------|
| **Audit phase** | O | 5개 전문 에이전트 병렬 (보안, 에러, 테스트, 위생, 응집도) |
| **Spec phase** | X | 단일 Opus 에이전트가 분석+작성 동시 수행 |
| **MIS 배치** | X (앙상블 아님) | 알고리즘이지 다관점 검증이 아님 |
| **Worker 실행** | X | 1이슈 = 1Worker. 대안 접근 없음 |
| **Reviewer** | △ | 생성-검증 루프 존재하지만 단일 Reviewer가 모든 관점 통합 |
| **CI auto-loop** | O | 코드 기반 검증(lint, test) + LLM 수정 루프 |

**가장 큰 갭: Spec phase와 Worker 실행에 앙상블이 없음.**

### 적용 방안 — 앙상블을 어디에 넣을 것인가

#### 1. Spec 앙상블: 다관점 명세 검증 (우선순위: 중)

**현재**: Opus 1명이 코드 분석 + 명세 작성 + 테스트 설계를 한 번에 수행
**문제**: 명세 실패 37%(ICLR 2025). Spec이 잘못되면 전체 파이프라인 실패

**앙상블 적용:**
- Spec 에이전트(Opus)가 명세 초안 작성
- **Spec Critic 에이전트(Sonnet)**가 검증: "이 명세로 Worker가 구현 가능한가?"
  - 변경 파일 목록이 실제로 존재하는 파일인가?
  - 테스트 설계가 구체적인가 (파일명, 함수명 수준)?
  - 의존 이슈가 해결 가능한 상태인가?
- Critic 통과 시 → 확정. 미통과 시 → Spec 에이전트에 피드백 → 재작성 (1회만)

**비용 분석:**
- 추가 비용: Sonnet 1회 호출 × 이슈 수 (저렴)
- 절감 효과: spec 부실 → Worker FAIL → 재시도 비용 제거
- 손익분기점: spec 부실률 10% 이상이면 이득

**Stanford AgentFlow와의 연결:** planner + executor + **verifier** + generator 4모듈 중 verifier가 핵심. 7B + verifier가 GPT-4o를 이긴 이유 = 검증이 생성 품질을 보정.

#### 2. Worker 경쟁 실행: Best-of-N (우선순위: 낮 → 고가치 이슈만)

**현재**: 1이슈 = 1Worker. FAIL 시 같은 접근으로 재시도
**문제**: 구조적 문제면 재시도해도 같은 방식으로 실패 (Ouroboros Stagnation)

**앙상블 적용 (high priority 이슈만):**
- 같은 이슈에 대해 **2개 Worker를 다른 프롬프트로 동시 스폰**:
  - Worker A: "기존 코드 패턴을 따라 구현하라"
  - Worker B: "가장 단순한 방법으로 구현하라"
- 둘 다 PR 생성 → Reviewer가 **둘 중 더 나은 것을 선택**
- 나머지 PR은 close

**비용 분석:**
- 추가 비용: Worker 2배 (비쌈)
- 절감 효과: FAIL → 재시도 사이클 제거 (1회에 끝남)
- 적합 조건: `priority:high` + 변경 파일 5개+ 이슈에만 → 전체의 10-20%

**Anthropic의 Parallelization(Voting) 패턴과 일치:** "같은 태스크를 여러 번 시도해서 다양성 확보."

**이것이 Ouroboros의 Lateral Thinking(5 페르소나)보다 나은 이유:**
- 페르소나 전환은 "Hacker처럼 생각해라"라는 프롬프트 변경이지만, LLM이 실제로 다른 접근을 할 보장 없음
- Best-of-N은 **독립 컨텍스트에서 독립 실행** → 실제로 다른 코드가 나옴
- 선택은 Reviewer(Evaluator)에게 위임 → Evaluator-Optimizer 패턴

#### 3. Reviewer 앙상블: 관점 분리 (우선순위: 중)

이미 Superpowers 3D안에서 "Spec 준수 vs 품질"로 논리적 분리를 제안했지만, 앙상블 관점에서 확장:

**현재**: Reviewer 1명이 모든 관점 통합 검증
**앙상블 적용:**
- **Pass 1 (Spec Compliance)**: "diff가 spec과 일치하는가?" — 객관적 검증
- **Pass 2 (Code Quality)**: "코드가 프로젝트 패턴과 일관적인가?" — 주관적 검증
- **Pass 3 (Test Sufficiency)**: "테스트가 변경 사항을 충분히 커버하는가?" — 정량적 검증

이것을 **단일 Reviewer 프롬프트 내 3-pass**로 구현하면 비용 추가 없이 관점 다양성 확보.

HubSpot Judge Agent의 교훈: "코멘트의 간결성, 정확성, 실행 가능성을 별도로 평가." 같은 원리를 리뷰에 적용.

#### 4. 실패에서 학습하는 앙상블: Reflexion 패턴 (우선순위: 중)

**현재**: FAIL 1 → Reviewer 수정 지시서 → Worker 재시도 (같은 에이전트)
**Reflexion 적용:**
- FAIL 1 → Worker가 **자기 반성문** 작성: "왜 실패했는가? 내가 잘못 가정한 것은?"
- 반성문 + Reviewer 수정 지시서 → **새 Worker**(fresh context)에 전달
- 새 Worker는 이전 Worker의 코드가 아닌 **반성문만** 참고 → 다른 접근 가능

**Reflexion 논문 결과**: 이 패턴으로 HumanEval 91% 달성 (GPT-4의 80% 초과). 핵심은 "에러 메시지 전달"이 아닌 **"왜 실패했는지에 대한 자기 분석"** 전달.

**현재 tip pool과의 차이:**
- tip pool: 과거 실패의 **일반화된** 팁 주입 (랜덤 2개)
- Reflexion: **이번 실패에 특화된** 자기 분석 전달
- 둘은 보완적: Reflexion = 단기 학습, tip pool = 장기 학습

### 앙상블 도입 로드맵

```
Phase 1 (즉시): Reviewer 3-pass 관점 분리
  → 프롬프트 편집만. 비용 추가 0.

Phase 2 (단기): Spec Critic + Reflexion 패턴
  → Spec 검증에 Sonnet 1회 추가. FAIL 재시도에 자기 반성 추가.
  → 비용 약간 증가, FAIL 감소로 상쇄 기대.

Phase 3 (중기): Best-of-N Worker (high priority만)
  → 가장 비쌈. priority:high + 대규모 이슈에만 선택적 적용.
  → 데이터 수집 후 ROI 확인 필요.
```

### 핵심 원칙 정리

> **앙상블은 "더 많은 에이전트"가 아니라 "더 많은 관점"이다.**

- 같은 모델이라도 프롬프트가 다르면 다른 관점
- 생성과 검증을 분리하는 것이 가장 저렴한 앙상블
- 독립 컨텍스트에서의 병렬 실행이 가장 효과적인 앙상블
- 검증 단계를 추가하면 복합 오류를 지수적이 아닌 선형적으로 관리 가능

---

# Part 4: 실전 데이터 + 최신 패턴 (2026)

프로덕션 사례, 비용 최적화 수치, 실패 포스트모템, 최신 기법.

---

## 프로덕션 사례 — Stripe, Ramp, Coinbase

### Stripe Minions — 주 1,300 PR, "벽이 모델보다 중요하다"

| 설계 결정 | 세부 | 우리 시스템 대응 |
|----------|------|---------------|
| **도구 큐레이션** | 400개 내부 도구 중 태스크당 ~15개만 제공. "전부 주면 token paralysis" | Worker에게 spec에 명시된 파일/도구만 사용하도록 제한 — 이미 유사하지만 더 명시적으로 강화 가능 |
| **2라운드 CI 상한** | CI 2회 실패 → 중단. 무한 루프 방지 | 우리도 2회 상한 — Stripe가 같은 결론 도달 확인 |
| **Blueprint 아키텍처** | 결정적 노드(파싱, 린트, 테스트) + LLM 노드(추론 필요한 부분만) 하이브리드 | pipeline-cli.mjs가 결정적, 커맨드 프롬프트가 LLM — 같은 패턴 |
| **사전 컨텍스트 로딩** | LLM 호출 전에 Jira + 코드 + 문서를 결정적으로 수집 | 리서치 에이전트(Part 3)가 이 역할 |
| **필수 사람 리뷰** | 자동 머지 없음 | 우리는 Reviewer(LLM) + CI → 선택적 자동 머지 — Stripe보다 자동화 수준 높음 |

### Ramp — PR의 30→50%+가 에이전트 생성

- **Closed-loop 설계**: 생성→실행→검증→반복. "generate-and-pray가 아님"
- 실제 개발 환경(Modal) 접근 — 토이 샌드박스 아님
- **우리에게 시사**: Worker가 PR push 전에 로컬 테스트 실행(MetaGPT 5B + Superpowers 3A)이 closed-loop 패턴의 경량 구현

### Stripe + Ramp + Coinbase 수렴

세 회사가 **독립적으로 같은 아키텍처에 수렴**: 격리된 샌드박스 + 큐레이션된 도구셋 + 서브에이전트 오케스트레이션. LangChain이 이를 Open-SWE로 오픈소스화.

**우리에게 시사**: 우리 아키텍처(Worktree 격리 + spec 기반 도구 제한 + 오케스트레이터-Worker)가 이 수렴 패턴과 일치. 방향이 맞다는 산업적 검증.

---

## 비용 최적화 — 구체적 수치

| 기법 | 절감률 | 구현 난이도 | 우리 적용 가능성 |
|------|--------|-----------|---------------|
| **Prompt caching** | 캐시 토큰 90% 할인 | 낮음 (프롬프트 구조 조정만) | **즉시** — 시스템 프롬프트를 안정적 접두사로 구성 |
| **모델 라우팅 (Plan-Execute)** | 40-90% | 중간 | 이미 구현 (Opus 오케스트레이터 + Sonnet Worker) |
| **대화 히스토리 요약/정리** | 70-90% | 중간 | 사용자가 200-300K에서 /clear로 수동 관리 중 |
| **도구 출력 처리** | 최대 98.7% (150K→2K) | 낮음 | Worker에게 "큰 출력은 파일에 저장, 요약만 보고" 지시 |
| **복합 적용** | 60-80% 전체 | - | 위 기법 조합 시 |

**핵심 수치**: 최적화 안 된 멀티에이전트 시스템은 필요량의 **10-50배 토큰** 소비. 에이전트는 일반 채팅 대비 ~4배, 멀티에이전트는 최대 15배.

**가장 쉬운 첫 번째 조치**: Worker 프롬프트에 "도구 출력이 100줄 이상이면 파일에 저장하고 요약만 컨텍스트에 남겨라" 추가.

---

## 프로덕션 실패 포스트모템 — 실제 재난 사례

| 사건 | 원인 | 교훈 |
|------|------|------|
| **Claude Code 데이터 삭제** | 클라우드 마이그레이션 중 2.5년 프로덕션 데이터 삭제 | "명시적 금지 지시"는 불충분 — 시스템 레벨 차단 필요 |
| **Replit AI** | 프로덕션 코드 수정 + DB 삭제 + **4,000 가짜 유저 생성해서 버그 은폐** | 에이전트는 메트릭을 게이밍할 수 있다 — Kent Beck도 "테스트 삭제해서 통과시킴" 경험 |
| **AWS/Kiro** | AI가 프로덕션 환경을 삭제 후 재생성 → 13시간 중국 AWS 장애 | 에이전트에게 프로덕션 인프라 쓰기 권한 절대 금지 |

**16개월간 6개 주요 AI 코딩 도구에서 10건+ 중대 사고. 벤더 포스트모템 0건.**

**우리 시스템 적용:**
- Worker는 Worktree 내에서만 작업 → 메인 브랜치 직접 수정 불가 (이미 안전)
- 그래도 Worker 프롬프트에 "프로덕션 DB 접근 금지, .env 파일 수정 금지, 테스트 삭제 금지" 명시적 추가 필요
- Kent Beck: **"테스트 삭제를 hard failure로 취급하라"** → Reviewer에게 "diff에 테스트 삭제가 있으면 즉시 FAIL" 지시

---

## 최신 패턴 (2026)

### Spec-Driven Development (SDD) — GitHub Spec Kit

GitHub이 오픈소스화한 `/spec-kit`: spec → plan → task를 레포에 스캐폴딩 → 아무 코딩 에이전트로 구현.

- Martin Fowler 팀(ThoughtWorks)이 2025년 핵심 엔지니어링 실천으로 선언
- "명세가 일급 산출물, 코드는 생성 결과"
- 22개+ 에이전트 플랫폼 지원 (Claude Code, Copilot, Cursor 등)

**우리에게 시사**: `/basic-spec`이 이미 SDD. GitHub Spec Kit의 형식을 참고해서 spec 구조를 표준화하면 **다른 도구와의 호환성**도 확보 가능.

### Judge Agent 패턴 — HubSpot Sidekick

리뷰 에이전트가 생성한 코멘트를 **2차 Judge 에이전트가 평가** (간결성, 정확성, 실행 가능성). 저품질 코멘트 필터링.

- 첫 피드백 시간 ~90% 단축 (최대 99.76%)
- 엔지니어 80% 승인

**우리에게 시사**: Reviewer의 FAIL 지시서 품질이 낮으면 Worker 재시도도 실패. Reviewer 출력에 대한 **메타 검증** 가능성. 다만 비용 2배 → 현재는 Reviewer 프롬프트 강화로 충분.

### Claude Code Hooks — PreToolUse/PostToolUse

| Hook | 타이밍 | 우리 적용 |
|------|--------|---------|
| **PreToolUse** | 도구 실행 전. 차단/수정 가능 | Worker의 파일 편집 전 lint 검증 → SWE-agent의 Linter-Gated Editing을 시스템 레벨에서 구현 가능 |
| **PostToolUse** | 도구 실행 후 | 파일 편집 후 자동 prettier/eslint 실행 → CI auto-loop 전 단계에서 포맷 문제 해결 |
| **Stop** | 에이전트 완료 시 | Worker 완료 시 PR 존재 확인 → Open-SWE 안전망 패턴을 Hook으로 구현 |

**우선순위 상**: PreToolUse Hook으로 Linter-Gated Editing 구현하면 **프롬프트 의존 없이 시스템 레벨에서 강제** 가능. 이것은 SWE-agent 6A안의 최적 구현 방법.

### 에이전트 실행 시간 한계

연구 결과: **모든 에이전트가 35분 이후 성공률 하락, 시간 2배 = 실패율 4배.**

**우리에게 시사**:
- Worker가 35분 이상 걸리는 이슈 → 분할 필요 (Composio 2C안과 연계)
- Spec phase에서 이슈 규모 추정 → 예상 소요 35분+ → 분할 권장 플래그
- 사용자의 200-300K /clear 패턴이 이 한계의 자연스러운 대응

### 멀티에이전트 충돌 해결 — xAI Grok Build

최대 8개 에이전트 동시 작업 + **겹치는 파일 편집의 내장 충돌 해결**.

새로운 합의 메커니즘: early resolution(임계값 도달 시 자동 해결), expiry timer(부실 투표 방지), 설정 가능한 정족수.

**우리에게 시사**: MIS가 사전 충돌 회피를 하지만, **런타임 충돌 감지 + 해결이 없음**은 여전히 갭. xAI가 이 문제를 풀기 시작했다는 것 자체가 우리도 결국 필요해질 신호.

---

## 종합 — 실전 데이터에서 도출된 추가 흡수 아이디어

### 즉시 적용 (프롬프트/설정만)

| 아이디어 | 근거 | 적용 |
|---------|------|------|
| **도구 출력 크기 제한 지시** | 98.7% 토큰 절감 사례 | Worker 프롬프트: "100줄+ 출력은 파일 저장, 요약만 보고" |
| **테스트 삭제 = hard FAIL** | Kent Beck + Replit 사고 | Reviewer 프롬프트: "diff에 테스트 삭제 있으면 즉시 FAIL" |
| **CLAUDE.md를 living document로** | Anthropic 내부 실천 | Worker 실패 패턴 발견 시 CLAUDE.md에 규칙 추가 |

### 단기 도입 (Hook/CLI 변경)

| 아이디어 | 근거 | 적용 |
|---------|------|------|
| **PreToolUse Hook = Linter Gate** | SWE-agent ablation 최고 영향력 + 시스템 레벨 강제 | settings.json에 PreToolUse Hook 추가 → Edit 후 자동 lint |
| **PostToolUse Hook = Auto-format** | CI format 실패 사전 제거 | settings.json에 PostToolUse Hook 추가 → prettier/eslint 자동 |
| **Stop Hook = PR 안전망** | Open-SWE + 프로덕션 재난 사례 | Worker 완료 시 PR 존재 자동 확인 |

### 중기 도입 (파이프라인 확장)

| 아이디어 | 근거 | 적용 |
|---------|------|------|
| **에러 분류 기반 학습 체인** | Ng eval-driven development | `/basic-report`에 실패 원인 분류 → error-analysis.json 축적 → nextplan 피드 |
| **35분 이슈 분할 경고** | 에이전트 35분 한계 연구 | spec에서 규모 추정 → 35분+ 예상 시 분할 권장 |
| **Spec Kit 형식 호환** | GitHub SDD 표준 | spec JSON 구조를 Spec Kit 호환으로 확장 |
