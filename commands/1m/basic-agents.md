> Worktree 격리 병렬 실행 + 리뷰 + PR | context_tier: 1m

멀티 에이전트 시스템을 실행합니다. 배치 계획을 받아서 실행만 합니다.

프로젝트에 `docs/agent-system/system-spec.md` 또는 유사한 에이전트 명세 파일이 있으면 해당 프로토콜을 따릅니다. 없으면 아래 기본 프로토콜을 적용합니다.

사전 조건: `/basic-review-issues`로 배치 구성이 확정된 상태.

## Step 0: 잔여 Worktree 복구 탐지

이전 실행이 중단된 경우를 감지한다.

git 상태로 판단:

```bash
git worktree list --porcelain | grep "^worktree" | grep "batch-" | while read _ path; do
  branch=$(git -C "$path" rev-parse --abbrev-ref HEAD)
  commits=$(git -C "$path" log --oneline origin/main.. 2>/dev/null | wc -l)
  pr=$(gh pr list --head "$branch" --json number --jq '.[0].number' 2>/dev/null)

  if [ "$commits" -gt 0 ] && [ -z "$pr" ]; then
    echo "RECOVERY: $path — $commits commits, PR 없음"
  fi
done
```

| 상태 | 조치 |
|------|------|
| 커밋 있음 + PR 없음 | push → PR 생성 → CI 확인 |
| 커밋 있음 + PR 있음 (draft/open) | PR 상태 확인 → 리뷰어 검증으로 이동 |
| 커밋 없음 | worktree 제거 후 새로 생성 |

복구할 배치가 없으면 Step 1로 진행.

## Step 1: Worktree 설정

배치별 worktree를 **순차적으로** 생성한다 (`isolation: "worktree"` 사용 금지 — 동시 생성 시 경합으로 main 오염 위험):

```bash
git worktree add .claude/worktrees/batch-a -b fix/batch-a
git worktree add .claude/worktrees/batch-b -b fix/batch-b
# 배치 수에 따라 추가
```

**격리 검증** — 생성 직후 반드시 확인:
```bash
git worktree list
# main 외 모든 배치가 .claude/worktrees/ 아래에 있는지 확인
# main repo가 fix/* 브랜치에 있으면 즉시 중단
```

logs/, proposals/, reviews/ 디렉토리 생성:
```bash
mkdir -p logs proposals reviews
```

배치 계획은 pipeline CLI의 `review-issues` output(또는 대화 컨텍스트)에 이미 기록되어 있으므로 별도 상태 파일을 생성하지 않는다.

## Step 2: 오케스트레이터 프롬프트 생성

프로젝트에 오케스트레이터/워커/리뷰어 템플릿이 있으면 사용하고, 없으면 직접 작성한다.

각 오케스트레이터 프롬프트에 포함할 내용:
- {BATCH_NAME}: 배치 이름
- {BRANCH}: 브랜치명
- {WORKTREE_PATH}: worktree 절대경로
- {WORKERS}: 워커 목록 (이슈 번호 + Write 허용 파일 + priority)
- {SPECS}: 각 이슈의 명세 전문 (1M 컨텍스트 활용 — 오케스트레이터가 전체 맥락을 파악하여 워커 간 잠재 충돌 감지 및 실행 순서 최적화)
- {MERGE_PRIORITY}: 머지 순서 기준

오케스트레이터에게 **워커→리뷰어 1:1 페어 실행** 지시를 포함한다.

**워커 프롬프트 끝에 리마인더 + 랜덤 팁 주입:**

워커 프롬프트의 **맨 끝**에 아래 블록을 추가한다 (recency bias 활용 — 컨텍스트 끝이 가장 영향력 강함):

