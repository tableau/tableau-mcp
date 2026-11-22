import cases from './pulseLineageParity.test.fixtures.json';
import { parsePulseLineagePayload } from './pulseLineagePayload.js';

describe('Pulse selector source parity', () => {
  it.each(cases)('$name retains source selectors, scopes, values, roles and paths', (item) => {
    const result = parsePulseLineagePayload(item.payload, item.kind as 'definitions' | 'metrics');
    const projected = result.owners
      .map((owner) => ({
        kind: owner.kind,
        luid: owner.luid,
        name: owner.name,
        datasourceLuid: owner.datasourceLuid ?? null,
        definitionLuid: owner.definitionLuid ?? null,
        uses: owner.uses
          .map((use) => ({
            path: use.path,
            datasourceLuid: use.datasourceLuid ?? null,
            selector: use.selector,
            role: use.role,
            values: use.values,
            evidence: use.evidence,
          }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      }))
      .sort((a, b) => a.luid.localeCompare(b.luid));
    expect(projected).toEqual(item.expected);
  });
});
