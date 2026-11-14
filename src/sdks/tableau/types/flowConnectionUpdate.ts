import { z } from 'zod';

/** Non-secret endpoint attributes accepted by Update Flow Connection. */
export const flowConnectionUpdateFields = {
  serverAddress: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .refine(
      (value) => !/[\s/@\\?#]/u.test(value),
      'Use a server hostname or IP address without a URL scheme, path or credentials.',
    )
    .optional()
    .describe('New database hostname or IP address, without a URL scheme or path.'),
  serverPort: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe('New database server port (1–65535).'),
  userName: z
    .string()
    .max(256)
    .refine((value) => !/\p{C}/u.test(value), 'The username must not contain control characters.')
    .optional()
    .describe(
      'New connection username. Passwords and authentication secrets are not accepted by this tool.',
    ),
};
export const flowConnectionUpdateSchema = z
  .object(flowConnectionUpdateFields)
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'Provide at least one of serverAddress, serverPort or userName.',
  );
export type FlowConnectionUpdate = z.infer<typeof flowConnectionUpdateSchema>;
