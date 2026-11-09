import { z } from "zod";

const axis = z.number().int().min(0).max(100);
export const dotFieldsSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !/\p{Cc}/u.test(value)),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((value) => value.toLowerCase()),
  enabled: z.boolean(),
  personality: z.strictObject({ explanation: axis, playfulness: axis, boldness: axis }),
});
export const dotSchema = dotFieldsSchema.extend({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Dot = z.infer<typeof dotSchema>;
export type DotFields = z.infer<typeof dotFieldsSchema>;
export const dotMethods = {
  "dot.get": { params: z.strictObject({}), result: dotSchema },
  "dot.update": { params: dotFieldsSchema.partial(), result: dotSchema },
} as const;
