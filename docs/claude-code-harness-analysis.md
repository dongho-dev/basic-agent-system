# Claude Code 하네스 아키텍처 분석

> Anthropic/claude-code v2.1.88 소스 유출 기반 | 2026-04-01 분석

## 개요

2026-03-31 npm `.map` 파일 실수 포함으로 전체 TypeScript 소스 512K줄 유출. Bun 빌드 버그(`oven-sh/bun#28001`)가 원인. 140+개 프롬프트 파일(~661KB, ~165K 토큰), 1,884개 `.ts/.tsx` 파일. 핵심 가치: 모델이 아닌 **하네스 설계** — 프롬프트 기반 오케스트레이션, 도구 제약, 컨텍스트 관리, 보안 정책이 전부 프롬프트로 구현. LangChain/LangGraph 같은 프레임워크 미사용.

**분석 소스:**
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) — 시스템 프롬프트 전체 정리
- [instructkr/claw-code](https://github.com/instructkr/claw-code) — Python/Rust 클린룸 재구현 + 아키텍처 분석
- [sanbuphy/claude-code-source-code](https://github.com/sanbuphy/claude-code-source-code) — v2.1.88 소스 아카이브
- [HN Discussion](https://news.ycombinator.com/item?id=47586778) — 308 댓글 커뮤니티 분석

---

## 흡수 대상 아이디어

각 항목: **아이디어 → 현재 우리 구현 → 상대 구현 → 트레이드오프 → 적용 방안 → 우선순위**

---

### A. Verification Specialist "자기 인식" 패턴 — 리뷰 에이전트의 합리화 방지

**현재 우리 구현:**
- `basic-agents.md` Reviewer에 "증거요구+합리화방지" 지시:
  - PASS 판정 시 근거 증거 필수
  - 합리화 패턴 경고 (구체적 패턴 미열거)
- Codex 3중 리뷰 게이트에서 외부 모델 교차 검증

**Claude Code 구현:**
- 검증 에이전트에게 **"당신은 검증을 잘 못합니다. 이것은 문서화되었고 지속적입니다"** 직접 선언
- 6가지 자기 합리화 패턴 명시적 열거:
  1. 코드 읽기만 하고 PASS 쓰는 경향
  2. 80% 보고 통과시키는 경향
  3. AI 슬롭에 속는 경향
  4. PARTIAL을 불확실성 회피용으로 남용
  5. 경계값/동시성/멱등성 테스트 회피
  6. 환경적 제한을 핑계로 검증 생략
- VERDICT 체계: PASS/FAIL/PARTIAL — PARTIAL은 "환경적 제한"에만 사용
- **적대적 프로브 필수**: 경계값, 동시성, 멱등성, 고아 연산 중 최소 1개

**트레이드오프:**

| 관점 | 현재 (일반 경고) | Claude Code (구체적 열거) |
|------|-----------------|--------------------------|
| **효과** | "합리화하지 마라"는 추상적 → LLM이 자기 행동과 매칭 못함 | 구체적 패턴 열거 → 자기 행동 인식률 높음 |
| **유지보수** | 한 줄이라 수정 불필요 | 패턴 목록 관리 필요 |
| **토큰 비용** | 최소 | ~3K 토큰 추가 |
| **부작용** | 없음 | 과도한 자기 의심 → 모든 것을 FAIL로 판정할 위험 |

**근거 — 흡수하는 이유:**
현재 "합리화하지 마라"는 지시가 너무 추상적이라 LLM이 자신의 행동을 그 범주에 매칭하지 못함. Claude Code의 접근법은 "당신은 이런 실수를 합니다"를 거울처럼 보여주는 메타적 기법. 우리의 Reviewer 프롬프트에 구체적 합리화 패턴 6개를 열거하면 리뷰 품질 즉시 향상 기대.

**적용 방안:**
1. `basic-agents.md` Reviewer 프롬프트에 "당신이 빠지는 6가지 함정" 섹션 추가
2. PASS 판정 시 적대적 프로브 1개 이상 수행 필수 조건 추가
3. Codex rescue 게이트에도 동일 패턴 적용 — GPT 리뷰어도 같은 합리화 경향 있음

**우선순위:** 높
- 프롬프트 수정만으로 즉시 적용 가능 (코드 변경 없음)
- 리뷰 게이트는 파이프라인 품질의 최종 방어선

---

### B. Plan Mode 40줄 하드 리밋 — spec 장황함 방지

**현재 우리 구현:**
- `basic-spec.md`에서 구현 명세서 작성 → 분량 제한 없음
- spec이 길어지면 Worker가 컨텍스트 소모 → 핵심 놓침
- 배경 설명, 사용자 요청 재진술 등이 spec에 포함되는 경우 있음

**Claude Code 구현:**
- Plan Mode Phase 4에서 **40줄 하드 리밋** 강제
- 명시적 금지: 배경 설명, 개요, 사용자 요청 재진술
- 허용: "파일:변경" 쌍 + 검증 명령 1개만
- 효과: LLM의 장황함을 구조적으로 차단

**트레이드오프:**

| 관점 | 현재 (무제한) | 40줄 제한 |
|------|-------------|----------|
| **정보 밀도** | 낮음 — 반복/배경이 섞임 | 높음 — 액션만 남음 |
| **Worker 이해도** | 배경까지 읽으면 이해 가능 | 핵심만 있어서 오히려 명확 |
| **복잡한 이슈** | 길어도 전부 담을 수 있음 | 복잡한 이슈는 40줄에 못 담을 위험 |
| **구현 비용** | 0 | 프롬프트 1줄 추가 |

**근거 — 흡수하는 이유:**
LLM은 본질적으로 장황함. spec이 길어지면 Worker가 앞부분은 잊고 뒷부분만 실행하는 패턴이 반복됨. 40줄 제한은 "파일:변경" 쌍 중심으로 강제하여 Worker가 즉시 실행 가능한 형태로 spec을 압축. 복잡한 이슈는 40줄이 아닌 **50줄** 정도로 우리 맥락에 맞게 조정.

**적용 방안:**
1. `basic-spec.md`에 "명세서는 50줄 이내, 배경/개요/요청 재진술 금지, 파일:변경 쌍 + 검증 명령만 포함" 규칙 추가
2. 50줄 초과 시 명시적으로 분할 지시 (이슈 분리 → 각각 50줄 이내)

**우선순위:** 중
- 현재 spec 분량 문제가 관찰된 적 있으나 빈도 낮음
- Worker FAIL 원인이 "spec 과잉"으로 분류될 때 즉시 도입

---

### C. Fork의 "Don't peek, Don't race, Never delegate understanding" — 에이전트 위임 품질 가이드라인

**현재 우리 구현:**
- `basic-agents.md` Phase 4-6에서 Worktree 격리 병렬 실행
- 에이전트 위임 프롬프트는 이슈 + spec 기반으로 자동 구성
- 위임 프롬프트 품질에 대한 명시적 가이드라인 없음

**Claude Code 구현:**
- **Don't peek**: 포크의 output_file을 읽지 말 것 → 노이즈 유입 방지
- **Don't race**: 결과 예측/날조 금지 → "알림 도착 전엔 아무것도 모른다"
- **Never delegate understanding**: 서브에이전트에게 합성을 떠넘기지 말고, 파일경로/줄번호/구체적 변경을 포함한 프롬프트 작성
- 포크 에이전트 10개 불변 규칙: 하위 에이전트 생성 금지, 질문 금지, 편집 논평 금지, 도구 사이 텍스트 출력 금지, 500단어 이내 보고서
- 출력 형식 강제: `Scope:`, `Result:`, `Key files:`, `Files changed:`, `Issues:`

**트레이드오프:**

| 관점 | 현재 (암묵적) | 명시적 가이드라인 |
|------|-------------|-----------------|
| **위임 품질** | 프롬프트 품질이 실행마다 들쭉날쭉 | 일관된 고품질 위임 |
| **프롬프트 길이** | 짧음 | 가이드라인 포함으로 길어짐 |
| **유연성** | 높음 — 상황에 맞게 자유 | 10개 불변 규칙으로 제약 |
| **보고서 품질** | Worker 재량 | 구조화된 5섹션 보고서 |

**근거 — 흡수하는 이유:**
현재 Worker 위임 시 프롬프트 품질이 편차가 크고, Worker가 불필요한 질문을 하거나 관련 없는 파일을 탐색하는 경우가 있음. "Never delegate understanding" 원칙은 위임자(코디네이터)가 충분히 이해한 후에만 위임하도록 강제하여 Worker 성공률을 높임.

**적용 방안:**
1. `basic-agents.md` Worker 위임 섹션에 3원칙 추가:
   - Don't peek: Worker 실행 중 중간 결과 확인 금지
   - Don't race: Worker 완료 전 결과 예측 금지
   - Never delegate understanding: 파일경로/줄번호 포함된 구체적 프롬프트만 위임
2. Worker 보고서 형식 표준화: `Scope → Result → Key files → Files changed → Issues`
3. Worker에 "질문 금지, 하위 에이전트 생성 금지" 불변 규칙 추가

**우선순위:** 높
- Phase 4-6 에이전트 위임 이미 사용 중
- 프롬프트 수정만으로 즉시 적용 가능

---

### D. 4단계 컨텍스트 관리 파이프라인 — 컨텍스트 피로 방지 고도화

**현재 우리 구현:**
- Phase 3→4 컨텍스트 브레이크: 에이전트 위임으로 컨텍스트 분리
- `/clear` 수동 세션 리셋 (200-300K 구간)
- 컴팩션은 시스템 자동 처리에 의존

**Claude Code 구현:**
4단계 파이프라인, 각 단계가 다른 전략:
1. **Snip** (`HISTORY_SNIP`): 오래된 히스토리 선택적 제거 (트림)
2. **Microcompact** (`CACHED_MICROCOMPACT`): 세밀한 캐시 기반 압축
3. **Context Collapse** (`CONTEXT_COLLAPSE`): 컨텍스트 접기 서비스
4. **Auto Compact**: 토큰 임계치 초과 시 전체 요약
   - 보존: 미완료 작업 추론, 핵심 파일 참조 추출(최대 8개), 최근 사용자 요청 3개, 전체 타임라인
   - 연속성 메시지: "Resume directly — do not acknowledge the summary, do not recap"
- **Prompt-too-long 복구**: 413 에러 시 Context Collapse → Reactive Compact 순서 시도
- **max_output_tokens 복구**: 출력 한도 초과 시 "Resume directly" 메시지로 최대 3회 자동 복구

**트레이드오프:**

| 관점 | 현재 (수동 브레이크) | 4단계 파이프라인 |
|------|-------------------|----------------|
| **자동화** | 수동 `/clear` 의존 | 완전 자동 단계적 처리 |
| **정보 보존** | 브레이크 시 전부 리셋 | 단계별 선택적 보존 |
| **구현 비용** | 0 | 4단계 각각 구현 필요 |
| **디버깅** | 명확 (끊김/이어짐) | 어느 단계에서 정보 손실됐는지 추적 어려움 |

**근거 — 흡수하는 이유:**
현재 컨텍스트 피로 방지가 "에이전트 위임"이라는 단일 전략에 의존. Claude Code는 4단계로 세분화하여 각 단계에서 정보 손실을 최소화. 특히 **컴팩션 시 "미완료 작업 추론" + "핵심 파일 참조 추출"** 패턴은 우리 파이프라인의 Phase 간 컨텍스트 전달에 직접 적용 가능.

**적용 방안:**
1. Phase 간 컨텍스트 전달 시 "미완료 작업 + 핵심 파일 참조 + 최근 요청 3개" 형식 표준화
2. 에이전트 위임 프롬프트에 "Resume directly — do not recap" 지시 추가
3. 4단계 전체 도입은 과잉 — **컨텍스트 전달 형식 표준화**로 한정

**우선순위:** 중
- 현재 컨텍스트 브레이크가 동작하고 있으므로 급하지 않음
- Phase 간 정보 손실이 관찰되면 도입

---

### E. Security Monitor "Silence is not consent" + BLOCK/ALLOW 체계

**현재 우리 구현:**
- 보안 정책 명시적 미설정
- Claude Code 기본 권한 시스템에 의존
- 에이전트 자율 행동 범위 미정의

**Claude Code 구현:**
- **Security Monitor**: ~27KB, 시스템 최대 단일 컴포넌트
- 위협 모델 3가지: Prompt Injection, Scope Creep, Accidental Damage
- 기본 규칙: "Default ALLOW" — BLOCK 조건 매칭 + ALLOW 예외 없을 때만 차단
- BLOCK 30+ 항목, ALLOW 7개 예외
- **"Silence is not consent"**: 연속 행동 사이 사용자 미개입 ≠ 묵시적 승인
- **"Committing = Executing"**: `git push`를 코드 실행과 동등 취급
- **User Intent Rule 6가지**: 사용자 요청 vs 에이전트 자율 구분, 범위 확대 = 자율적 행동, 질문 ≠ 동의
- 평가 규칙 12개: Composite Actions, Written File Execution, Sub-Agent Delegation 등

**트레이드오프:**

| 관점 | 현재 (기본 의존) | 명시적 BLOCK/ALLOW |
|------|----------------|-------------------|
| **안전성** | 기본 시스템만 의존 | 프로젝트 맞춤 보안 정책 |
| **자율성** | 제한적 (매번 확인) | ALLOW 범위 내 자유, BLOCK은 절대 차단 |
| **유지보수** | 0 | BLOCK/ALLOW 목록 관리 |
| **파이프라인 속도** | 확인 프롬프트로 지연 | ALLOW 범위 내 무중단 |

**근거 — 흡수하는 이유:**
자율 파이프라인에서 에이전트가 범위를 넘어서는 행동을 하는 것은 가장 위험한 실패 모드. "Silence is not consent"와 "Committing = Executing"은 자율 에이전트 설계의 핵심 원칙으로, 우리 파이프라인의 안전 가이드라인에 명시할 가치가 있음.

**적용 방안:**
1. 파이프라인 공통 규칙에 2원칙 추가:
   - "묵시적 승인 금지": 이전 단계 승인이 다음 단계를 자동 승인하지 않음
   - "커밋 = 실행": push 전 반드시 리뷰 게이트 통과
2. Worker BLOCK 목록 정의: force push, main push, 프로덕션 배포, 외부 서비스 호출
3. Worker ALLOW 목록 정의: 로컬 파일 편집, 테스트 실행, 작업 브랜치 push

**우선순위:** 중
- 현재 파이프라인이 로컬 개발 환경에서만 동작하므로 리스크 낮음
- 프로덕션 배포나 외부 서비스 연동 시 필수

---

### F. 도구 동시성 파티셔닝 — 읽기/쓰기 분리 병렬화

**현재 우리 구현:**
- Worktree 격리로 Worker 간 병렬화 달성
- Worker 내부의 도구 호출 순서/병렬화는 Claude Code 기본 동작에 의존

**Claude Code 구현:**
- `StreamingToolExecutor`: 도구가 스트리밍 중 도착하는 즉시 실행 시작
- 동시성 분류:
  - **ConcurrencySafe** (Glob, Grep, Read): 서로 병렬 실행
  - **비-ConcurrencySafe** (Bash, Edit): 단독 직렬 실행 (배타적 접근)
- 각 도구가 `isConcurrencySafe(input)` 메서드로 **입력 기반** 동적 판단
- 에러 전파: Bash 에러만 형제 도구 취소 (암묵적 의존성 체인), Read/WebFetch 등은 독립
- 최대 동시성: `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 환경변수 (기본 10)

**트레이드오프:**

| 관점 | 현재 (Worktree 병렬) | 도구 레벨 병렬 |
|------|--------------------|--------------|
| **병렬화 수준** | Worker 간 (거시적) | 도구 호출 간 (미시적) |
| **구현 위치** | 우리 파이프라인 | Claude Code 내부 (제어 불가) |
| **효과** | 이슈 간 병렬 | 단일 이슈 내 속도 향상 |

**근거 — 흡수하는 이유:**
우리가 직접 제어할 수 있는 부분은 아니지만, 아키텍처 패턴으로서 가치가 있음. 읽기/쓰기 분리 원칙은 우리 파이프라인의 Phase 설계에도 적용 가능 — 읽기 전용 Phase(discover, audit)를 병렬화하고, 쓰기 Phase(agents)는 직렬화.

**적용 방안:**
1. 파이프라인 Phase 분류: 읽기 전용(discover, audit, nextplan, spec) vs 쓰기(agents)
2. 읽기 전용 Phase 간 병렬 실행 가능성 검토 (현재 순차)
3. `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 환경변수 조정으로 Worker 내 병렬화 최적화

**우선순위:** 낮
- 현재 파이프라인 속도 병목은 도구 레벨이 아닌 Phase 레벨
- 파이프라인 규모가 커질 때 재평가

---

### G. 코드 주석 = 에이전트 장기 메모리 — HN 커뮤니티 핵심 교훈

**현재 우리 구현:**
- CLAUDE.md 기반 프로젝트 지시
- auto-memory 시스템 (MEMORY.md 인덱스)
- 코드 내 주석은 별도 전략 없음

**HN 커뮤니티 발견:**
- "에이전트는 문서를 읽을 수도 안 읽을 수도 있지만, **작업 시야에 있는 코드 주석은 항상 읽는다**"
- "인프라 없이 무료 장기 에이전트 메모리를 얻는 것"
- "에이전트 코딩 모범 사례의 거의 전부가 우리가 원래 해야 했던 것들"
- 반론: "몇 년 지나면 주석이 낡아서 오히려 해가 됨" → 재반론: "에이전트에게 diff 읽고 주석 정확성 검증 역할 부여"

**트레이드오프:**

| 관점 | 현재 (CLAUDE.md 중심) | 코드 주석 활용 |
|------|---------------------|--------------|
| **가시성** | 별도 파일 → 항상 로드되지는 않음 | 작업 파일에 내장 → 항상 보임 |
| **유지보수** | 인덱스 관리 | 코드와 함께 자연 갱신/부패 |
| **범위** | 프로젝트 전체 | 파일/함수 단위 |
| **토큰 비용** | 시스템 프롬프트로 매번 로드 | 해당 파일 읽을 때만 |

**근거 — 흡수하는 이유:**
CLAUDE.md는 프로젝트 레벨 지시에 적합하지만, 특정 파일/함수의 "왜 이렇게 했는지"는 코드 주석이 더 효과적. 에이전트가 해당 파일을 편집할 때 자연스럽게 주석을 읽으므로 추가 비용 없이 컨텍스트 전달.

**적용 방안:**
1. 스킬 프롬프트 파일(`.claude/commands/`)에 핵심 설계 의도 주석 추가
2. pipeline-cli.mjs 등 핵심 인프라 코드에 "왜" 주석 보강
3. Worker에게 "기존 주석 유지, 변경 시 주석도 업데이트" 지시 추가

**우선순위:** 낮
- 현재 코드베이스 규모가 작아 CLAUDE.md로 충분
- 코드베이스 성장 시 자연스럽게 필요해질 것

---

## 아키텍처 참고 사항

### 핵심 아키텍처 수치

| 항목 | 수치 |
|------|------|
| 전체 시스템 프롬프트 | ~661KB, ~165K 토큰 |
| Security Monitor | ~27KB (시스템 최대 단일 컴포넌트) |
| 도구 수 | 18개 빌트인 + MCP 확장 |
| 서브에이전트 종류 | Plan, Explore(Haiku), General-Purpose, Fork, Worker, Verification Specialist |
| 컴팩션 보존 메시지 | 최근 4개 |
| 에이전트 루프 최대 반복 | 16회 |
| 도구 최대 동시성 | 10 (환경변수 조정 가능) |
| max_output_tokens 자동 복구 | 최대 3회 |
| Feature flag 패턴 | `tengu_` 접두사 + 무작위 단어쌍 (난독화) |
| 부트스트랩 | 12단계 FastPath (시작 시간 최적화) |

### 메인 에이전트 루프

```
User → Assistant(+ToolUse) → ToolResult → Assistant(+ToolUse) → ... → Assistant(TextOnly)
```

`query.ts` (~785KB, 1,729줄)의 `while(true)` AsyncGenerator 루프:
1. 메시지 전처리 (normalizeMessagesForAPI)
2. Snip → Microcompact → Context Collapse → Auto Compact (4단계 컨텍스트 관리)
3. Claude API 스트리밍 호출
4. ToolUse 감지 → 권한 확인 → 실행 → tool_result → 루프 반복
5. stop_reason ≠ "tool_use" → 종료

### 도구 정의 구조

- JSON Schema가 아닌 **자연어 description** 방식
- `buildTool()` 팩토리: 안전한 기본값 (fail-closed)
- 각 도구의 메서드: `isConcurrencySafe()`, `isReadOnly()`, `isDestructive()`, `checkPermissions()`
- Bash 도구에만 **7개 이상의 별도 샌드박스 정책 파일**

### 서브에이전트 체계

| 에이전트 | 모델 | 핵심 특성 |
|----------|------|----------|
| **Explore** | Haiku (경량) | 읽기 전용, 병렬 도구 극대화, quick/medium/thorough 3단계 |
| **Plan** | inherit | 읽기 전용, 5단계 워크플로, Phase 4에서 40줄 하드 리밋 |
| **General-Purpose** | inherit | 전체 도구, "방에 막 들어온 동료" 비유 |
| **Fork** | inherit | 부모 컨텍스트 상속, 프롬프트 캐시 공유, 10개 불변 규칙 |
| **Worker** | inherit | 구현 + Simplify + 테스트 + 커밋 + PR의 5단계 필수 |
| **Verification Specialist** | inherit | "당신은 검증을 못합니다" 자기 인식, PASS/FAIL/PARTIAL |

### 미출시 기능 코드네임 (로드맵 참고)

| 코드네임 | 설명 |
|----------|------|
| **KAIROS** | 자율 에이전트 모드 — `<tick>` 하트비트, 푸시 알림, PR 구독, `/dream` 야간 메모리 증류 |
| **Buddy** | 다마고치 이스터에그 — 18종 생물, 희귀도 등급, RPG 스탯 |
| **Undercover Mode** | Anthropic 직원 전용, AI 흔적 제거 (공개 저장소 기여 시) |
| **Anti-Distillation** | API 요청에 가짜 도구 주입 → 경쟁사 distillation 오염 |
| **VOICE_MODE** | 푸시-투-톡 음성 입력 (WebSocket, mTLS) |
| **COORDINATOR_MODE** | 멀티 에이전트 코디네이터 |
| **DAEMON** | 백그라운드 데몬 슈퍼바이저 |
| **Numbat** | 차세대 모델 코드네임 |

### HN 커뮤니티 주요 논쟁

1. **Undercover Mode** — AI 귀속 투명성 vs 내부정보 보호 (60+ 댓글 최대 논쟁)
2. **바이브 코딩** — Claude Code 자체가 Claude로 바이브 코딩됨 → 능력 증명이자 품질 우려
3. **저작권** — AI 생성 코드 비중이 높으면 회사 소스코드 저작권 약화 가능성
4. **DMCA** — 유출 코드 미포함 포크까지 일괄 테이크다운 → 역효과
5. **"프롬프트가 곧 아키텍처"** — LangChain/LangGraph 무용론 증폭
