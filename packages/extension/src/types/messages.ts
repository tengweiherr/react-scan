import { z } from 'zod';

export const BroadcastSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('react-scan:ping'),
  }),
  z.object({
    type: z.literal('react-scan:csp-rules-changed'),
    data: z.object({
      domain: z.string(),
      enabled: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('react-scan:is-csp-rules-enabled'),
    data: z.object({
      domain: z.string(),
      enabled: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('react-scan:check-version'),
  }),
  z.object({
    type: z.literal('react-scan:update'),
    data: z.object({
      reactVersion: z.string(),
      isReactDetected: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('react-scan:state-change'),
    data: z.object({
      enabled: z.boolean(),
    }),
  }),
]);

export type BroadcastMessage = z.infer<typeof BroadcastSchema>;
