import { z } from 'zod';

export const requiredString = (property: string): z.ZodString =>
  z
    .string({ message: `${property} is required` })
    .nonempty({ message: `${property} must be non-empty` });
