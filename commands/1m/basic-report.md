> 파이프라인 회고 보고서 | context_tier: 1m

파이프라인 회고 보고서를 작성합니다.

인자: `$ARGUMENTS` (선택, 보고서 주제. 없으면 pipeline-state.json에서 추론)

**핵심 원칙: 이 커맨드는 "아쉬운데?"를 자동화한 것이다.** 첫 번째 작성에서 최종 품질을 달성한다.

## Step 1: 데이터 수집

**작성 전에 반드시 아래 데이터를 전부 수집한다. 수집을 건너뛰고 기억으로 작성하지 않는다.**

### 1-1. 파이프라인 상태

```bash
node scripts/pipeline-cli.mjs status
cat logs/pipeline-state.json
```

<pipeline-state>
pipeline-state.json의 전체 내용을 여기에 배치.
Phase별 타임스탬프, 선정/제외 이슈, 배치 구성을 추출.
</pipeline-state>

### 1-2. GitHub 데이터

```bash
# 이번 파이프라인에서 머지된 PR 목록
gh pr list --state merged --limit 20 --json number,title,headRefName,mergedAt,changedFiles,additions,deletions

# 각 PR의 CI 결과
for pr in <PR_NUMBERS>; do gh pr checks $pr; done

# 닫힌 이슈 상태 확인
for n in <ISSUE_NUMBERS>; do gh issue view $n --json state,title --jq '"\(.state) #\(.title)"'; done
```

<github-data>
PR별: 번호, 변경 파일 수, +/- 라인, CI 결과, Vercel 상태
이슈별: 닫힘 여부
</github-data>

### 1-3. 에이전트 메트릭

대화 컨텍스트에서 `<usage>` 태그 또는 에이전트 완료 알림을 검색하여 추출.

<agent-metrics>
각 에이전트별:
- 이름/배치
- total_tokens
- tool_uses
- duration_ms
- 결과 요약 (1-2줄)
</agent-metrics>

### 1-4. 의사결정 과정

대화 컨텍스트에서 다음 의사결정을 식별하여 추출.

<decisions>
- Phase 0 (감사): raw 발견 수, 필터링 퍼널 (중복/오탐/기존이슈), 최종 이슈 수
- Phase 1 (트리아지): 카테고리 분류 기준, 허브 판정 근거
- Phase 3 (계획): MIS 컴포넌트별 분석 (옵션 열거 + 선택 근거), priority 트레이드오프
- Phase 4 (실행): CI 실패 조사 과정, pre-existing 판정 근거, 머지 결정
- 기타: 오케스트레이터 프롬프트 설계 결정, 예상 외 이슈 등
</decisions>

### 1-5. 변경 상세

대화 컨텍스트에서 오케스트레이터 완료 리포트를 검색하여 추출.

<change-details>
각 이슈별:
- 구체적으로 어떤 코드를 어떻게 바꿨는가 (1-2문장)
- unplannedWrites 유무
- 리뷰어 판정 + 확인 사항
</change-details>

## Step 2: 보고서 작성

수집된 데이터를 아래 템플릿에 맞춰 `docs/reports/YYYY-MM-DD-{주제}.md` 파일로 작성한다.

