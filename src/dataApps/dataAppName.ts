import { z } from 'zod';

export const datappNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,98}[A-Za-z0-9])?$/,
    'Name must be 1-100 characters using letters, digits, spaces, dot, underscore, or hyphen, and must start and end with a letter or digit.',
  )
  .refine((value) => !value.includes('..'), 'Name must not contain "..".');

export function slugDataAppName(name: string): string {
  const slugged = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slugged || 'app';
}
