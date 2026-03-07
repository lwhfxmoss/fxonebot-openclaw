import { z } from "zod";

const OneBotGroupRuleSchema = z
  .object({
    enabled: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .passthrough();

const OneBotAccountSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    wsReverse: z
      .object({
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
        path: z.string().optional(),
        token: z.string().optional(),
      })
      .optional(),
    dmPolicy: z.enum(["open", "allowlist", "pairing", "disabled"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    ownerAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
    groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    groups: z.record(z.string(), OneBotGroupRuleSchema).optional(),
    defaultTo: z.string().optional(),
    typingIndicator: z.boolean().optional(),
  })
  .passthrough();

export const OneBotConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    accounts: z.record(z.string(), OneBotAccountSchema).optional(),
    wsReverse: OneBotAccountSchema.shape.wsReverse.optional(),
    dmPolicy: OneBotAccountSchema.shape.dmPolicy.optional(),
    allowFrom: OneBotAccountSchema.shape.allowFrom.optional(),
    ownerAllowFrom: OneBotAccountSchema.shape.ownerAllowFrom.optional(),
    groupPolicy: OneBotAccountSchema.shape.groupPolicy.optional(),
    groupAllowFrom: OneBotAccountSchema.shape.groupAllowFrom.optional(),
    groups: OneBotAccountSchema.shape.groups.optional(),
    typingIndicator: OneBotAccountSchema.shape.typingIndicator.optional(),
  })
  .passthrough();
