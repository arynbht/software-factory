// Waiver schema. A waiver (`.factory/waivers.yml`) is an accepted exception to a
// control, with a reason, an owner, and an expiry — never a silently disabled check.
import { z } from "zod";

export const WaiverSchema = z.strictObject({
  control: z.string().min(1),
  reason: z.string().min(1),
  owner: z.string().optional(),
  created: z.string().optional(),
  /** ISO date (YYYY-MM-DD) after which the waiver no longer applies. */
  expires: z.string().min(1),
});

export const WaiversSchema = z.array(WaiverSchema);

export type Waiver = z.infer<typeof WaiverSchema>;
