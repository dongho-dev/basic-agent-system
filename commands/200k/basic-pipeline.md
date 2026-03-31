> 전체 파이프라인 자동 실행 (Phase 1~6) | context_tier: 200k

이슈 트리아지부터 에이전트 실행까지 전체 파이프라인을 자동으로 진행합니다.

인자: `$ARGUMENTS` (선택)

- 미지정: 승인 게이트 없이 끝까지 자동 실행
- `--confirm`: 2개 승인 게이트에서 멈춤

## 중단 후 재실행

컨텍스트/토큰 소진으로 중단된 경우, 새 세션에서 재실행.

**Phase 감지**: `scripts/pipeline-cli.mjs`가 존재하면 `node scripts/pipeline-cli.mjs status`로 현재 상태를 파악하여 해당 Phase부터 재개한다. 없으면 `logs/status.json`을 확인하고, 둘 다 없으면 Phase 1부터 시작.

파이프라인은 멱등(idempotent)하게 설계되어 있다:

- 닫힌 이슈는 트리아지에서 제외
- 명세 있는 이슈는 spec에서 건너뜀
- MIS는 현재 open 이슈 기준으로 재계산

**기존 PR 감지**: Phase 1에서 `gh pr list --state open`으로 이전 실행의 draft/open PR을 확인한다. 해당 이슈는 "PR 진행 중"으로 표시하고 중복 실행을 방지한다.

## 파이프라인 CLI 연동

프로젝트에 `scripts/pipeline-cli.mjs`가 있으면 **모든 phase 전환을 CLI로 수행한다.** 없으면 수동으로 phase를 추적한다.

CLI 사용 시:

- 순서 위반을 코드가 차단 (LLM 판단에 의존하지 않음)
- 세션 간 상태가 JSON 파일로 정확히 유지
- 매 전환마다 리마인더 + 랜덤 팁 출력 (recency bias 활용)

```bash
# 파이프라인 시작 (또는 기존 상태 확인)
node scripts/pipeline-cli.mjs init    # 신규 시작
node scripts/pipeline-cli.mjs status  # 재개 시 상태 확인

# 각 phase 전환
node scripts/pipeline-cli.mjs advance <phase>
# ... phase 작업 수행 ...
node scripts/pipeline-cli.mjs complete <phase> '<output-json>'
```

## 파이프라인 흐름

```
[CLI init 또는 status] (CLI 있을 때)
  ↓
(선택) audit (트리아지) — optional, 건너뛰기 가능
  ↓
[CLI advance nextplan]
/basic-nextplan (트리아지)
[CLI complete nextplan '{"workable_issues":[...],"total":N}']
  ↓
[--confirm 시 승인 게이트 1] "이 이슈들 진행?"
  ↓
[CLI advance spec]
/basic-spec (명세 작성)
[CLI complete spec '{"specs":[...]}']
  ↓
[CLI advance review-issues]
/basic-review-issues (계획 수립)
[CLI complete review-issues '{"selected_issues":[...],...}']
  ↓
[--confirm 시 승인 게이트 2] "이 배치로 실행?"
  ↓
[CLI advance run-agents]  ← 검증: 닫힌 이슈, 허브 이슈, 파일 겹침
  ├─ 이슈 ≤3개 → 직접 구현 → PR → CI 확인 → 머지 (Phase 4-B)
  └─ 이슈 >3개 → /basic-agents (Phase 4)
[CLI complete run-agents '{"batches_result":[...],...}']
  ↓
[CLI advance worktree-clean]
/basic-worktree-clean (정리)
[CLI complete worktree-clean '{"cleaned":true}']
  ↓
회고 보고서 작성 + main push
```

## 컨텍스트 관리

Phase 간 이슈 목록 재수집을 최소화한다:

- Phase 1(nextplan)에서 가져온 이슈 목록이 컨텍스트에 남아있으면, Phase 2(spec)와 Phase 3(review-issues)에서 **재수집을 생략**한다.
- 이슈 목록에 변동이 있는 경우(audit 직후 등)에만 재수집한다.

## 실행 방식

### 이슈 수 경고

| 워커가능 이슈 수 | 조치                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| ~150개           | 정상 진행                                                                          |
| 150~300개        | ⚠️ 주의: 컨텍스트 소모 증가. spec 완료 후 새 세션에서 review-issues 이후 진행 권장 |
| 300개+           | 🔴 경고: 세션 분할 강력 권장. spec을 그룹별 분할 실행                              |

### Phase 1: 트리아지 (/basic-nextplan)

1. open 이슈 전체 조회 (200개)
2. 중복 탐지 → 자동 닫기 (--confirm 시 확인 요청)
3. 카테고리 분류 (워커가능/대규모/외부의존/완료)
4. 우선순위 태깅 (🔴/🟡/🟢) + GitHub 라벨 부여 (priority:high/medium/low)
5. 워커 실행 가능 이슈 **전체** 목록 확정 (걸러내지 않음)

**결정 요약 출력** (Phase 완료 시 반드시):

```
## Phase 1 결정 요약
- 워커가능: N개 / 제외: 허브 K개, 대규모 L개, PR진행중 M개
- 중복 닫힘: X개 (사유 1줄씩)
- 다음 Phase 영향: 명세 필요 N개 (기존 명세 M개 스킵 예상)
```

