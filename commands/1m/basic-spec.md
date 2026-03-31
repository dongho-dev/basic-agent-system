> 이슈 구현 명세서 작성 | context_tier: 1m

GitHub 이슈를 분석하여 구현 명세서를 작성하고 이슈 본문에 기록합니다.

인자: `$ARGUMENTS` (이슈 번호, 예: `42` 또는 `42 57 93` 복수 가능)

## Step 0: 이슈 유효성 검증

명세 작성 전에 각 이슈가 실제로 유효한 문제인지 교차 검증한다. audit이 Sonnet으로 생성한 이슈의 오탐/모호함을 걸러내는 게이트.

1. 대상 이슈의 본문을 일괄 수집:
```bash
for n in $ARGUMENTS; do gh issue view "$n" --json number,title,body,labels; done
```

2. 각 이슈가 언급하는 파일:라인의 **현재 코드**를 직접 읽어 실제 상태를 확인한다.

3. GPT에 이슈 + 코드를 전달하여 유효성 판단:

```
Agent({
  subagent_type: "codex:codex-rescue",
  prompt: ISSUE_VALIDATION_PROMPT
})
```

**GPT 프롬프트 구조**:
```xml
<task>
아래 이슈들이 실제로 유효한 문제인지 검증하라.
각 이슈에 대해: 해당 코드를 확인하고, 문제가 실제로 존재하는지,
설명이 명확한지, 수정할 가치가 있는지 판단하라.
</task>

<issues>
${이슈 본문 + 해당 코드 스니펫}
</issues>

<structured_output_contract>
각 이슈에 대해:
- issue_number: N
- verdict: valid | invalid | unclear
- reasoning: 1-2줄 근거
</structured_output_contract>
```

4. 본체(Opus)가 GPT 판단 + 자체 코드 확인을 종합하여 최종 결정:

| GPT | Opus 확인 | 결정 |
|-----|----------|------|
| valid | valid | **진행** |
| invalid | invalid | 이슈 닫기 + audit-learning 기록 |
| valid | invalid | Opus 우선 (코드를 직접 봤으므로), 스킵 |
| invalid | valid | 진행 (GPT 의견 참고만) |
| unclear | — | 이슈에 clarification 코멘트 + 스킵 |

**reject/unclear 처리**:
- reject: `gh issue close <N> -c "자동 검증 결과 오탐 판정: {사유}"` + `audit-learning.json` false_positive 추가
- unclear: `gh issue comment <N> -b "명세 작성을 위해 추가 정보 필요: {질문}"` + 해당 이슈는 이번 실행에서 스킵

유효 판정된 이슈만 Step 1로 진행한다.

## Step 1: 분배 + 실행

이슈 개수에 따라 처리 방식을 결정한다.

### 소량 (1~8개): 본체가 직접 처리

각 이슈에 대해:
1. `gh issue view <NUMBER> --json title,body,labels`로 이슈 본문 읽기
2. 이슈 본문에서 언급된 파일, 컴포넌트, API 경로 추출 (audit 이슈의 "해당 위치"는 **힌트**로만 취급 — 현재 코드를 반드시 직접 확인)
3. 관련 코드를 Read/Grep/Glob으로 직접 탐색
4. 문제 코드 위치, 현재 동작, 변경 필요 범위 파악
5. 기존 테스트 파일 읽고 영향 범위 확인
6. 명세서 작성 (Step 2 템플릿)
7. `gh issue edit <N> --body`로 이슈 본문 업데이트

### 대량 (9개 이상): Opus Agent 그룹 병렬

**Opus당 최대 8개 이슈**를 균등 배정하여 병렬 실행한다 (`model: "opus"`).
본체는 분배만 하고, Agent가 이슈 읽기 → 코드 분석 → 명세 작성 → `gh issue edit`까지 전부 수행한다.

```
9~16개 → Agent 2개 (균등 분배)
17~24개 → Agent 3개 (균등 분배)
공식: ceil(이슈수 / 8) 개의 Opus Agent
```

**균등 분배:** 9개면 5+4, 14개면 7+7 식으로 Agent 간 부하를 맞춘다.

**Sonnet이 아닌 Opus를 쓰는 이유:** 명세는 단순 탐색이 아니라 1원칙 분해 — 연쇄 영향 판단, 공통 패턴 추출, 테스트 설계 등 고수준 판단이 필요하다. audit(Sonnet)이 발견한 문제를 Opus가 깊이 분석하여 워커가 기계적으로 구현할 수 있는 수준까지 분해하는 것이 목표.

각 Opus Agent에게 전달할 지시:
```
이슈 #N, #M, ... 의 구현 명세서를 작성하라.

각 이슈에 대해:
1. `gh issue view <NUMBER> --json title,body,labels`로 이슈 본문을 읽는다.
2. 코드를 분석하고 명세서를 작성한다.
3. `gh issue edit <NUMBER> --body`로 이슈 본문을 업데이트한다.
4. 완료 후 요약을 반환한다: 이슈 번호, 변경 파일 수, 테스트 수, 성공/실패 상태.

## 분석 원칙

1. 이슈 본문의 "해당 위치"와 "제안"은 **힌트**다. 코드베이스가 변경되었을 수 있으므로 현재 코드를 반드시 직접 Read로 확인하라.
2. **1원칙 분해**: "왜 이 문제가 발생하는가?" → "현재 코드의 정확한 동작은?" → "최선의 수정 방법은?" → "다른 코드에 미치는 영향은?" 순서로 분석하라.
3. 관련 코드를 넓게 탐색하라:
   - 문제 파일뿐 아니라 동일 패턴을 쓰는 다른 파일
   - 기존 테스트 파일 (mock 구조, 테스트 패턴 파악)
   - 공통 헬퍼/유틸리티 (추출 가능한 패턴이 있는지)
   - import/export 의존 관계
4. **추측 금지**: 코드를 직접 읽고 확인한 것만 작성하라.
5. **프레임워크/라이브러리 API 주장 교차검증**: audit이 "이 API는 X만 지원한다"고 주장하면, `node_modules/` 타입 정의나 공식 문서로 반드시 검증하라. 프레임워크 버전에 따라 API가 달라질 수 있다.

## 명세서 템플릿

(Step 2 템플릿 참조)
```

