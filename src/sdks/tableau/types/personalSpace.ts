import { z } from 'zod';

// readOnly gates whether publish-workbook may publish into this space — a
// security-relevant branch. Unlike project.ts's `tableauBoolean` (which defaults
// unrecognized input to false), unrecognized/missing input here must fail CLOSED
// (readOnly: true) so an ambiguous response never silently permits an auto-publish.
const readOnlyBoolean = z.preprocess((value) => {
  if (value === false) return false;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'false') return false;
  return true;
}, z.boolean());

export const personalSpaceSchema = z.object({
  luid: z.string(),
  ownerLuid: z.string(),
  readOnly: readOnlyBoolean,
});

export type PersonalSpace = z.infer<typeof personalSpaceSchema>;
