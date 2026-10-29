import { z } from "zod";

export const updatePlanSchema = z.object({
  plan: z.enum(["FREE", "PRO"]),
});