Agent는 완료 후 본체에게 요약만 반환한다:
```
- #42: ✅ 명세 완료 (변경 파일 3개, 테스트 2개)
- #57: ✅ 명세 완료 (변경 파일 1개, 테스트 1개)
- #93: ❌ gh issue edit 실패
```

## Step 2: 명세서 템플릿

각 이슈 본문을 아래 형식으로 **덮어쓰기** (`gh issue edit <N> --body "$(cat <<'EOF' ... EOF)"`):

```
## 문제

(기존 이슈의 문제 설명 유지)

## 현재 코드 분석

- `파일:라인` — 현재 동작 설명
- 관련 함수/변수 목록

## 구현 명세

### 변경 사항
1. `파일:라인` — 무엇을 어떻게 변경
2. ...

### 새로 추가할 코드
- 함수명/로직 설명 (구체적 — 의사코드 수준)

### 변경 파일 목록
- `path/to/file`: 변경 내용 요약

### 의존 이슈
- 없음 / `#이슈번호`: 의존 사유 (예: "#42가 정의하는 UserSettings 타입을 사용")

## 엣지 케이스
- 예외 상황 1
- 다른 코드에 미치는 영향

## 테스트 명세

### 기존 테스트 영향
- 깨지는 테스트 있는지, 수정 필요 여부

### 추가할 테스트
- `테스트명`: 설명
  - 입력: ...
  - 기대 결과: ...

### 수동 확인 항목
- 브라우저에서 확인할 동작 (자동화 불가한 것)

## 완료 기준
- [ ] 기준 1
- [ ] 기준 2
- [ ] 관련 테스트 통과
```

**주의:**
- 기존 이슈 본문의 핵심 내용(문제 설명)은 반드시 유지
- 코드를 직접 읽고 분석한 결과만 작성 (추측 금지)
- 라인 번호는 현재 코드 기준으로 정확히 기재
- 테스트 명세는 프로젝트의 테스트 프레임워크에 맞게 작성 (package.json 확인)

## Step 3: 명세 리뷰

명세 작성 완료 후, GPT 교차 리뷰를 수행한다. Opus가 작성한 명세의 접근 방식 오류, 누락 엣지케이스, 과잉/과소 범위를 잡는 게이트.

1. 작성 완료된 명세들을 수집 (`gh issue view`로 업데이트된 본문 재읽기)
2. GPT에 명세 + 관련 코드를 전달:

```
Agent({
  subagent_type: "codex:codex-rescue",
  prompt: SPEC_REVIEW_PROMPT
})
```

**GPT 프롬프트 구조**:
```xml
<task>
아래 구현 명세들을 엄격하게 리뷰하라.
각 명세의 접근 방식이 올바른지, 빠진 엣지케이스가 있는지,
변경 파일 범위가 적절한지, 테스트 명세가 충분한지 검토하라.
Claude가 작성한 명세이므로 Claude의 편향에 주의하라.
</task>

<specs>
${각 이슈 명세 본문 + 관련 코드}
</specs>

<structured_output_contract>
각 명세에 대해:
- issue_number: N
- verdict: approve | revise
- findings: [{ severity: "error|warning", description: "..." }]
  (revise일 때만, 구체적으로 무엇을 수정해야 하는지)
</structured_output_contract>
```

3. 본체(Opus)가 GPT 리뷰를 검토:

| GPT 판정 | 후속 |
|----------|------|
| approve | 그대로 진행 |
| revise (warning만) | 해당 부분 자체 검토 → 타당하면 명세 수정 + `gh issue edit`, 아니면 기각 |
| revise (error 포함) | 반드시 해당 부분 재분석 → 명세 수정 + `gh issue edit` |

**수정 시 원칙**: GPT가 지적한 구체적 finding에 대해서만 수정. 명세 전체를 다시 쓰지 않는다.

## Step 4: 결과 보고

```
## 명세 작성 완료

### Step 0: 이슈 검증
- 입력: N개 / 유효: V개 / 오탐 닫힘: R개 / 모호 스킵: U개

| 이슈 | 제목 | GPT 판정 | Opus 판정 | 결과 |
|------|------|----------|----------|------|
| #N   | ...  | valid    | valid    | ✅ 진행 |
| #M   | ...  | invalid  | invalid  | ❌ 닫힘 (사유) |
| #K   | ...  | unclear  | —        | ⏸️ 스킵 (질문 코멘트) |

### Step 1-2: 명세 작성
| 이슈 | 제목 | 변경 파일 수 | 테스트 수 | 상태 |
|------|------|-------------|----------|------|
| #N   | ...  | N개         | N개      | ✅   |

### Step 3: 명세 리뷰
| 이슈 | GPT 판정 | findings | 수정 여부 |
|------|----------|----------|----------|
| #N   | approve  | —        | —        |
| #M   | revise   | edge case 누락 1건 | ✅ 수정됨 |

다음 단계: `/basic-review-issues`로 계획 → `/basic-agents`로 실행
```
