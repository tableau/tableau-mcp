import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Apply-copy drift guard (W30-A). The apply tools load their template XML from
// src/desktop/data/templates/*.xml (the "apply copies") via getTemplatePath. Those
// files are hand-maintained SOURCE — not generated, not content-hashed — and had
// silently drifted from their same-named reference counterparts in
// data-visualization-templates-xml (the binder's read-only source of truth).
//
// This suite pins the mirror invariant: every file present in BOTH dirs must be
// byte-identical to its reference. Future drift (in either direction) fails loud here.

const APPLY_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'templates');
const REFERENCE_DIR = join(
  process.cwd(),
  'src',
  'desktop',
  'data',
  'data-visualization-templates-xml',
);

const xmlNames = (dir: string): Set<string> =>
  new Set(readdirSync(dir).filter((f) => f.endsWith('.xml')));

const applyNames = xmlNames(APPLY_DIR);
const referenceNames = xmlNames(REFERENCE_DIR);
const sharedNames = [...applyNames].filter((n) => referenceNames.has(n)).sort();

describe('desktop/templates/applyCopyMirror — apply copies mirror the reference library', () => {
  it('there is a non-empty set of same-named files to pin (guards a vacuous pass)', () => {
    expect(sharedNames.length).toBeGreaterThan(0);
  });

  it.each(sharedNames)('apply copy %s is byte-identical to its reference counterpart', (name) => {
    const applyBuf = readFileSync(join(APPLY_DIR, name));
    const referenceBuf = readFileSync(join(REFERENCE_DIR, name));
    // String compare first for a readable RED diff on any content drift...
    expect(applyBuf.toString('utf-8')).toBe(referenceBuf.toString('utf-8'));
    // ...then assert true byte-for-byte identity (catches encoding/BOM/newline drift).
    expect(applyBuf.equals(referenceBuf)).toBe(true);
  });
});
