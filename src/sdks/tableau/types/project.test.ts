import { describe, expect, it } from 'vitest';

import { projectSchema } from './project.js';

// Tableau REST can deliver `topLevelProject` as the STRINGS "true"/"false" rather than JSON
// booleans. These tests feed raw strings through the real schema to guard the `tableauBoolean`
// preprocess against a regression to `z.coerce.boolean()`, which maps "false" -> true (the
// `Boolean("false") === true` footgun) and would mis-classify a nested project as top-level
// (W-24106279).
describe('projectSchema — topLevelProject (tableauBoolean)', () => {
  const base = {
    id: 'proj-1',
    name: 'Default',
  };

  const parseTopLevel = (topLevelProject: unknown): unknown => {
    const result = projectSchema.safeParse({ ...base, topLevelProject });
    expect(result.success).toBe(true);
    return result.data?.topLevelProject;
  };

  it('coerces the string "false" to false (the critical regression guard)', () => {
    expect(parseTopLevel('false')).toBe(false);
  });

  it('coerces the string "true" to true', () => {
    expect(parseTopLevel('true')).toBe(true);
  });

  it('coerces mixed-case "True" to true (case-insensitive)', () => {
    expect(parseTopLevel('True')).toBe(true);
  });

  it('coerces the empty string to false', () => {
    expect(parseTopLevel('')).toBe(false);
  });

  it('passes JS booleans through unchanged', () => {
    expect(parseTopLevel(true)).toBe(true);
    expect(parseTopLevel(false)).toBe(false);
  });

  it('leaves topLevelProject undefined when omitted', () => {
    const result = projectSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.topLevelProject).toBeUndefined();
  });
});
