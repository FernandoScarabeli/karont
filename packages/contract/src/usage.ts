import { z } from "zod";

const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const usageWindowSchema = z.strictObject({
  id: z.enum(["five_hour", "weekly"]),
  usedPercent: z.number().min(0).max(100),
  resetsAt: isoDateTimeSchema.nullable(),
});

export const agentUsageSchema = z.strictObject({
  agent: z.string().min(1),
  windows: z.array(usageWindowSchema),
  observedAt: isoDateTimeSchema,
});

export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type AgentUsage = z.infer<typeof agentUsageSchema>;

export const usageMethods = {
  "usage.list": {
    params: z.strictObject({}),
    result: z.strictObject({ usage: z.array(agentUsageSchema) }),
  },
  "usage.refresh": {
    params: z.strictObject({ force: z.boolean().optional() }),
    result: z.strictObject({ usage: z.array(agentUsageSchema) }),
  },
} as const;
