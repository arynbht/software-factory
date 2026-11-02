// Waiver schema. A waiver (`.factory/waivers.yml`) is an accepted exception to a
// control, with a reason, an owner, and an expiry — never a silently disabled check.
import { z } from "zod";

import { CONTROL_ID_PATTERN } from "./schema.js";

export const WaiverSchema = z.strictObject({
  // Constrained to a real control-id shape: a waiver's `control` is rendered into
  // the PR/issue comment the Action posts, so an arbitrary string could smuggle in
  // Markdown. (It also wouldn't match any control.)
  control: z.string().regex(CONTROL_ID_PATTERN, "control must be a control id"),
  reason: z.string().min(1),
  owner: z.string().optional(),
  created: z.iso.date().optional(),
  /** ISO date (YYYY-MM-DD) after which the waiver no longer applies. */
  expires: z.iso.date(),
});

export const WaiversSchema = z.array(WaiverSchema);

export type Waiver = z.infer<typeof WaiverSchema>;
