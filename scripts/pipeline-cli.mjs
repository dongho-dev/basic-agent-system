#!/usr/bin/env node

/**
 * Pipeline CLI — 파이프라인 상태 관리 + 검증 게이트 + 리마인더
 *
 * Usage:
 *   node scripts/pipeline-cli.mjs init                    # 새 파이프라인 초기화
 *   node scripts/pipeline-cli.mjs status                  # 현재 상태 출력 + 리마인더
 *   node scripts/pipeline-cli.mjs advance <phase>         # 다음 phase로 전환 (검증 포함)
 *   node scripts/pipeline-cli.mjs complete <phase> <json> # phase 완료 마킹 + output 기록
 *   node scripts/pipeline-cli.mjs validate                # 현재 phase 출력 스키마 검증
 *   node scripts/pipeline-cli.mjs tips [category]         # 랜덤 팁 2개 출력
 *   node scripts/pipeline-cli.mjs worker-reminder [cat]   # 워커용 고정 규칙 + 랜덤 팁 출력
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STATE_PATH = join(ROOT, "logs", "pipeline-state.json");
const TIP_POOL_PATH = join(ROOT, "docs", "agent-system", "tip-pool.json");

// ── Phases ──────────────────────────────────────────────

const PHASES = [
  "audit",
  "nextplan",
  "spec",
  "review-issues",
  "run-agents",
  "worktree-clean",
];

// audit은 독립 phase — 기존 이슈가 있으면 건너뛸 수 있음
const OPTIONAL_PHASES = new Set(["audit"]);

const PHASE_SCHEMAS = {
  audit: { required: ["issues_created", "total"] },
  nextplan: { required: ["workable_issues", "total"] },
  spec: { required: ["specs"] },
  "review-issues": {
    required: [
      "selected_issues",
      "excluded_issues",
      "batches",
      "file_overlap_check",
    ],
  },
  "run-agents": {
    required: ["batches_result", "prs_created", "prs_merged", "blocked"],
  },
  "worktree-clean": { required: ["cleaned"] },
};

// ── Advance Validators ──────────────────────────────────

const ADVANCE_VALIDATORS = {
  // nextplan은 audit 없이 시작 가능 (기존 이슈 처리)
  nextplan: () => [],
  spec: (state) => {
    const np = state.phases.nextplan;
    if (np.status !== "completed")
      return ["nextplan phase가 완료되지 않았습니다."];
    if (!np.output?.workable_issues?.length)
      return ["workable_issues가 비어있습니다."];
    return [];
  },
  "review-issues": (state) => {
    const spec = state.phases.spec;
    if (spec.status !== "completed")
      return ["spec phase가 완료되지 않았습니다."];
    return [];
  },
  "run-agents": (state) => {
    const ri = state.phases["review-issues"];
    if (ri.status !== "completed")
      return ["review-issues phase가 완료되지 않았습니다."];
    const errors = [];
    const output = ri.output;
    if (!output) return ["review-issues 출력이 없습니다."];
    if (output.file_overlap_check === "failed")
      errors.push("파일 겹침 검증 실패 — 배치를 재구성하세요.");
    if (!output.selected_issues?.length) errors.push("선정된 이슈가 없습니다.");
    return errors;
  },
  "worktree-clean": (state) => {
    const ra = state.phases["run-agents"];
    if (ra.status !== "completed")
      return ["run-agents phase가 완료되지 않았습니다."];
    return [];
  },
};

// ── State Helpers ───────────────────────────────────────

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

function saveState(state) {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function now() {
  return new Date().toISOString();
}

// ── Tip Helpers ─────────────────────────────────────────

function loadTipPool() {
  if (!existsSync(TIP_POOL_PATH)) return {};
  return JSON.parse(readFileSync(TIP_POOL_PATH, "utf-8"));
}

function saveTipPool(pool) {
  writeFileSync(TIP_POOL_PATH, JSON.stringify(pool, null, 2) + "\n", "utf-8");
}

function weightedRandomPick(items, count) {
  if (!items || items.length === 0) return [];
  const totalWeight = items.reduce((sum, i) => sum + (i.weight || 1), 0);
  const picked = [];
  const available = [...items];

  for (let n = 0; n < count && available.length > 0; n++) {
    const currentTotal = available.reduce((sum, i) => sum + (i.weight || 1), 0);
    let rand = Math.random() * currentTotal;
    let idx = 0;
    for (let i = 0; i < available.length; i++) {
      rand -= available[i].weight || 1;
      if (rand <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(available[idx]);
    available.splice(idx, 1);
  }
  return picked;
}

function getTips(category, count = 2) {
  const pool = loadTipPool();
  const generalTips = pool.general || [];
  const categoryTips = category && pool[category] ? pool[category] : [];
  const combined = [...generalTips, ...categoryTips];
  return weightedRandomPick(combined, count);
}

// ── Commands ────────────────────────────────────────────

function cmdInit() {
  const pipelineId = `pipeline-${new Date().toISOString().slice(0, 10)}-${String(Date.now()).slice(-3)}`;
  const state = {
    pipelineId,
    startedAt: now(),
    currentPhase: null,
    phases: {},
    session: {
      id: `session-1`,
      startedAt: now(),
      previousSessions: [],
    },
  };
  for (const phase of PHASES) {
    state.phases[phase] = { status: "pending", output: null };
  }
  saveState(state);
  console.log(`✅ 파이프라인 초기화: ${pipelineId}`);
  console.log(`📄 상태 파일: ${STATE_PATH}`);
}

function cmdStatus() {
  const state = loadState();
  if (!state) {
    console.log(
      "❌ 파이프라인 상태 파일이 없습니다. `node scripts/pipeline-cli.mjs init`으로 초기화하세요.",
    );
    process.exit(1);
  }

  console.log(`\n📍 Pipeline: ${state.pipelineId}`);
  console.log(`📅 시작: ${state.startedAt}`);
  console.log(`📌 현재 phase: ${state.currentPhase || "(없음)"}`);
  console.log(`🔄 세션: ${state.session?.id || "unknown"}\n`);

  // Phase 상태 출력
  for (const phase of PHASES) {
    const p = state.phases[phase];
    const icon =
      p.status === "completed"
        ? "✅"
        : p.status === "in_progress"
          ? "🔄"
          : "⬜";
    let detail = "";
    if (p.status === "completed" && p.output) {
      const summaryParts = [];
      if (p.output.total !== undefined)
        summaryParts.push(`${p.output.total}개`);
      if (p.output.issues_created)
        summaryParts.push(`이슈 ${p.output.issues_created.length}개 생성`);
      if (p.output.workable_issues)
        summaryParts.push(`워커가능 ${p.output.workable_issues.length}개`);
      if (p.output.selected_issues)
        summaryParts.push(`선정 ${p.output.selected_issues.length}개`);
      if (p.output.batches) summaryParts.push(`${p.output.batches.length}배치`);
      if (p.output.prs_merged)
        summaryParts.push(`머지 ${p.output.prs_merged.length}개`);
      detail = summaryParts.length ? ` — ${summaryParts.join(", ")}` : "";
    }
    console.log(`  ${icon} ${phase}${detail}`);
  }

  // 다음 할 일
  const nextPhase = findNextPhase(state);
  if (nextPhase) {
    console.log(
      `\n📌 다음 할 일: node scripts/pipeline-cli.mjs advance ${nextPhase}`,
    );
  } else {
    console.log("\n✅ 모든 phase 완료");
  }

  // 리마인더
  printReminder(state);
}

function cmdAdvance(targetPhase) {
  const state = loadState();
  if (!state) {
    console.log("❌ 파이프라인 상태 파일이 없습니다.");
    process.exit(1);
  }

  if (!PHASES.includes(targetPhase)) {
    console.log(`❌ 알 수 없는 phase: ${targetPhase}`);
    console.log(`유효한 phase: ${PHASES.join(", ")}`);
    process.exit(1);
  }

  // 순서 검증 (optional phase는 건너뛸 수 있음)
  const targetIdx = PHASES.indexOf(targetPhase);
  if (targetIdx > 0) {
    // 직전 필수 phase 찾기 (optional은 건너뜀)
    let prevIdx = targetIdx - 1;
    while (prevIdx >= 0 && OPTIONAL_PHASES.has(PHASES[prevIdx])) {
      prevIdx--;
    }
    if (prevIdx >= 0) {
      const prevPhase = PHASES[prevIdx];
      if (state.phases[prevPhase].status !== "completed") {
        console.log(`❌ 순서 위반: ${prevPhase}가 완료되지 않았습니다.`);
        console.log(
          `먼저 완료하세요: node scripts/pipeline-cli.mjs complete ${prevPhase} '<json>'`,
        );
        process.exit(1);
      }
    }
  }

  // 커스텀 검증
  const validator = ADVANCE_VALIDATORS[targetPhase];
  if (validator) {
    const errors = validator(state);
    if (errors.length > 0) {
      console.log(`\n❌ 검증 실패: → ${targetPhase}\n`);
      errors.forEach((e, i) => console.log(`  [${i + 1}] ${e}`));
      console.log(
        `\n교정 후 다시 실행: node scripts/pipeline-cli.mjs advance ${targetPhase}`,
      );
      process.exit(1);
    }
  }

  // 전환
  state.currentPhase = targetPhase;
  state.phases[targetPhase].status = "in_progress";
  state.phases[targetPhase].startedAt = now();
  saveState(state);

  console.log(`\n✅ Phase 전환: ${targetPhase} (in_progress)`);
  printReminder(state);
}

function cmdComplete(phase, outputJson) {
  const state = loadState();
  if (!state) {
    console.log("❌ 파이프라인 상태 파일이 없습니다.");
    process.exit(1);
  }

  if (!PHASES.includes(phase)) {
    console.log(`❌ 알 수 없는 phase: ${phase}`);
    process.exit(1);
  }

  let output = null;
  if (outputJson) {
    try {
      output = JSON.parse(outputJson);
    } catch {
      console.log("❌ output JSON 파싱 실패. 유효한 JSON을 입력하세요.");
      process.exit(1);
    }
  }

  // 스키마 검증
  const schema = PHASE_SCHEMAS[phase];
  if (schema && output) {
    const missing = schema.required.filter((key) => !(key in output));
    if (missing.length > 0) {
      console.log(`❌ 출력 스키마 검증 실패 (${phase})`);
      console.log(`누락 필드: ${missing.join(", ")}`);
      process.exit(1);
    }
  }

  state.phases[phase].status = "completed";
  state.phases[phase].completedAt = now();
  state.phases[phase].output = output;

  // 다음 phase 결정
  const nextPhase = findNextPhase(state);
  state.currentPhase = nextPhase;

  saveState(state);

  console.log(`\n✅ ${phase} 완료`);
  if (nextPhase) {
    console.log(`📌 다음: node scripts/pipeline-cli.mjs advance ${nextPhase}`);
  } else {
    console.log("🎉 모든 phase 완료!");
  }
  printReminder(state);
}

function cmdValidate() {
  const state = loadState();
  if (!state) {
    console.log("❌ 파이프라인 상태 파일이 없습니다.");
    process.exit(1);
  }

  const current = state.currentPhase;
  if (!current) {
    console.log("❌ 현재 진행 중인 phase가 없습니다.");
    process.exit(1);
  }

  const p = state.phases[current];
  if (!p.output) {
    console.log(`⬜ ${current}: 아직 output이 없습니다.`);
    process.exit(0);
  }

  const schema = PHASE_SCHEMAS[current];
  if (!schema) {
    console.log(`✅ ${current}: 스키마 검증 불필요`);
    process.exit(0);
  }

  const missing = schema.required.filter((key) => !(key in p.output));
  if (missing.length > 0) {
    console.log(`❌ ${current} 출력 스키마 검증 실패`);
    console.log(`누락 필드: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log(`✅ ${current} 출력 스키마 검증 통과`);
}

function cmdTips(category) {
  const tips = getTips(category, 2);
  if (tips.length === 0) {
    console.log("팁 풀이 비어있습니다.");
    return;
  }
  console.log("💡 팁:");
  tips.forEach((t) => console.log(`  - ${t.text}`));
}

function cmdAddTip(category, text, weight) {
  const pool = loadTipPool();
  if (!pool[category]) pool[category] = [];

  // 중복 체크
  const existing = pool[category].find((t) => t.text === text);
  if (existing) {
    existing.weight = (existing.weight || 1) + (weight || 1);
    saveTipPool(pool);
    console.log(
      `✅ 기존 팁 가중치 증가: "${text}" (weight: ${existing.weight})`,
    );
    return;
  }

  pool[category].push({ text, weight: weight || 2 });
  saveTipPool(pool);
  console.log(`✅ 팁 추가 [${category}]: "${text}" (weight: ${weight || 2})`);
}

function cmdBumpTip(searchText) {
  const pool = loadTipPool();
  for (const category of Object.keys(pool)) {
    const tip = pool[category].find((t) =>
      t.text.toLowerCase().includes(searchText.toLowerCase()),
    );
    if (tip) {
      tip.weight = (tip.weight || 1) + 1;
      saveTipPool(pool);
      console.log(
        `✅ 가중치 증가 [${category}]: "${tip.text}" (weight: ${tip.weight})`,
      );
      return;
    }
  }
  console.log(`❌ "${searchText}"를 포함하는 팁을 찾을 수 없습니다.`);
}

function cmdWorkerReminder(category) {
  console.log("─".repeat(60));
  console.log("⚠️  반드시 지켜야 할 규칙 (매 작업 종료 전 확인)");
  console.log("─".repeat(60));
  console.log("  - [ ] 커밋 전 `npx prettier --write`로 변경 파일 포맷팅");
  console.log("  - [ ] 수정 파일이 Write 허용 목록 안에 있는지 확인");
  console.log("  - [ ] `npm test` 통과");
  console.log("  - [ ] `npm run lint` 통과");
  console.log("  - [ ] `npm run build` 통과");
  console.log("");

  const tips = getTips(category, 2);
  if (tips.length > 0) {
    console.log("💡 팁:");
    tips.forEach((t) => console.log(`  - ${t.text}`));
  }
  console.log("─".repeat(60));
}

// ── Helpers ─────────────────────────────────────────────

function findNextPhase(state) {
  for (const phase of PHASES) {
    if (state.phases[phase].status === "in_progress") return phase;
  }
  // pending 중 첫 번째 필수 phase (optional은 건너뜀)
  for (const phase of PHASES) {
    if (state.phases[phase].status === "pending" && !OPTIONAL_PHASES.has(phase))
      return phase;
  }
  return null;
}

function printReminder(state) {
  const current = state.currentPhase;
  console.log("");
  console.log("─".repeat(50));

  // 경고
  if (current === "run-agents") {
    console.log("⚠️  워커 PR 생성 시 반드시 --draft 플래그 사용");
  } else if (current === "review-issues") {
    console.log("⚠️  허브 이슈, 닫힌 이슈가 선정에 포함되지 않았는지 확인");
  } else if (current === "spec") {
    console.log("⚠️  복잡도 높은 이슈는 L2 리뷰 레벨로 지정");
  }

  // 랜덤 팁
  const tips = getTips(null, 2);
  if (tips.length > 0) {
    tips.forEach((t) => console.log(`💡 ${t.text}`));
  }
  console.log("─".repeat(50));
}

// ── Main ────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

switch (command) {
  case "init":
    cmdInit();
    break;
  case "status":
    cmdStatus();
    break;
  case "advance":
    if (!args[0]) {
      console.log("Usage: pipeline-cli.mjs advance <phase>");
      process.exit(1);
    }
    cmdAdvance(args[0]);
    break;
  case "complete":
    if (!args[0]) {
      console.log("Usage: pipeline-cli.mjs complete <phase> [output-json]");
      process.exit(1);
    }
    cmdComplete(args[0], args.slice(1).join(" ") || null);
    break;
  case "validate":
    cmdValidate();
    break;
  case "tips":
    cmdTips(args[0] || null);
    break;
  case "worker-reminder":
    cmdWorkerReminder(args[0] || null);
    break;
  case "add-tip":
    if (!args[0] || !args[1]) {
      console.log(
        'Usage: pipeline-cli.mjs add-tip <category> "<text>" [weight]',
      );
      process.exit(1);
    }
    cmdAddTip(args[0], args[1], parseInt(args[2]) || undefined);
    break;
  case "bump-tip":
    if (!args[0]) {
      console.log('Usage: pipeline-cli.mjs bump-tip "<search-text>"');
      process.exit(1);
    }
    cmdBumpTip(args.join(" "));
    break;
  default:
    console.log(`Pipeline CLI — 파이프라인 상태 관리 도구

Commands:
  init                         새 파이프라인 초기화
  status                       현재 상태 + 리마인더 출력
  advance <phase>              다음 phase로 전환 (검증 포함)
  complete <phase> [json]      phase 완료 + output 기록
  validate                     현재 phase 출력 스키마 검증
  tips [category]              랜덤 팁 2개 출력
  worker-reminder [category]   워커용 고정 규칙 + 랜덤 팁
  add-tip <cat> "<text>" [w]   팁 추가 (중복 시 가중치 증가)
  bump-tip "<search>"          검색어 매칭 팁의 가중치 +1

Phases: ${PHASES.join(" → ")}`);
    break;
}
