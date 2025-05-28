import { z } from 'zod';

const luidRegex = /^[0-9a-fA-F]{10}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{10}$/;

export const datasourceLuidSchema = z
  .string()
  .refine(
    (value) => luidRegex.test(value),
    `datasourceLuid must be a valid LUID, matching the regex: ${luidRegex.source}`,
  );
