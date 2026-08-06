import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  getRuntimeTemplateSnapshot,
  loadRuntimeTemplateCatalogSnapshots,
  loadRuntimeTemplateDescriptors,
  runtimeTemplateDescriptorFromSnapshot,
} from './runtimeTemplateCatalog.js';
import { createTemplateRuntimeSnapshot } from './templateRuntimeSnapshot.js';

const BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.donor'>" +
  "<column name='[Value]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Member]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table><rows>[federated.donor].[none:Member:nk]</rows>' +
  '<cols>[federated.donor].[sum:Value:qk]</cols></table>' +
  '</bookmark>';

const UNSUPPORTED_BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.donor'>" +
  "<column name='[Broken Calc]' datatype='real' role='measure' type='quantitative'>" +
  "<calculation class='tableau' formula='[Missing Input]'/>" +
  '</column>' +
  '</datasource>' +
  '</datasources>' +
  '<table><cols>[federated.donor].[sum:Broken Calc:qk]</cols></table>' +
  '</bookmark>';

describe('runtimeTemplateDescriptorFromSnapshot', () => {
  it('derives puppet selection facts from the TBM name and structure', () => {
    const snapshot = createTemplateRuntimeSnapshot(
      'ranking__ordered-bar__show-order-when-rank-matters-more-than-value',
      BOOKMARK,
    );

    const descriptor = runtimeTemplateDescriptorFromSnapshot(snapshot);

    expect(descriptor).toMatchObject({
      template: snapshot.template,
      family: 'ranking',
      fast_path_eligible: true,
      slots: snapshot.descriptor.slots,
      calcs: snapshot.descriptor.calcs,
    });
    expect(descriptor.intent_keywords).toEqual(
      expect.arrayContaining(['ranking', 'ordered bar', 'rank', 'value']),
    );
    expect(descriptor).not.toHaveProperty('source');
    expect(descriptor).not.toHaveProperty('local_xml_path');
    expect(descriptor).not.toHaveProperty('readiness');
    expect(descriptor).not.toHaveProperty('portability_evidence');
    expect(descriptor).not.toHaveProperty('hazards');
  });

  it('fails closed for a structurally ineligible TBM without hand-authored policy', () => {
    const snapshot = createTemplateRuntimeSnapshot('custom-chart', BOOKMARK);
    snapshot.eligibility = {
      pass1_eligible: false,
      pass1_blockers: ['bare-field-reference'],
    };

    const descriptor = runtimeTemplateDescriptorFromSnapshot(snapshot);

    expect(descriptor.fast_path_eligible).toBe(false);
    expect(descriptor.fast_path_blockers).toEqual(['bare-field-reference']);
  });
});

describe('loadRuntimeTemplateCatalogSnapshots', () => {
  it('pins descriptor and applied XML to the same TBM bytes when the source changes later', () => {
    const root = mkdtempSync(join(process.cwd(), 'tmp-runtime-template-'));
    const previous = process.env['TEMPLATES_DIR'];
    try {
      process.env['TEMPLATES_DIR'] = root;
      const path = join(root, 'ranking-ordered-bar.tbm');
      writeFileSync(path, BOOKMARK);
      const expected = createTemplateRuntimeSnapshot('ranking-ordered-bar', BOOKMARK);

      const pinned = loadRuntimeTemplateCatalogSnapshots().get('ranking-ordered-bar');
      writeFileSync(path, BOOKMARK.replace('[Value]', '[Changed Value]'));

      expect(pinned?.snapshot.sourceHash).toBe(expected.sourceHash);
      expect(pinned?.snapshot.xml).toBe(expected.xml);
      expect(pinned?.descriptor.slots).toEqual(expected.descriptor.slots);
    } finally {
      if (previous === undefined) delete process.env['TEMPLATES_DIR'];
      else process.env['TEMPLATES_DIR'] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('isolates an unsupported external winner without exposing its lower-precedence fallback', () => {
    const root = mkdtempSync(join(process.cwd(), 'tmp-runtime-template-repository-'));
    try {
      const custom = join(root, 'Tableau Agent', 'templates');
      const overridable = join(custom, '.vendored', 'overridable');
      mkdirSync(custom, { recursive: true });
      mkdirSync(overridable, { recursive: true });
      writeFileSync(join(overridable, 'ranking-ordered-bar.tbm'), BOOKMARK);
      writeFileSync(join(custom, 'ranking-ordered-bar.tbm'), UNSUPPORTED_BOOKMARK);
      writeFileSync(join(custom, 'custom-valid-sibling.tbm'), BOOKMARK);

      expect(() =>
        createTemplateRuntimeSnapshot('ranking-ordered-bar', UNSUPPORTED_BOOKMARK),
      ).toThrow(
        "Calculated field dependency 'Missing Input' is missing from the column dictionary.",
      );

      const options = { repositoryRoot: root, includeProtected: false };
      const snapshots = loadRuntimeTemplateCatalogSnapshots(options);
      const descriptors = loadRuntimeTemplateDescriptors(options);

      expect(snapshots.has('ranking-ordered-bar')).toBe(false);
      expect(descriptors.has('ranking-ordered-bar')).toBe(false);
      expect(getRuntimeTemplateSnapshot('ranking-ordered-bar', options)).toBeNull();
      expect(snapshots.get('custom-valid-sibling')?.snapshot.template).toBe('custom-valid-sibling');
      expect(descriptors.has('custom-valid-sibling')).toBe(true);
      expect(
        getRuntimeTemplateSnapshot('trend-line-chart', {
          includeExternal: false,
        }),
      ).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
