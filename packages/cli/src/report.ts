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
  skip: number;
  na: number;
  total: number;
}

export function summarize(results: ControlResult[]): Summary {
  const summary: Summary = {
    pass: 0,
    fail: 0,
    needsEvidence: 0,
    skip: 0,
    na: 0,
    total: results.length,
  };
  for (const r of results) {
    if (r.status === "pass") summary.pass++;
    else if (r.status === "fail") summary.fail++;
    else if (r.status === "needs-evidence") summary.needsEvidence++;
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
  if (s.na > 0) parts.push(c.dim(`${s.na} n/a`));
  return `${parts.join(", ")}  (${s.total} control${s.total === 1 ? "" : "s"})`;
}

export interface RenderOptions {
  format?: "table" | "json";
  color?: boolean;
}

export function renderReport(
  results: ControlResult[],
  options: RenderOptions = {},
): string {
  if (options.format === "json") return renderJson(results);
  return renderTable(results, options.color ?? true);
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
