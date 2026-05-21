import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('features.json validation', () => {
  it('should have valid features.json in project root', () => {
    const configPath = path.join(process.cwd(), 'features.json');

    // File must exist
    expect(existsSync(configPath)).toBe(true);

    // Must be valid JSON
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Must match schema: record of string → boolean
    const schema = z.record(z.string(), z.boolean());
    const result = schema.safeParse(config);

    expect(result.success).toBe(true);
    if (!result.success) {
      // Show detailed error if validation fails
      console.error('features.json validation errors:', result.error.format());
    }
  });
});
