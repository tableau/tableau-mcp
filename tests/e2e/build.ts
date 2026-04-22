import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

import { Variant } from '../../src/scripts/variants';

const execAsync = promisify(exec);

export async function buildVariant(variant: Variant): Promise<void> {
  const buildCommand = `npx tsx src/scripts/build.ts --variant ${variant} --dirty`;
  const expectedOutputPath = join(
    'build',
    variant === 'default' ? 'index.js' : `index.${variant}.js`,
  );

  try {
    await execAsync(buildCommand);
    expect(existsSync(expectedOutputPath)).toBe(true);
  } catch (error) {
    console.error(`Failed to build ${variant} variant:`, error);
    throw error;
  }
}
