import { z } from "zod";

export const statusTransitionSchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]),
  note: z.string().trim().max(2000).optional(),
});

export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>;
