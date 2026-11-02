import type { ControlStatus } from "../../shared/ipc";

export interface StatusMeta {
  label: string;
  /** Tailwind background for the status dot. */
  dot: string;
  /** Tailwind text colour for the status label. */
  text: string;
}

export const STATUS_META: Record<ControlStatus, StatusMeta> = {
  pass: { label: "Pass", dot: "bg-emerald-500", text: "text-emerald-400" },
  fail: { label: "Fail", dot: "bg-rose-500", text: "text-rose-400" },
  "needs-evidence": {
    label: "Needs evidence",
    dot: "bg-amber-500",
    text: "text-amber-400",
  },
  waived: { label: "Waived", dot: "bg-sky-500", text: "text-sky-400" },
  skip: { label: "Skipped", dot: "bg-slate-500", text: "text-slate-400" },
  "n/a": { label: "N/A", dot: "bg-slate-700", text: "text-slate-500" },
};

/** Status order for the compact count summary (most urgent first). */
export const STATUS_ORDER: ControlStatus[] = [
  "fail",
  "needs-evidence",
  "pass",
  "waived",
  "skip",
  "n/a",
];
