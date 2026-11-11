import { z } from "zod";

/**
 * Note contract (see src/app/api/findings/[id]/status/route.ts):
 *  - the "note" key absent from the request body -> the existing note is
 *    preserved untouched.
 *  - "note": null, or "note": "" (empty after trimming) -> explicitly
 *    clears the existing note.
 *  - "note": "<text>" -> replaces the existing note with the trimmed text.
 */
export const statusTransitionSchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>;
