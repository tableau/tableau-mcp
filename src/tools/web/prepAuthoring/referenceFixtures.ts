import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import type { PackageType } from './authoringCompiler.js';
import type { Json } from './compactYaml.js';
import reference from './fixtures/python-parity.json';
import { MAX_TOTAL, ProjectIo } from './projectIo.js';

export type ReferenceCase = {
  id: string;
  project: string;
  yaml: string;
  format: PackageType;
  valid: boolean;
  metadataSha256?: string;
  metadataTypesSha256?: string;
  jsonPathCount?: number;
  attachmentHashes?: Record<string, string>;
  pathFields?: { path: (string | number)[]; relative: string }[];
};
export type ReferenceManifest = {
  root: string;
  cases: ReferenceCase[];
  zipFixtures: { path: string; hashes: Record<string, string> }[];
  credentialCases: [string, string][];
  scopeCases: [Json, boolean][];
  inlineCases: [string, boolean][];
  schemaCases: [string | null, string][];
  templateCases: [string, string][];
  scalarCases: {
    id: string;
    yamlText: string;
    valid: boolean;
    valueSha256?: string;
    typesSha256?: string;
  }[];
};
type PublicManifest = Omit<ReferenceManifest, 'root' | 'cases' | 'zipFixtures'> & {
  cases: (Omit<ReferenceCase, 'project' | 'yaml'> & {
    yamlText: string;
    resources: { path: string; base64?: string; repeatByte?: number; byteLength?: number }[];
  })[];
  zipFixtures: { id: string; base64: string; hashes: Record<string, string> }[];
};
export function loadReferenceFixtures(): { manifest: ReferenceManifest; cleanup: () => void } {
  const source = reference as unknown as PublicManifest;
  const root = mkdtempSync(join(tmpdir(), 'prep-golden-')),
    io = new ProjectIo(root);
  const cases = source.cases.map((item) => {
    const project = io.path(item.id);
    io.mkdir(project, true);
    for (const resource of item.resources) {
      if (
        resource.byteLength !== undefined &&
        (resource.byteLength < 0 || resource.byteLength > MAX_TOTAL)
      )
        throw new Error('Invalid synthetic fixture size.');
      const data =
        resource.base64 !== undefined
          ? Buffer.from(resource.base64, 'base64')
          : Buffer.alloc(resource.byteLength!, resource.repeatByte!);
      io.write(io.path(resource.path, project), data);
    }
    const yaml = join(project, 'project.yml');
    io.write(yaml, item.yamlText);
    return { ...item, project, yaml };
  });
  const zipFixtures = source.zipFixtures.map((item) => {
    const path = io.path(item.id + '.tflx');
    io.write(path, Buffer.from(item.base64, 'base64'));
    return { path, hashes: item.hashes };
  });
  const external = process.env.PREP_PYTHON_PARITY_MANIFEST
    ? (JSON.parse(
        readFileSync(process.env.PREP_PYTHON_PARITY_MANIFEST, 'utf8'),
      ) as ReferenceManifest)
    : undefined;
  const manifest = {
    ...source,
    root: external?.root ?? root,
    cases: [...cases, ...(external?.cases.filter((item) => item.id.startsWith('corpus-')) ?? [])],
    zipFixtures,
  };
  return {
    manifest,
    cleanup: () => {
      const rel = relative(resolve(tmpdir()), resolve(root));
      if (!rel.startsWith('prep-golden-') || rel.includes(sep))
        throw new Error('Unowned synthetic fixture root.');
      rmSync(root, { recursive: true, force: true });
    },
  };
}
