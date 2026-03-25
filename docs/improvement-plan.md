# 커맨드 개선 계획

## 적용 완료

### 1. Audit 학습 피드백 루프
- **내용:** 감사 오탐/채택 패턴을 `logs/audit-learning.json`에 누적, 다음 감사 시 Agent 프롬프트에 주입
- **변경 파일:** audit 3종 + discover × 2 tier = 8개 파일
- **변경 사항:** Step 0(로드) + Agent 프롬프트 학습 블록 + 필터링에 오탐 매칭 + 마지막 Step에 저장 + 90일 만료

### 2. Cross-batch 의존성 추적
- **내용:** spec 템플릿에 `### 의존 이슈` 섹션 추가, review-issues에서 의존 DAG 구축 + MIS에 반영
- **변경 파일:** basic-spec.md + basic-review-issues.md × 2 tier = 4개 파일
- **순환 의존 처리:** 본체가 자체 판단 후 결정 요약에 기록. `--confirm` 모드에서만 승인 게이트.

### 3. Worker 증거 요구 + 합리화 방지 (external-insights 흡수)
- **내용:** Worker 체크리스트에 테스트/lint/빌드 "실행 + 결과 첨부" 강제, 합리화 방지 문구 3개 추가, Reviewer 검증 항목에 증거 확인 추가
- **변경 파일:** basic-agents.md × 2 tier = 2개 파일
- **출처:** Superpowers (Verification-before-Completion + 합리화 방지 패턴)
- **논의 결과:**
  - 우선순위 상 5개 중 #1(증거 요구), #2(합리화 방지)만 적용
  - #3(실행-디버그 루프) → #1에 흡수됨 (증거 첨부하려면 자연스럽게 발생)
  - #4(스코프 힌트) → Write 허용 파일 목록 + #2로 이미 커버
  - #5(목표 반복) → 대부분 2-5파일 규모라 lost-in-the-middle 빈도 낮음

## 미적용 — 방향 확정, 구현 대기

### 4. 에이전트 blame 추적
- **상태:** 넣기로 확정
- **내용:** 리뷰어 FAIL/BLOCKED 시 실패 원인 분류 (`spec_insufficient` / `worker_error` / `ci_flaky` / `external_dependency`), `logs/agent-blame.json`에 누적, 보고서에 원인 분포 추가, N회 반복 시 시스템 개선 제안
- **팁 풀과의 차이:** 팁 풀은 증상 대응(워커 프롬프트 팁), blame은 근본 원인 파악(시스템 수준)
- **변경 범위:** basic-agents.md + basic-report.md × 2 tier = 4개 파일
- **트레이드오프:** 리뷰어 부담 약간 증가 vs 실패 패턴 정량 파악
- **근거:** Ng의 eval-driven development — "팀 속도의 #1 예측 변수는 에러 분석 체계"

### 5. 구조적 검증 게이트
- **상태:** 넣기로 확정, 설계 후 구현
- **내용:** 프롬프트가 아닌 코드/Hook 레벨에서 Worker 행동 차단 (리뷰 없이 머지 금지, Closes #N 강제, spec vs diff 파일 매핑)
- **근거:** OpenClaw 이메일 삭제 사건 — 컨텍스트 압축 시 프롬프트 안전 지시 유실
- **변경 범위:** pipeline-cli.mjs + settings.json
- **PreToolUse Hook**: 대상 프로젝트 settings.json에 설정. 여기서는 가이드 문서화

## 논의 완료 — 불필요/보류

### 6. 코드 품질 게이트
- **결론:** 빼기 — #3(증거 요구)에서 테스트/lint/빌드 실행+결과 첨부를 이미 강제. "새 함수에 테스트 작성 여부"를 일괄 강제하면 오탐 다수 (설정 변경, 리팩토링 등 해당 안 됨)

### 7. 리스크 스코어링
- **결론:** 보류 — 현재 규모에서 L1/L2 규칙 3개로 충분. 이슈 20개+ 동시 처리에서 L1 통과 후 문제 발견 패턴이 반복되면 재평가. #4(blame)에서 데이터로 보일 것

### 8. Custom Subagents 분리
- **결론:** 불필요 — 12파일 규모에서 self-contained이 나음 (harness-file-strategy.md 결론과 일치)

### 9. 200k 티어 동결
- **결론:** 자연스럽게 진행 — 별도 선언 없이 다음 새 기능부터 1m에만 추가

## 보류 — 포트폴리오 수준에서 효과 낮음

### 10. Phase 1→2 스트리밍 병렬화
- 이슈 100개+ 아니면 체감 없음. pipeline-cli.mjs 수정 필요.

### 11. 머지 후 main CI 확인 + 자동 롤백
- 배치 1-2개 수준에서는 오버. 팀 프로젝트 + 이슈 20개+ 동시 처리 수준에서 의미.