```
---
⚠️ 반드시 지켜야 할 규칙 (매 작업 종료 전 확인)
- [ ] 커밋 전 포맷터 실행 (prettier, black 등 프로젝트에 맞게)
- [ ] 수정 파일이 Write 허용 목록 안에 있는지 확인
- [ ] 테스트 실행 → 실제 출력 결과를 PR description에 첨부
- [ ] lint 실행 → 실제 출력 결과를 PR description에 첨부
- [ ] 빌드 실행 → 실제 출력 결과를 PR description에 첨부
- [ ] "통과했을 것이다"는 증거가 아니다. 실행하지 않았으면 "미실행"으로 보고하라.

🚫 합리화 금지:
- spec에 없는 변경을 '개선'이라고 합리화하지 마라
- 파일을 읽지 않고 '이미 알고 있다'고 가정하지 마라
- 에러를 무시하고 진행하지 마라 — 에러가 있으면 보고하라

⏱️ 턴 예산: 22턴 중 현재 진행 중. 18턴 이상 소진했다면 즉시 정리하고 커밋 준비.

💡 팁:
- {랜덤 팁 1 — 프로젝트 tip-pool.json에서 추출, 없으면 일반 팁}
- {랜덤 팁 2}
```

프로젝트에 `scripts/pipeline-cli.mjs`가 있으면 `node scripts/pipeline-cli.mjs tips <category>`로 팁을 추출.
없으면 오케스트레이터가 프로젝트 특성에 맞는 일반 팁 2개를 직접 작성.

**워커 사전 선언:** 워커는 구현 시작 전에 수정 예정 파일과 접근 방식을 선언한다. 오케스트레이터가 다른 워커와 파일 겹침/스코프 이탈을 검증하고, Write 허용 목록에 없는 파일이 포함되면 거부한다.

## Step 3: 백그라운드 병렬 실행

오케스트레이터를 동시에 백그라운드로 실행한다.

Agent tool 설정:
- subagent_type: "general-purpose"
- model: "opus"
- run_in_background: true

실행 후 agent ID를 배치별로 기록한다 (터미널 출력).

## Step 4: 모니터링 안내

사용자에게 안내 후 **대기** (sleep/polling 금지 — task-notification 자동 알림 대기):
```
N개 배치가 백그라운드에서 실행 중입니다.

agent ID:
  Batch A: agent_xxxxx
  Batch B: agent_yyyyy

진행 확인: 아무 메시지나 보내주시면 현황 보고드립니다.
BLOCKED 발생 시 즉시 알려드립니다.
```

**금지**: sleep + check 루프. output 파일은 완료 전까지 항상 0 bytes이므로 polling 무의미.

**배치 완료 알림 수신 시**, PR 번호 나열이 아닌 구조화된 요약을 사용자에게 출력:

```
**{BATCH_NAME} 완료** ({소요시간})
- 워커: N/M 성공, 리뷰 N PASS / K FAIL / J BLOCKED (재시도 R건)
- 변경 요약: [핵심 변경 1줄씩, 오케스트레이터 완료 리포트에서 추출]
- unplannedWrites: N건 (있으면 파일명)
- 명세 차이: N건 (있으면 이슈번호 + 1줄 설명)
```

오케스트레이터 완료 리포트에 이 정보가 포함되어 있으므로 가공만 하면 된다.

## Step 5: 완료 처리 + 리뷰어 검증

오케스트레이터 완료 알림 수신 시:

### 5-1. 3단계 리뷰 파이프라인

각 워커 완료 후, 오케스트레이터가 3단계 리뷰 파이프라인을 실행한다. 모든 PR에 동일한 파이프라인을 적용한다 (레벨 분기 없음).

**리뷰 파이프라인 흐름**:
```
Worker (Sonnet) → Draft PR 생성
  ↓
Stage 1: 병렬 탐지
  ├── Sonnet Detector → findings_sonnet[]
  └── Opus Detector   → findings_opus[]
  ↓
Stage 2: GPT 엄격 감사
  └── GPT (Stage 1 findings + diff + 전체코드) → findings_gpt[]
  ↓
Stage 3: Opus 최종 판단 (오케스트레이터 본체)
  └── 전체 findings 평가 → 채택/기각 → PASS / FAIL
  ├── PASS → gh pr ready (Draft 해제) → 머지 대기열
  ├── FAIL (1회차) → 수정 지시서 → Worker 재실행 → 리뷰 재실행
  └── FAIL (2회차) → BLOCKED → 본체 에스컬레이션
```

#### Stage 1: 병렬 탐지

두 탐지자를 동시에 실행한다:

```
Agent({ model: "sonnet", prompt: DETECTOR_PROMPT })
Agent({ model: "opus",   prompt: DETECTOR_PROMPT })
```

