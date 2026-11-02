import type {
  ChangeResult,
  ControlResult,
  ControlStatus,
  GateResult,
  GateStatus,
} from "@arynbht/factory-engine";
import pc from "picocolors";

export interface StatusBlocker {
  controlId: string;
  title: string;
  status: ControlStatus;
  severity: string;
  effort: string;
}

export interface StatusReport {
  inferredPhase: string | null;
  allGreen: boolean;
  declaredPhase: string | null;
  gates: { phase: string; title: string; status: GateStatus }[];
  blockers: StatusBlocker[];
}

/** Render `factory status`: inferred phase, gate states, and blockers. */
export function renderStatus(report: StatusReport, color = true): string {
  const c = pc.createColors(color);
  const tint = (s: GateStatus): string =>
    s === "green" ? c.green(s) : s === "red" ? c.red(s) : c.yellow(s);

  const lines: string[] = [];
  if (report.allGreen) {
    lines.push(c.green("All defined gates are green. 🎉"));
  } else if (report.inferredPhase) {
    lines.push(`Inferred phase: ${c.bold(report.inferredPhase)}`);
  } else {
    lines.push(c.dim("No gates are defined to infer a phase."));
  }
  if (report.declaredPhase) {
    lines.push(c.dim(`Declared phase (floor): ${report.declaredPhase}`));
  }

  if (report.gates.length > 0) {
    lines.push("", c.bold("Gates"));
    for (const g of report.gates) {
      lines.push(`  ${g.phase.padEnd(12)} ${tint(g.status)}`);
    }
  }

  if (report.blockers.length > 0) {
    lines.push("", c.bold("Blocking (severity, then effort)"));
    const idWidth = Math.max(...report.blockers.map((b) => b.controlId.length));
    for (const b of report.blockers) {
      const sev =
        b.severity === "critical" || b.severity === "high"
          ? c.red(b.severity)
          : c.yellow(b.severity);
      lines.push(
        `  ${b.controlId.padEnd(idWidth)}  ${sev} · ${b.effort} · ${c.dim(b.title)}`,
      );
    }
  }
  return lines.join("\n");
}

export interface Summary {
  pass: number;
  fail: number;
  needsEvidence: number;
  waived: number;
  skip: number;
  na: number;
  total: number;
}

export function summarize(results: ControlResult[]): Summary {
  const summary: Summary = {
    pass: 0,
    fail: 0,
    needsEvidence: 0,
    waived: 0,
    skip: 0,
    na: 0,
    total: results.length,
  };
  for (const r of results) {
    if (r.status === "pass") summary.pass++;
    else if (r.status === "fail") summary.fail++;
    else if (r.status === "needs-evidence") summary.needsEvidence++;
    else if (r.status === "waived") summary.waived++;
    else if (r.status === "n/a") summary.na++;
    else summary.skip++;
  }
  return summary;
}

/** Exit non-zero if any critical control failed. */
export function exitCodeFor(results: ControlResult[]): number {
  return results.some((r) => r.severity === "critical" && r.status === "fail")
    ? 1
    : 0;
}

/** Render a one-line gate status (e.g. "Gate build: RED — 3 failing"). */
export function renderGate(gate: GateResult, color = true): string {
  const c = pc.createColors(color);
  const tint =
    gate.status === "green"
      ? c.green
      : gate.status === "red"
        ? c.red
        : c.yellow;
  const label = gate.title ?? `${gate.phase} gate`;
  const failing = gate.controls.filter((x) => x.status === "fail").length;
  const pending = gate.controls.filter(
    (x) => x.status === "needs-evidence" || x.status === "skip",
  ).length;
  const detail =
    gate.status === "red"
      ? ` — ${failing} failing`
      : gate.status === "amber"
        ? ` — ${pending} outstanding`
        : "";
  return `${c.bold(label)}: ${tint(gate.status.toUpperCase())}${detail}`;
}

