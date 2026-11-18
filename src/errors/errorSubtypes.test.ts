import { describe, expect, it } from 'vitest';

import { ALL_ERROR_SUBTYPE_GROUPS, QueryValidationSubtype } from './errorSubtypes.js';
import { QueryValidationError } from './mcpToolError.js';

describe('error subtypes', () => {
  it('assigns a unique value to every sub-code across all groups (never-reuse guard)', () => {
    const values = Object.values(ALL_ERROR_SUBTYPE_GROUPS).flatMap((group) => Object.values(group));
    const seen = new Set<string>();
    const duplicates = values.filter((value) => {
      if (seen.has(value)) {
        return true;
      }
      seen.add(value);
      return false;
    });

    // A reused sub-code would make two distinct failure modes indistinguishable in telemetry.
    expect(duplicates).toEqual([]);
  });

  it('uses kebab-case, wording-independent literals (no interpolated/PII-shaped content)', () => {
    const values = Object.values(ALL_ERROR_SUBTYPE_GROUPS).flatMap((group) => Object.values(group));
    for (const value of values) {
      expect(value).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('round-trips the sub-code onto the error so telemetry can read it', () => {
    const error = new QueryValidationError('msg', QueryValidationSubtype.MetadataMismatch);
    expect(error.type).toBe('query-validation');
    expect(error.subtype).toBe('metadata-mismatch');
  });

  it('leaves subtype undefined when none is assigned', () => {
    const error = new QueryValidationError('msg');
    expect(error.subtype).toBeUndefined();
  });
});
