// The files `factory init` writes into a repo (§10): the contract every agent
// reads (AGENTS.md, with CLAUDE.md pointing at it), the Claude Code hooks, the
// PR template with its Proof section, and a CONSTRAINTS.md seed for the judge.
import { BEATS, PROTECTED } from "@arynbht/factory-runtime";

/** What the generated files say about this repo. */
export interface RepoFacts {
  name: string;
  type: string;
  phase?: string | undefined;
  stack: string[];
  flags: string[];
  /** Detected stacks: node, python, go, rust, … */
  stacks: string[];
  /** The repo's own commands, when it declares them. */
  commands: {
    install?: string | undefined;
    lint?: string | undefined;
    typecheck?: string | undefined;
    test?: string | undefined;
  };
}

const BEAT_LINES: Record<(typeof BEATS)[number], string> = {
  intake:
    "**intake**: a task card with acceptance criteria, each saying how it's verified. A person confirms it.",
  route:
    "**route**: the router picks sectors, at most four skills, the judge's checks and the proof. A person approves the assembly.",
  isolate:
    "**isolate**: a worktree in `.worktrees/<id>` on its own branch from the default branch, with its own port and database.",
  build:
    "**build**: one agent plans, then builds, inside the worktree; it stops and asks on the triggers below.",
  prove: "**prove**: a tool produces the proof; the agent never describes it.",
  judge:
    "**judge**: a clean clone of base plus the change. Deterministic checks first, then a scoped review.",
  ship: "**ship**: a draft PR written from the card, the ledger and the proof.",
  close:
    "**close**: after a person merges, the ledger is sealed, the worktree removed and the metrics row appended.",
};

const code = (s: string) => `\`${s}\``;

export function renderAgentsMd(facts: RepoFacts): string {
  const protectedPaths = [
    ...PROTECTED.factoryState,
    ...PROTECTED.agentConfig,
    ...PROTECTED.ciConfig,
    ...PROTECTED.lintConfig,
  ];
  const cmds = Object.entries(facts.commands).filter(
    (e): e is [string, string] => Boolean(e[1]),
  );
  return `# AGENTS.md

<!-- Written by \`factory init\`. Everything above "This repo" is the factory's
contract, the same in every factory repo; the "This repo" section is yours to edit.
The judge reads this file from the base branch and blocks a change that breaks it. -->

This repo is built with the software factory. These rules apply to every agent that
works in it (Claude Code, Codex, Cursor) and to the factory's own agents.

## Before anything

Run ${code("factory doctor")}. If it fails, do what it says (often
${code("factory skills sync")}) before starting work.

## Every task starts with /factory

In Claude Code: ${code("/factory <what you want>")} or ${code("/factory #<issue>")}.
Anywhere else, use the ${code("factory task")} commands the skill uses. Don't change
files in this checkout on the default branch: each task gets its own worktree and
branch, and the change reaches the default branch only through a reviewed PR.

## The beats

0. **sync**: ${code("factory doctor && factory skills sync")}. Machine and skills ready, pinned and verified.
${BEATS.map((b, i) => `${i + 1}. ${BEAT_LINES[b]}`).join("\n")}

The ledger in ${code(".factory/tasks/<id>/")} is the record and the resume point:
${code("factory task resume <id>")}. Only the runtime writes it.

## Protected paths

A task never edits these. The judge marks any change to them as needing a person:

${protectedPaths.map((p) => `- ${code(p)}`).join("\n")}
- tests that already exist (add new tests instead)
- new ${code("eslint-disable")}, ${code("@ts-ignore")}, ${code("# noqa")} or similar suppressions

## Stop and ask

Pause and ask the person before:

- adding a dependency
- a schema change or a migration
- touching a protected path, or deleting or changing an existing test
- any change to lint config, CI config or ${code(".factory/**")}
- going past the plan's step budget
- treating an acceptance criterion as impossible

## Proof and review

- Proof comes from tools: before and after screenshots with axe for UI work, the
  test run for everything else. It is never written up by the agent.
- The judge works on a clean clone. Lint, typecheck and tests run first; a check
  that's red on the base too is reported as pre-existing. Then comes a review where
  only three things block: a defect, a breach of this file, CONSTRAINTS.md or
  DESIGN.md, and an unmet acceptance criterion. Everything else is a suggestion.
- Blocking findings go back to the agent at most twice. After that a person decides.

## People merge

The factory opens draft PRs. It never merges, and neither does any agent.

## This repo

- **${facts.name}**: ${facts.type}${facts.phase ? `, phase ${facts.phase}` : ""}
- Stack: ${[...new Set([...facts.stacks, ...facts.stack])].join(", ") || "not detected"}
${facts.flags.length > 0 ? `- Flags: ${facts.flags.join(", ")}\n` : ""}${
    cmds.length > 0
      ? `- Commands: ${cmds.map(([k, v]) => `${k} ${code(v)}`).join(" · ")}\n`
      : "- Commands: none declared yet; the judge fails closed on a check it can't run.\n"
  }
<!-- House patterns, naming, where things live: add them here. The judge holds changes to them. -->
`;
}

export const CLAUDE_MD = `# CLAUDE.md

@AGENTS.md

Start every task with \`/factory\`. The contract above applies to Claude Code too.
`;

/** Claude Code hooks (§10): the beats at session start, and the edit guard. */
export const SETTINGS_JSON = `${JSON.stringify(
  {
    hooks: {
      SessionStart: [
        {
          hooks: [{ type: "command", command: "factory hook session-start" }],
        },
      ],
      PreToolUse: [
        {
          matcher: "Edit|Write|MultiEdit|NotebookEdit",
          hooks: [{ type: "command", command: "factory hook guard" }],
        },
      ],
    },
  },
  null,
  2,
)}\n`;

export const PR_TEMPLATE = `## Summary

<!-- What changed and why. Link the issue. -->

## Acceptance criteria

<!-- Each criterion, and whether it's met. -->

## Proof

<!-- Required. Produced by a tool, not described: before/after screenshots for UI,
test output for logic, plan output for infra. Factory tasks fill this in. -->

## Notes
`;

export function renderConstraintsMd(facts: RepoFacts): string {
  const checks = [
    facts.commands.lint,
    facts.commands.typecheck,
    facts.commands.test,
  ]
    .filter(Boolean)
    .map((c) => code(c!));
  return `# CONSTRAINTS.md

<!-- Seeded by \`factory init\`. The judge's review blocks a change that breaks a rule
here, so keep every rule concrete enough to check against a diff. Add this codebase's
rules below; delete any of these that don't fit. -->

## Always

- ${checks.length > 0 ? `${checks.join(", ")} pass` : "Lint, typecheck and tests pass"}, with no new warnings.
- No new dependency without asking first.
- Nothing silences a check: no new \`eslint-disable\`, \`@ts-ignore\`, \`# noqa\` or skipped tests.
- New behaviour comes with new tests; existing tests aren't changed to make a change pass.
- No secrets, keys or tokens in code, tests, fixtures or logs.
- Errors are handled or passed on with context, never swallowed.

## This codebase

<!-- e.g. "All database access goes through src/db/; nothing else imports the driver." -->
`;
}