/** Markdown gate section, appended to a `--format markdown` report. */
export function renderGatesMarkdown(gates: GateResult[]): string {
  const lines = ["", "## Gates", "", "| Phase | Status |", "| --- | --- |"];
  for (const g of gates) {
    lines.push(`| ${g.title ?? `${g.phase} gate`} | ${g.status} |`);
  }
  return lines.join("\n");
}

/** GitHub workflow-command gate annotations, appended to a `--format github` report. */
export function renderGatesGithub(gates: GateResult[]): string {
  const lines: string[] = [];
  for (const g of gates) {
    const label = g.title ?? `${g.phase} gate`;
    if (g.status === "red") {
      lines.push(
        `::error title=${escapeProperty(label)}::${escapeData(`${label} is red`)}`,
      );
    } else if (g.status === "amber") {
      lines.push(
        `::warning title=${escapeProperty(label)}::${escapeData(`${label} has outstanding items`)}`,
      );
    }
  }
  return lines.join("\n");
}

/** Render the result of a `factory fix` plan (dry-run preview or applied). */
export function renderFixPlan(
  results: ChangeResult[],
  write: boolean,
  color = true,
): string {
  const c = pc.createColors(color);
  if (results.length === 0) {
    return c.dim(
      "Nothing to apply — no selected control has an applicable fix (already passing, or no generator for it).",
    );
  }

  const lines: string[] = [];
  let files = 0;
  let effects = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of results) {
    if (r.type === "effect") {
      if (r.error) {
        failed++;
        lines.push(c.red(`  ✗ ${r.message}`));
      } else {
        effects++;
        lines.push(
          c.cyan(`  ⚙ ${write ? "applied" : "would apply"}: ${r.message}`),
        );
      }
      continue;
    }
    switch (r.action) {
      case "create":
        files++;
        lines.push(c.green(`  + ${write ? "created" : "create"} ${r.path}`));
        break;
      case "update":
        files++;
        lines.push(c.yellow(`  ~ ${write ? "updated" : "update"} ${r.path}`));
        break;
      case "skip":
        skipped++;
        lines.push(c.dim(`  · skip ${r.path} (${r.message})`));
        break;
      case "unchanged":
        lines.push(c.dim(`  = ${r.path} already up to date`));
        break;
    }
  }

  const verb = write ? "applied" : "to apply";
  lines.push("");
  lines.push(
    `${files} file change${files === 1 ? "" : "s"} ${verb}, ${effects} effect${effects === 1 ? "" : "s"}` +
      (skipped ? `, ${c.dim(`${skipped} skipped`)}` : "") +
      (failed ? `, ${c.red(`${failed} failed`)}` : ""),
  );
  if (!write) {
    lines.push(
      c.dim("Run with --write to apply, or --pr to open a pull request."),
    );
  }
  return lines.join("\n");
}

const SYMBOL: Record<ControlStatus, string> = {
  pass: "✓",
  fail: "✗",
  "needs-evidence": "?",
  waived: "⊘",
  skip: "–",
  "n/a": "·",
};

type Colors = ReturnType<typeof pc.createColors>;

function paint(c: Colors, status: ControlStatus, text: string): string {
  switch (status) {
    case "pass":
      return c.green(text);
    case "fail":
      return c.red(text);
    case "needs-evidence":
      return c.yellow(text);
    case "waived":
      return c.cyan(text);
    case "skip":
      return c.dim(text);
    case "n/a":
      return c.dim(text);
  }
}

function renderSummaryLine(c: Colors, s: Summary): string {
  const parts = [
    c.green(`${s.pass} pass`),
    c.red(`${s.fail} fail`),
    c.yellow(`${s.needsEvidence} need evidence`),
    c.dim(`${s.skip} skip`),
  ];
  if (s.waived > 0) parts.push(c.cyan(`${s.waived} waived`));
  if (s.na > 0) parts.push(c.dim(`${s.na} n/a`));
  return `${parts.join(", ")}  (${s.total} control${s.total === 1 ? "" : "s"})`;
}