--confirm 모드: 이슈 목록을 보여주고 승인 대기.
자동 모드: 워커 실행 가능 이슈 전부 다음 단계로.

### Phase 2: 명세 (/basic-spec)

1. **워커가능 전체** 이슈 대상 (명세 없는 것만)
2. 이미 명세 있는 이슈는 건너뜀 (멱등)
3. 코드 분석 → GitHub 이슈 본문에 명세 기록
4. 8개 이하 본체 직접, 9개 이상 Opus Agent 그룹 병렬 (8개씩 균등 분배)

**핵심:** triage가 선정하지 않으므로 워커가능 전체를 spec한다. spec은 멱등 + 재사용 가능 → 초기 투자 후 이후 pipeline에서 Phase 2 스킵.

### Phase 3: 계획 (/basic-review-issues)

1. 명세 있는 이슈의 Write 파일 매핑 (파싱)
2. **워커가능 전체 풀**에서 충돌 분석 + MIS 계산 (priority 라벨로 타이브레이크) → 독립 배치 최대화
3. 실행 방식 결정 (직접 vs agents)
4. 배치 구성 (배치당 상한 5~6개)

직접 처리 판정 시 (이슈 3개 이하):
→ Phase 4 건너뛰고 직접 구현 시작.
→ 구현 → PR 생성 → CI 확인 → 머지/보고 (Phase 4-B).

**결정 요약 출력** (Phase 완료 시 반드시):

```
## Phase 3 결정 요약
- MIS: N개 선정 / K개 제외
- 제외 핵심 사유: {공유 파일}에서 {이슈들} 충돌 → {선택 이슈} 우선 (priority 기준)
- 제외 이슈의 다음 파이프라인 처리 가능성: 이번 머지로 충돌 해소 여부
- 배치: M개, 실행 방식: basic-agents / 직접 처리
```

--confirm 모드: 배치 구성을 보여주고 승인 대기.
자동 모드: 바로 Phase 4로.

### Phase 4: 실행 (/basic-agents)

**`/basic-agents` 커맨드를 그대로 실행한다. 자체 구현 금지.**
Phase 3의 배치 구성을 `/basic-agents`에 전달하면 된다.

`/basic-agents`가 수행하는 것:

1. Worktree 사전 생성 + 격리 검증
2. 오케스트레이터 프롬프트 생성 (워커 프롬프트 끝에 **리마인더 + 랜덤 팁** 포함)
3. 백그라운드 병렬 실행 (polling 금지 — 알림 대기)
4. 리뷰어 검증 (PASS/FAIL/BLOCKED, 전체 코드 맥락 리뷰, unplannedWrites 명시 검증)
5. PR 생성 + CI 확인
6. 머지 (사용자 명시 지시 시에만)
7. **머지 후 관련 이슈 자동 닫기** (`closes #N` 또는 `gh issue close`)
8. 작업 보고서 작성

### Phase 4-B: 직접 처리 후속 (직접 처리 경로)

Phase 3에서 직접 처리로 판정된 경우, 구현 완료 후 실행:

1. **리뷰 수행 (권장)**: PR diff와 이슈 명세를 대조하여 명세 충족 여부, 누락/과잉 구현, 부작용 확인. 직접 처리 경로도 basic-agents와 동일한 검증 기준을 적용한다.
2. `gh pr list`로 생성된 PR들의 CI 상태 확인
3. CI 전부 통과 확인
4. 자동 모드: `gh pr merge --squash`로 즉시 머지 (`--delete-branch` 미사용)
5. --confirm 모드: CI 결과 보고 후 사용자 승인 대기 → 승인 시 머지
6. **머지 후 관련 이슈 자동 닫기**
7. `git pull origin main` + 로컬 브랜치 정리

### Phase 5: 정리 (/basic-worktree-clean)

basic-agents 완료 후 (성공/실패 무관) 잔여 worktree를 정리한다.

- `git worktree list`로 확인
- main 외 worktree 제거
- `.claude/worktrees/` 잔여 디렉토리 삭제
- 머지 완료된 feature 브랜치 정리

### Phase 6: 회고 보고서 (/basic-report)

**`/basic-report` 커맨드를 실행한다.** 보고서 템플릿, 데이터 수집 절차, 자기 검증 체크리스트가 모두 커맨드에 내장되어 있으므로 여기서 중복 기술하지 않는다.

```bash
# 보고서 작성 + 자기 검증 + 교훈 반영 + push까지 /basic-report가 수행
```

보고서 저장 후 터미널 완료 요약 출력:

```
## Pipeline 완료

Phase 1 (트리아지): N개 open → K개 워커 실행 가능
Phase 2 (명세): K개 중 M개 신규 명세 작성
Phase 3 (계획): MIS P개, Q개 배치
Phase 4 (실행): R개 PR 생성
Phase 5 (정리): worktree 정리 완료
Phase 6 (보고서): docs/reports/YYYY-MM-DD-{주제}.md 저장 + push

결과:
- ✅ 머지 완료: PR #A, #B, #C (이슈 #X, #Y, #Z 닫힘)
- ❌ BLOCKED: #D (사유)
- ⚠️ CI 실패: #E (로그 URL)

보류 이슈: #X, #Y (대규모/외부의존)
```
