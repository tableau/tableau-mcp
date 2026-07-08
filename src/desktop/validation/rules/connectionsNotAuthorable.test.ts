import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { connectionsNotAuthorableRule } from './connectionsNotAuthorable.js';

const LIVE_READBACK_FIXTURE = path.join(
  process.cwd(),
  'src',
  'desktop',
  'binder',
  'fixtures',
  'superstore-scratch-ref.xml',
);

describe('connections-not-authorable rule', () => {
  it('a bare hand-authored excel-direct connection (copied from a .tds, not federated) is rejected', () => {
    // The known-bad shape from tableau-oracle-connection-xml.md: a <connection> copied
    // straight from a .tds, not wrapped in <named-connections>/federated.
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <connection class="excel-direct" cleaning="no" compat="no" dataRefreshTime=""
        filename="/Users/me/Documents/sales.xls" interpretationMode="0" password="" server="" validate="no" />
    </datasource>
  </datasources>
</workbook>`;
    const issues = connectionsNotAuthorableRule.validate(xml);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues[0].message).toContain('connections-not-authorable');
    expect(issues[0].message).toContain('Do not retry');
    expect(issues[0].message).not.toMatch(/^FIX/i);
  });

  it('a federated wrapper with a fabricated (non-Desktop-minted) named-connection id is rejected', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <connection class="federated">
        <named-connections>
          <named-connection caption="Sales" name="excel-direct.myconnection1">
            <connection class="excel-direct" filename="/Users/me/Documents/sales.xls" />
          </named-connection>
        </named-connections>
      </connection>
    </datasource>
  </datasources>
</workbook>`;
    const issues = connectionsNotAuthorableRule.validate(xml);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].xpath).toContain('excel-direct.myconnection1');
  });

  it('a federated wrapper with a Desktop-minted named-connection id passes', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <connection class="federated">
        <named-connections>
          <named-connection caption="Sales" name="excel-direct.0ozsbj20cdelf51evvdk71kugqg0">
            <connection class="excel-direct" filename="/Users/me/Documents/sales.xls" />
          </named-connection>
        </named-connections>
      </connection>
    </datasource>
  </datasources>
</workbook>`;
    expect(connectionsNotAuthorableRule.validate(xml)).toEqual([]);
  });

  it('a fragment with no <connection> element at all is never flagged', () => {
    const xml = `<?xml version="1.0"?>
<worksheet name="Sheet 1">
  <table>
    <view />
  </table>
</worksheet>`;
    expect(connectionsNotAuthorableRule.validate(xml)).toEqual([]);
  });

  it('the real live-readback fixture (genuine Desktop connection shape) is never rejected', () => {
    const xml = fs.readFileSync(LIVE_READBACK_FIXTURE, 'utf8');
    const issues = connectionsNotAuthorableRule.validate(xml);
    expect(
      issues,
      `unexpected rejection of a genuine live-readback fixture: ${JSON.stringify(issues)}`,
    ).toEqual([]);
  });

  it('a live-readback round-trip (unmodified connections, re-applied as-is) is never rejected via runValidation', () => {
    const xml = fs.readFileSync(LIVE_READBACK_FIXTURE, 'utf8');
    const result = runValidation(xml, 'workbook');
    const offenders = result.issues.filter((i) => i.ruleId === 'connections-not-authorable');
    expect(offenders).toEqual([]);
  });

  it('is registered for the workbook and datasource contexts, not worksheet/dashboard', () => {
    expect(connectionsNotAuthorableRule.contexts).toEqual(['workbook', 'datasource']);
  });

  it('fires through runValidation(xml, "workbook") end-to-end, terminally (invalid → not just a warning)', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <connection class="excel-direct" filename="/Users/me/Documents/sales.xls" />
    </datasource>
  </datasources>
</workbook>`;
    const result = runValidation(xml, 'workbook');
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'connections-not-authorable')).toBe(true);
  });

  it('does not fire in the worksheet or dashboard contexts (out of scope by design)', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <connection class="excel-direct" filename="/Users/me/Documents/sales.xls" />
    </datasource>
  </datasources>
</workbook>`;
    const worksheetResult = runValidation(xml, 'worksheet');
    const dashboardResult = runValidation(xml, 'dashboard');
    expect(worksheetResult.issues.some((i) => i.ruleId === 'connections-not-authorable')).toBe(
      false,
    );
    expect(dashboardResult.issues.some((i) => i.ruleId === 'connections-not-authorable')).toBe(
      false,
    );
  });
});

describe('connections-not-authorable — bundled template corpus never self-rejects', () => {
  const XML_DIR = path.join(
    process.cwd(),
    'src',
    'desktop',
    'data',
    'data-visualization-templates-xml',
  );
  const xmlFiles = fs.readdirSync(XML_DIR).filter((f) => f.endsWith('.xml'));

  it('discovers a non-empty shipped template corpus', () => {
    expect(xmlFiles.length).toBeGreaterThan(0);
  });

  it.each(xmlFiles)(
    'runValidation(%s, "workbook") reports zero connections-not-authorable issues',
    (file) => {
      const xml = fs.readFileSync(path.join(XML_DIR, file), 'utf8');
      const result = runValidation(xml, 'workbook');
      const offenders = result.issues.filter((i) => i.ruleId === 'connections-not-authorable');
      expect(
        offenders,
        `${file}: template must not self-reject on connections-not-authorable`,
      ).toEqual([]);
    },
  );
});