**탐지자 입력** (공통):
- GitHub 이슈 본문 (명세)
- PR diff (`gh pr diff`)
- 변경된 파일 전문 (1M 컨텍스트 활용 — diff뿐 아니라 파일 전체를 읽고 주변 코드와의 정합성 검증)
- 관련 코드 (import/export 의존 파일, 기존 테스트 파일)

**탐지자 출력** (구조화 JSON):
```json
{
  "findings": [
    {
      "severity": "error | warning | info",
      "category": "명세누락 | 과잉구현 | 부작용 | unplannedWrite | 증거미첨부 | 아키텍처 | 보안 | 성능",
      "file": "src/...",
      "line": 42,
      "description": "구체적 설명"
    }
  ]
}
```

**검증 항목** (탐지자 공통):

| # | 체크 | 설명 |
|---|---|---|
| 1 | 명세 충족 | 이슈 체크리스트가 코드에 반영됐는가 |
| 2 | 누락 확인 | 명세에 있는데 구현 안 된 항목 |
| 3 | 과잉 구현 | 명세에 없는데 추가된 코드 |
| 4 | 부작용 | 기존 기능에 영향 주는 변경 (전체 코드 맥락에서 판단) |
| 5 | unplannedWrites 검증 | 명세 외 파일 변경/생성이 합리적인지 판정 |
| 6 | 증거 확인 | Worker가 테스트/빌드/lint 실행 결과를 PR description에 첨부했는가 |
| 7 | 아키텍처 정합성 | 프로젝트 패턴/구조와 일치하는가 |

#### Stage 2: GPT 엄격 감사

Stage 1 findings를 포함하여 GPT에 위임한다. Claude가 작성한 코드를 Claude가 리뷰할 때 생기는 동일 편향 사각지대를 보완하는 것이 목적이다.

```
Agent({
  subagent_type: "codex:codex-rescue",
  prompt: STRICT_AUDIT_PROMPT
})
```

**GPT 프롬프트 구조**:
```xml
<task>
이 PR의 변경사항을 엄격하게 감사하라.
이전 검토에서 발견된 항목을 참고하되, 독자적으로 추가 결함을 탐지하라.
Claude가 작성한 코드이므로 Claude 리뷰어가 놓칠 수 있는 편향에 주의하라.
</task>

<prior_findings>
${stage1_findings_sonnet}
${stage1_findings_opus}
</prior_findings>

<pr_diff>
${gh pr diff}
</pr_diff>

<spec>
${issue_body}
</spec>

<structured_output_contract>
기존 findings 각각에 대해 동의/반박 + 근거를 밝히고,
추가로 발견한 결함을 같은 JSON 형식으로 출력하라.
</structured_output_contract>
```

**GPT 출력**: 기존 findings 확인/반박 + 추가 findings + 종합 리뷰 의견

#### Stage 3: Opus 최종 판단

오케스트레이터(Opus)가 전체 findings를 직접 평가한다. Stage 3의 Opus는 Stage 1 Opus와 역할이 다르다 — Stage 1은 탐지에 집중, Stage 3은 판정에 집중.

**입력**: Stage 1 findings + Stage 2 findings + 명세 + 프로젝트 컨텍스트

**판단 기준**:
- 각 finding에 대해 채택/기각 + 근거 기술
- severity:error인 채택 finding이 1건이라도 → **FAIL**
- severity:warning만 → 오케스트레이터 재량 (명세 위반이면 FAIL, 스타일이면 PASS + 코멘트)
- 전부 기각 또는 info만 → **PASS**

**판정**:

| 결과 | 후속 |
|------|------|
| PASS | 머지 대기열에 추가 |
| FAIL (1회차) | 수정 지시서 작성 → 워커 재실행 |
| FAIL (2회차) | GPT rescue 시도 (5-1e) |
| FAIL (GPT rescue 후) | BLOCKED → 본체 에스컬레이션 |

**수정 지시서**: FAIL 시, 채택된 findings를 워커가 이해할 수 있는 수정 지시서로 변환한다. 각 finding의 출처(Sonnet/Opus/GPT)와 구체적 수정 방향을 포함.

**리뷰 출력물**: `reviews/{issue}-{timestamp}.md`

