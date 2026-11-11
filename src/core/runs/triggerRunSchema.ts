import { z } from "zod";

/**
 * An empty body (the common case: the UI's "Run reconciliation" button
 * sends no body) means "use the default window" - see
 * src/core/reconciler/defaultWindow.ts. An explicit window must give both
 * bounds, with windowStart strictly before windowEnd.
 */
export const triggerRunSchema = z
  .object({
    windowStart: z.coerce.date().optional(),
    windowEnd: z.coerce.date().optional(),
  })
  .refine((data) => Boolean(data.windowStart) === Boolean(data.windowEnd), {
    message: "windowStart and windowEnd must be provided together",
    path: ["windowStart"],
  })
  .refine((data) => !data.windowStart || !data.windowEnd || data.windowStart < data.windowEnd, {
    message: "windowStart must be before windowEnd",
    path: ["windowStart"],
  });

export type TriggerRunInput = z.infer<typeof triggerRunSchema>;
