import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  isSensitivePath,
  runTool,
  ToolNotFoundError,
} from "@arynbht/factory-engine";

export interface ScanFinding {
  rule: string;
  file: string;
  line: number;
  text: string;
}

/**
 * Instructions a skill has no business giving an agent, beyond its stated
 * purpose. A skill is a prompt; these are the ways a prompt turns hostile:
 * switching off the checks, touching the factory's own state, overriding the
 * contract, running remote code, or sending secrets out.
 */
export const INJECTION_RULES: { id: string; pattern: RegExp; why: string }[] = [
  {
    id: "disable-checks",
    pattern:
      /--no-verify|\b(skip|disable|bypass|turn off|silence)\s+(the\s+|all\s+|any\s+)?(tests?|lint(ing|er)?|hooks?|checks?|ci|type[- ]?check(ing|s)?|pre-commit)\b/i,
    why: "tells the agent to switch off checks",
  },
  {
    id: "factory-state",
    pattern: /\.factory\/|\bwaivers\.ya?ml\b|\bevidence\.ya?ml\b/i,
    why: "points the agent at the factory's own state",
  },
  {
    id: "override-instructions",
    pattern:
      /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|above|earlier|system)\s+(instructions|rules|prompts?|guidelines)/i,
    why: "tries to override the agent's instructions",
  },
  {
    id: "remote-exec",
    pattern:
      /\b(curl|wget|iwr|irm)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|pwsh|node|python3?|iex)\b/i,
    why: "pipes a remote script into a shell",
  },
  {
    id: "exfiltrate",
    pattern:
      /\b(curl|wget|fetch|axios|requests\.(post|put)|http\.request)\b(?![^\n]*\b(localhost|127\.0\.0\.1)\b)[^\n]*(\$\{?\w*(TOKEN|KEY|SECRET|PASSWORD)\w*|printenv|process\.env|os\.environ|\.env\b|id_rsa|\.ssh\/|\.aws\/)/i,
    why: "sends secrets or environment data somewhere",
  },
  {
    id: "skip-permissions",
    pattern:
      /--dangerously-skip-permissions|\bbypassPermissions\b|--no-sandbox\b/i,
    why: "turns off the agent's permission or sandbox controls",
  },
  {
    // Frontmatter `hooks:` or a hook installer: code that runs on its own,
    // outside any decision the agent or the judge sees.
    id: "auto-hooks",
    pattern:
      /^\s*hooks:\s*$|^\s*(PreToolUse|PostToolUse|Stop|SessionStart|UserPromptSubmit)\s*:|settings(\.local)?\.json[^\n]*\bhooks?\b/,
    why: "installs or declares hooks that run code automatically",
  },
  {
    id: "force-push",
    pattern: /\bgit\s+push\b[^\n]*\s(-f|--force)(\s|$)/i,
    why: "rewrites shared history",
  },
];

const TEXT =
  /\.(md|mdx|markdown|txt|ya?ml|json|toml|sh|bash|ps1|py|js|mjs|cjs|ts|tsx)$/i;

/** Finds secrets in a directory; returns findings (rule `secret`). */
export type SecretScanner = (dir: string) => Promise<ScanFinding[]>;

/**
 * gitleaks over the directory. Fails closed: with gitleaks missing or broken
 * the result is a `secret-scan-unavailable` finding, never a clean pass.
 */
export const gitleaksScanner: SecretScanner = async (dir) => {
  try {
    const result = await runTool(
      "gitleaks",
      [
        "dir",
        dir,
        "--report-format",
        "json",
        "--report-path",
        "-",
        "--no-banner",
        "--redact",
        "--exit-code",
        "0",
      ],
      dir,
      { timeoutMs: 120_000 },
    );
    const leaks = JSON.parse(result.stdout || "[]") as {
      RuleID: string;
      File: string;
      StartLine: number;
    }[];
    return leaks.map((l) => ({
      rule: "secret",
      file: relative(dir, l.File).split(sep).join("/"),
      line: l.StartLine,
      text: `gitleaks: ${l.RuleID}`,
    }));
  } catch (err) {
    return [
      {
        rule: "secret-scan-unavailable",
        file: "",
        line: 0,
        text:
          err instanceof ToolNotFoundError
            ? "gitleaks is not installed; can't scan this skill for secrets"
            : `gitleaks failed: ${(err as Error).message}`,
      },
    ];
  }
};

/**
 * Scan a skill directory before it's installed: secrets (gitleaks), sensitive
 * files, and the injection rules above. Rules listed in the manifest's
 * `scan_allow` (a human's reviewed exception) are dropped.
 */
export async function scanSkill(
  dir: string,
  allow: readonly string[] = [],
  secrets: SecretScanner = gitleaksScanner,
): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [...(await secrets(dir))];
  for (const abs of await walk(dir)) {
    const rel = relative(dir, abs).split(sep).join("/");
    if (isSensitivePath(rel)) {
      findings.push({ rule: "sensitive-file", file: rel, line: 0, text: rel });
      continue;
    }
    if (!TEXT.test(rel) && !/(^|\/)[A-Z]+$/.test(rel)) continue;
    const content = await readFile(abs, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const rule of INJECTION_RULES) {
        if (rule.pattern.test(text)) {
          findings.push({
            rule: rule.id,
            file: rel,
            line: i + 1,
            text: text.trim().slice(0, 160),
          });
        }
      }
    });
  }
  // An allow entry is a rule (`remote-exec`) or one file's finding for a rule
  // (`remote-exec:references/install.md`), so a reviewer can accept a single
  // example without blinding the scan to the rest of the skill.
  return findings.filter(
    (f) => !allow.includes(f.rule) && !allow.includes(`${f.rule}:${f.file}`),
  );
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