export type ReportFormat = "table" | "json" | "markdown" | "github";

export interface RenderOptions {
  format?: ReportFormat;
  color?: boolean;
}

export function renderReport(
  results: ControlResult[],
  options: RenderOptions = {},
): string {
  switch (options.format) {
    case "json":
      return renderJson(results);
    case "markdown":
      return renderMarkdown(results);
    case "github":
      return renderGithub(results);
    default:
      return renderTable(results, options.color ?? true);
  }
}

const MARKDOWN_SYMBOL: Record<ControlStatus, string> = {
  pass: "✅",
  fail: "❌",
  "needs-evidence": "📋",
  waived: "🚫",
  skip: "➖",
  "n/a": "·",
};

/** A GitHub-flavoured Markdown report, suitable for a PR comment or job summary. */
function renderMarkdown(results: ControlResult[]): string {
  const s = summarize(results);
  const lines = [
    "## Factory audit",
    "",
    `**${s.pass} pass · ${s.fail} fail · ${s.needsEvidence} need evidence · ${s.waived} waived · ${s.skip} skip · ${s.na} n/a** (${s.total} controls)`,
    "",
  ];

  const blocking = results.filter(
    (r) => r.status === "fail" || r.status === "needs-evidence",
  );
  if (blocking.length > 0) {
    lines.push("| | Control | Lane | Severity |", "| --- | --- | --- | --- |");
    for (const r of blocking) {
      lines.push(
        `| ${MARKDOWN_SYMBOL[r.status]} | \`${r.controlId}\` | ${r.lane} | ${r.severity} |`,
      );
    }
  } else {
    lines.push("All applicable controls pass. 🎉");
  }
  return lines.join("\n");
}

// GitHub workflow-command escaping: message data and property values must escape
// %, CR, and LF (and property values additionally : and ,) or the command breaks /
// can be spoofed.
function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * GitHub Actions workflow commands: one annotation per failing / needs-evidence
 * control, followed by a plain summary line.
 */
function renderGithub(results: ControlResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const first = r.detectors.find((d) => d.status !== "pass")?.message ?? "";
    const title = escapeProperty(r.controlId);
    if (r.status === "fail") {
      lines.push(
        `::error title=${title}::${escapeData(`${r.title} — ${first}`)}`,
      );
    } else if (r.status === "needs-evidence") {
      lines.push(
        `::warning title=${title}::${escapeData(`${r.title} needs evidence`)}`,
      );
    }
  }
  const s = summarize(results);
  lines.push(
    `${s.pass} pass, ${s.fail} fail, ${s.needsEvidence} need evidence, ${s.waived} waived, ${s.skip} skip, ${s.na} n/a (${s.total} controls)`,
  );
  return lines.join("\n");
}

function renderJson(results: ControlResult[]): string {
  return JSON.stringify(
    { summary: summarize(results), controls: results },
    null,
    2,
  );
}

function renderTable(results: ControlResult[], color: boolean): string {
  const c = pc.createColors(color);
  const lines: string[] = [];

  if (results.length === 0) {
    lines.push(c.dim("No controls to evaluate."));
  }

  // Group by lane in first-seen order.
  const byLane = new Map<string, ControlResult[]>();
  for (const r of results) {
    const group = byLane.get(r.lane) ?? [];
    group.push(r);
    byLane.set(r.lane, group);
  }

  const idWidth = Math.max(0, ...results.map((r) => r.controlId.length));

  for (const [lane, group] of byLane) {
    lines.push("");
    lines.push(c.bold(lane));
    for (const r of group) {
      const symbol = paint(c, r.status, SYMBOL[r.status]);
      const id = r.controlId.padEnd(idWidth);
      const severity = r.severity === "critical" ? c.red(" [critical]") : "";
      lines.push(`  ${symbol} ${id}  ${c.dim(r.title)}${severity}`);
    }
  }

  lines.push("");
  lines.push(renderSummaryLine(c, summarize(results)));
  return lines.join("\n");
}
