> 잔여 Worktree · 브랜치 정리 | context_tier: 1m

에이전트 실행 후 남은 worktree와 브랜치를 정리합니다.

## 절차

1. `git worktree list`로 현재 등록된 worktree 확인
2. `.claude/worktrees/` 디렉토리 내용 확인
3. 사용자에게 정리 대상 목록 보여주고 확인 요청
4. 승인 후:
   - `git worktree remove <path> --force`로 등록된 worktree 제거
   - 잔여 디렉토리가 남아있으면 `git worktree remove --force` 재시도 또는 수동 삭제:
     - bash: `rm -rf <path>`
     - PowerShell: `Remove-Item -Recurse -Force <path>`
   - 머지 완료된 로컬 브랜치 삭제 (`git branch --merged main`에서 main 제외 후 `git branch -d`)
   - 머지 완료된 리모트 브랜치 삭제 (`git branch -r --merged main`에서 `origin/main` 제외 후 `git push origin --delete`)
   - squash merge된 리모트 브랜치 삭제 (`gh pr list --state merged --json headRefName`으로 머지된 PR의 브랜치 목록 조회 → 리모트에 아직 남아있는 것만 `git push origin --delete`)
5. 최종 상태 보고: `git worktree list` + 삭제된 브랜치 수 (로컬/리모트)

## 주의사항

- main worktree는 절대 건드리지 않음
- `main` / `origin/main` 브랜치는 삭제 대상에서 제외
- 삭제 전 반드시 사용자 승인을 받을 것
- 머지되지 않은 브랜치는 삭제하지 않고 경고만 표시
