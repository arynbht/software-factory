// The task card (`.factory/tasks/<id>/card.yml`): what a task is, and the
// acceptance criteria the judge will verify by id. Intake refuses a card whose
// acceptance is empty or whose items don't say how they'll be verified.
import { z } from "zod";

export const TASK_TYPES = [
  "feature",
  "fix",
  "chore",
  "refactor",
  "spike",
] as const;
export const VERIFY_KINDS = [
  "e2e",
  "unit",
  "manual",
  "screenshot",
  "contract",
  "review",
] as const;
export const RISKS = ["low", "medium", "high"] as const;

export const TASK_ID = /^T-\d{4,}$/;

const AcceptanceSchema = z.strictObject({
  id: z.string().regex(/^A\d+$/, "acceptance ids are A1, A2, …"),
  text: z.string().min(1),
  verify: z.enum(VERIFY_KINDS, {
    error: `verify says how the judge checks it: one of ${VERIFY_KINDS.join(", ")}`,
  }),
});

export const CardSchema = z
  .strictObject({
    id: z.string().regex(TASK_ID, "task ids are T-0001, T-0002, …"),
    title: z.string().min(1),
    type: z.enum(TASK_TYPES),
    source: z.string().min(1).default("prompt"),
    description: z.string().min(1),
    acceptance: z
      .array(AcceptanceSchema)
      .min(1, "a card needs at least one acceptance criterion"),
    out_of_scope: z.array(z.string().min(1)).default([]),
    touches: z.array(z.string().min(1)).default([]),
    constraints: z.array(z.string().min(1)).default([]),
    risk: z.enum(RISKS).default("medium"),
    owner: z.string().min(1),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .superRefine((card, ctx) => {
    const seen = new Set<string>();
    card.acceptance.forEach((a, i) => {
      if (seen.has(a.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate acceptance id ${a.id}`,
          path: ["acceptance", i, "id"],
        });
      }
      seen.add(a.id);
    });
  });

export type Card = z.infer<typeof CardSchema>;
export type CardInput = z.input<typeof CardSchema>;

export class CardError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `the task card is not ready:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
    this.name = "CardError";
  }
}

/** Validate a card, throwing every problem at once. */
export function parseCard(input: unknown): Card {
  const parsed = CardSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new CardError(
    parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(card)"}: ${i.message}`,
    ),
  );
}

/**
 * `"text::verify"` → an acceptance item, for building a card from flags. The
 * verify kind is required: an item the judge can't check isn't a criterion.
 */
export function parseAcceptanceFlag(value: string, index: number): unknown {
  const at = value.lastIndexOf("::");
  return at === -1
    ? { id: `A${index + 1}`, text: value.trim() }
    : {
        id: `A${index + 1}`,
        text: value.slice(0, at).trim(),
        verify: value.slice(at + 2).trim(),
      };
}
