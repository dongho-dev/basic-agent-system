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

## 미적용 — 논의 필요

### 3. 에이전트 blame 추적
- **상태:** 논의 시작함, 방향 합의 전
- **내용:** 리뷰어 FAIL/BLOCKED 시 실패 원인 분류 (`spec_insufficient` / `worker_error` / `ci_flaky` / `external_dependency`), `logs/agent-blame.json`에 누적, 보고서에 원인 분포 추가, N회 반복 시 시스템 개선 제안
- **팁 풀과의 차이:** 팁 풀은 증상 대응(워커 프롬프트 팁), blame은 근본 원인 파악(시스템 수준)
- **변경 범위:** basic-agents.md + basic-report.md × 2 tier = 4개 파일
- **트레이드오프:** 리뷰어 부담 약간 증가 vs 실패 패턴 정량 파악

### 4. 코드 품질 게이트
- **상태:** 미논의
- **내용:** 리뷰어 검증에 정량 메트릭 추가 (새 함수에 테스트 유무 확인, lint/format 직접 실행)
- **변경 범위:** basic-agents.md × 2 tier = 2개 파일
- **포인트:** CI 없거나 느슨한 프로젝트에서 가치 있음

### 5. 리스크 스코어링
- **상태:** 미논의
- **내용:** git history 기반 리스크 스코어 → L1/L2 리뷰 레벨 판정 개선
- **변경 범위:** basic-review-issues.md × 2 tier = 2개 파일
- **포인트:** 이슈 적으면 차이 작음, 많으면 리뷰 자원 최적화

## 보류 — 포트폴리오 수준에서 효과 낮음

### 6. Phase 1→2 스트리밍 병렬화
- 이슈 100개+ 아니면 체감 없음. pipeline-cli.mjs 수정 필요.

### 7. 머지 후 main CI 확인 + 자동 롤백
- 배치 1-2개 수준에서는 오버. 팀 프로젝트 + 이슈 20개+ 동시 처리 수준에서 의미.