<template>
```markdown
# 작업 보고서: {주제}

- **날짜**: YYYY-MM-DD
- **처리 이슈 수**: N개
- **PR 목록**: #A, #B, ... (전부 머지/일부 BLOCKED)
- **실행 방식**: N배치 병렬 (run-agents) / 직접 처리

## 우선순위 분포

선정된 이슈 기준 (제외 이슈는 별도 표시하지 않음):
- priority:high: N개
- priority:medium: M개
- priority:low: K개

## Phase별 소요 시간

pipeline-state.json 타임스탬프에서 추출.

| Phase | 시작 | 완료 | 소요 |
|-------|------|------|------|
| ... | HH:MM | HH:MM | N분 |

## 파이프라인 전체 흐름

### Phase 0: 감사 (해당 시)

- 에이전트 구성 + **에이전트별 토큰/tool uses/소요시간 테이블**
- raw 발견 수 → 필터링 퍼널 (중복 N개 + 오탐 N개 + 기존이슈 N개) → 최종 N개
- **스킵 상세 테이블**: 발견 | 기존 이슈 | 매칭 근거
- **오탐 판정 테이블**: 발견 | 에이전트 | 판정 이유 (1-2문장)

### Phase 1: 트리아지

- open 이슈 수, **카테고리별 이슈 번호 테이블** (워커가능/허브/PR진행중/대규모)
- 허브 판정 근거 (어떤 파일을 몇 개 수정하는지)
- 이전 잔여 이슈의 상태 변화

### Phase 2: 명세

- 신규/기존 명세 수, **에이전트 그룹별 토큰/tool uses/소요시간 테이블**

### Phase 3: 계획

- **충돌 그래프 테이블**: 공유 파일 | 충돌 이슈들 | 클러스터
- **MIS 컴포넌트별 분석**: 각 컴포넌트의 옵션 열거 + 선택 근거 (특히 priority 트레이드오프)
- **제외 이슈 테이블**: 이슈 | 우선순위 | 사유
- 배치 구성 테이블

### Phase 4: 실행

- **오케스트레이터별 메트릭 테이블**: 배치 | 모델 | 토큰 | tool uses | 소요 | PR
- **이슈별 리뷰 테이블**: 이슈 | 판정 | 채택 findings (error/warning/info) | 재시도 | 주요 확인 사항
- **CI 조사 과정**: step-by-step (어떤 체크가 실패 → 원인 조사 → main 대조 → pre-existing 판정 → 머지 결정)
- 머지 순서 + 충돌 해결 과정 (있으면)

### Phase 5: 정리

- worktree 제거 결과

## 이슈별 상세

각 배치 × 각 이슈:

| 이슈 | 제목 | 변경 파일 | 비고 |
|------|------|----------|------|
| #N | ... | ... | **구체적 코드 변경 1-2문장** (예: "maybeSingle 쿼리 추가 후 null 체크 → notFound 반환") |

## 명세 외 변경 (unplannedWrites)

| 배치 | 수 | 내용 |
(없으면 "없음" 명시)

## 명세 차이 + 특이사항

(없으면 "없음" 명시. 있으면 이슈번호 + 차이 내용 + 리뷰어 판정 이유)

## 테스트 수 변화

- 이전: N개 → 이후: M개 (+K개)
- 신규 테스트 상세: 파일별 추가 수 + 테스트 이름

## 이전 위험 추적

MEMORY.md 참조.

| 위험 항목 | 최초 보고 | 반복 횟수 | 현재 상태 |
(3회 이상 반복 시 ⚠️ 표시)

## 잔여 위험 및 후속 과제

- CI pre-existing 실패 상세
- MIS 제외 이슈: **다음 파이프라인 처리 가능성 분석** (이번 머지로 충돌 해소 여부)
- 허브 이슈 잔존
- 교훈 (구체적 — "다음에 주의하자" 수준이 아닌, 시스템에 반영할 항목)

## 전체 자원 사용량

| 단계 | 에이전트 수 | 총 토큰 | 총 tool uses |
```
</template>

## Step 3: 자기 검증

**작성한 보고서를 다시 읽고 아래 체크리스트를 하나씩 검증한다.**

<verification-checklist>
보고서를 Read tool로 다시 읽은 뒤, 각 항목을 확인:

□ Phase 0: 에이전트별 토큰/tool uses 테이블이 있는가? (숫자가 agent-metrics와 일치하는가?)
□ Phase 1: 카테고리별 이슈 번호가 빠짐없이 나열되었는가?
□ Phase 2: 에이전트 그룹별 메트릭 테이블이 있는가?
□ Phase 3: 컴포넌트별 MIS 분석에 옵션 열거 + 선택 근거가 있는가? (단순 "충돌" 이 아닌 "{#A, #B} = 2개 vs {#C, #D, #E} = 3개 → 후자 선택" 수준)
□ Phase 4: 배치별 토큰/tool uses/소요시간 테이블이 있는가?
□ Phase 4: 이슈별 리뷰 테이블에 "주요 확인 사항" 컬럼이 채워져 있는가? ("PASS"만 쓰지 않았는가?)
□ Phase 4: CI 조사 과정이 step-by-step으로 기술되었는가? ("pre-existing"만 쓰지 않았는가?)
□ 이슈별 상세: "비고" 컬럼에 구체적 코드 변경이 있는가? ("수정" 같은 한 단어가 아닌가?)
□ 테스트: 신규 테스트의 파일별 추가 수와 이름이 있는가?
□ MIS 제외: 다음 파이프라인 처리 가능성 분석이 있는가?

**누락 항목이 있으면 Step 1로 돌아가 해당 데이터를 수집하고 보고서를 보강한다.**
누락 0개가 될 때까지 반복.
</verification-checklist>

## Step 4: 교훈 → 시스템 반영

보고서의 "잔여 위험 및 후속 과제"와 "명세 차이 + 특이사항"을 검토:

- **반복 실패 패턴** → `node scripts/pipeline-cli.mjs add-tip <category> "<팁>"`
- **프로세스 개선** → MEMORY.md feedback 섹션에 추가
- **미처리 이슈 변동** → MEMORY.md "미처리 이슈" 갱신

## Step 5: 저장 + push

```bash
git add docs/reports/YYYY-MM-DD-{주제}.md
git commit -m "docs: YYYY-MM-DD {주제} 회고 보고서 추가

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

터미널 완료 요약 출력.
