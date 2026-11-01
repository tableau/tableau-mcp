import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const prepAuthoringAssets = [
  'runner.py',
  'MIGRATION.json',
  'requirements.txt',
  'prep_engine/__init__.py',
  'prep_engine/authoring.py',
  'prep_engine/authoring_models.py',
  'prep_engine/bounded_io.py',
  'prep_engine/credential_policy.py',
  'prep_engine/io.py',
  'prep_engine/logging.py',
  'prep_engine/schema.py',
  'prep_engine/value_contracts.py',
  'prep_engine/tableau_prep_flow.schema.yaml',
] as const;

/** Stage only the reviewed source/schema closure, never caches or native binaries. */
export function stagePrepAuthoringAssets(source: string, destination: string): void {
  for (const relative of prepAuthoringAssets) {
    const target = join(destination, relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, relative), target);
  }
}
