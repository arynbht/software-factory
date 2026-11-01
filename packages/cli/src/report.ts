import type {
  ControlResult,
  ControlStatus,
  GateResult,
} from "@arynbht/factory-engine";
import pc from "picocolors";

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