```markdown
# Review: #{issue}

## Stage 1: 병렬 탐지
### Sonnet Detector
- [severity] category: description (file:line)

### Opus Detector
- [severity] category: description (file:line)

## Stage 2: GPT 엄격 감사
### 기존 findings 검증
- finding X: 동의/반박 + 근거

### 추가 findings
- [severity] category: description (file:line)

### 종합 의견
...

## Stage 3: 최종 판단
| Finding | 출처 | 채택/기각 | 근거 |
|---------|------|----------|------|
| race condition on line 42 | GPT | ✅ 채택 | 병렬 접근 시 실제 발생 가능 |
| unused import | Sonnet | ❌ 기각 | 다른 모듈에서 re-export |

### 판정: PASS / FAIL
채택 findings: N건 (error: X, warning: Y, info: Z)
수정 필요 항목: X건
```

### 5-1b. 명세 외 Write 추적

각 워커 완료 후, 오케스트레이터는 실제 변경 파일과 명세의 Write 파일을 비교한다:

```bash
# 워커가 실제로 변경한 파일
git diff --name-only main..
# vs 명세의 Write 파일 목록
```

명세에 없던 파일이 변경/생성된 경우, 오케스트레이터 완료 리포트에 `unplannedWrites`로 보고한다.

unplannedWrites는 **5-1 리뷰어가 명시적으로 검증**한다 (검증 항목 #5).

### 5-1c. CI 실패 자동 피드백 루프

PR 생성 후 CI가 실패하면, 오케스트레이터가 자동으로 피드백 루프를 실행한다:

```
CI 실패 감지 (gh pr checks)
  → CI 로그에서 에러 메시지 파싱
  → 자동 수정 가능 여부 판단:
    - format 실패 → 포맷터 실행 + 재커밋 + 재push (자동)
    - lint 실패 (--fix 가능) → lint --fix + 재커밋 + 재push (자동)
    - test/build 실패 → 에러 메시지를 워커에 재주입하여 수정 지시 (최대 2회)
  → 2회 재시도 후에도 실패 → BLOCKED 처리
```

### 5-1d. 실패 → 팁 자동 성장

프로젝트에 `scripts/pipeline-cli.mjs`가 있으면, CI 실패 또는 리뷰어 FAIL 발생 시 팁 풀에 자동 등록한다:

```bash
# CI format 실패 시
node scripts/pipeline-cli.mjs bump-tip "prettier"

# 리뷰어 FAIL 시
node scripts/pipeline-cli.mjs add-tip <category> "<FAIL 핵심 사유 1줄>"
```

반복되는 실패일수록 해당 팁의 가중치가 증가하여 랜덤 추출 확률이 높아진다.

### 5-1e. GPT Rescue (BLOCKED 전 최후 시도)

Claude 워커가 2회 실패(리뷰 FAIL)한 이슈에 대해, BLOCKED 처리 전에 GPT에게 1회 rescue를 시도한다. 다른 모델이 다른 접근법으로 문제를 풀 수 있는 기회를 제공하는 것이 목적이다.

**트리거**: 리뷰어가 같은 이슈에 대해 2회 FAIL 판정 시 자동 진입.

**GPT rescue 흐름**:
```
Claude Worker 2회 FAIL
  ↓
GPT rescue (같은 worktree, 같은 브랜치)
  ↓
3단계 리뷰 파이프라인 (5-1 동일)
  ├── PASS → 머지 대기열
  └── FAIL → BLOCKED → 본체 에스컬레이션
```

**GPT에 전달할 컨텍스트**:

```
Agent({
  subagent_type: "codex:codex-rescue",
  prompt: RESCUE_PROMPT
})
```

**GPT 프롬프트 구조**:
```xml
<task>
Claude가 2번 시도하고 실패한 구현을 rescue하라.
실패한 코드를 수정할지, 리셋하고 새로 구현할지는 네가 판단하라.
</task>

<spec>
${이슈 본문 (명세)}
</spec>

<failed_attempts>
  <attempt round="1">
    <code_changes>${1회차 diff}</code_changes>
    <review_fail_reason>${1회차 FAIL 사유 + 채택 findings}</review_fail_reason>
  </attempt>
  <attempt round="2">
    <code_changes>${2회차 diff}</code_changes>
    <review_fail_reason>${2회차 FAIL 사유 + 채택 findings}</review_fail_reason>
  </attempt>
</failed_attempts>

<ci_errors>
${CI 에러 로그 (있으면)}
</ci_errors>

<verification_loop>
구현 후 반드시 테스트/빌드/lint를 실행하고 결과를 PR description에 첨부하라.
</verification_loop>
```

**rescue 후 처리**:
- GPT가 코드를 수정하면 → 재커밋 + PR 업데이트
- 3단계 리뷰 파이프라인을 **동일하게** 통과해야 함 (GPT 코드도 면제 없음)
- 리뷰 PASS → 머지 대기열
- 리뷰 FAIL → **BLOCKED** (총 3회 시도: Claude 2회 + GPT 1회)

**BLOCKED 시 보고**:
```
⛔ BLOCKED: Issue #N
- Claude 시도: 2회 FAIL
- GPT rescue: 1회 FAIL
- 누적 FAIL 사유: [채택 findings 요약]
- 에스컬레이션 필요: 사람이 직접 확인
```

### 5-2. PR 처리 및 CI 확인

1. 각 오케스트레이터 완료 리포트 확인
2. Proposal 목록 검토 및 처리 결정
3. 테스트 통과 여부 확인
4. Worktree 정리:
   ```bash
   git worktree remove .claude/worktrees/batch-a
   git worktree remove .claude/worktrees/batch-b
   ```
5. CI/CD 배포 상태 확인 (프로젝트 CI에 맞게 — GitHub Actions, Vercel 등):
   ```bash
   gh pr checks <PR_NUMBER> --watch --interval 30
   ```
   - ✅ 통과: 머지 준비 완료
   - ❌ 실패: 실패한 체크 이름 + 로그 URL 함께 보고
6. 사용자에게 최종 보고:
   ```
   PR 목록 및 CI 결과:
   - PR #N (Batch A): ✅ 리뷰 PASS + CI 통과 — 머지 가능
   - PR #M (Batch B): ❌ 리뷰 FAIL (BLOCKED) — 수동 확인 필요
   - PR #K (Batch B): ⚠️ 리뷰 PASS + CI 실패 — <체크 이름> 실패, 로그: <URL>

   머지 순서: #N → #K (의존성 순)
   ```

**기본값: Claude는 머지하지 않습니다. 사용자가 명시적으로 "머지해줘" 지시 시에만 의존성 순서대로 `gh pr merge --squash` 실행.** (`--delete-branch` 미사용 — 브랜치 삭제는 Phase 5 worktree-clean에서 일괄 처리.)

PR 생성/머지 결과는 pipeline CLI가 있으면 `complete run-agents` 호출 시 output JSON으로 기록된다.

## Step 6: 작업 보고서 작성

`/basic-report` 커맨드가 있으면 실행한다. 없으면 아래 구조로 직접 작성 (경로가 없으면 프로젝트 루트에 생성):

```
# 작업 보고서: {주제}

날짜 / 처리 이슈 / PR / 실행 방식

## 우선순위 분포
- priority:high: N개
- priority:medium: M개
- priority:low: K개

## 워크플로우 의사결정 (이번 세션에서 새로 결정된 것)
- 사용자가 결정한 것: 어떤 맥락에서 왜 결정했는지
- Claude가 제안하고 사용자가 승인한 것

## 이슈별 상세
각 이슈마다: 문제 → 의사결정 근거 → 변경 파일 → 리뷰 결과 (PASS/FAIL, 채택 findings 수) → 추후 주의사항

## 명세 외 변경 (unplannedWrites)
| 이슈 | 파일 | 리뷰어 판정 | 사유 |
|------|------|------------|------|
| #N | src/... | 허용 | 합리적 추출 |

## 리뷰어 피드백 요약
PASS 포함 리뷰어 코멘트 중 향후 참고할 내용:
- #N: "..."
- #M: "..."

## 진행 과정
배치 구성 / 테스트 결과 / 리뷰 결과 / CI 결과 / 머지 과정 (충돌·문제 포함)

## 잔여 위험 및 후속 과제
```

작성 후 main에 직접 push (docs 변경):
```bash
git add docs/reports/YYYY-MM-DD-{주제}.md
git commit -m "docs: YYYY-MM-DD {주제} 작업 보고서 추가"
git push
```
