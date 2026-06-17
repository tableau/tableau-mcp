import { tmpdir } from 'os';
import { join } from 'path';

import {
  appUrlWithConfig,
  buildTrexManifest,
  extensionIdFor,
  firstDatasourceLuid,
  getDataAppsBaseDir,
  normalizeResources,
  render,
  resolveOutDir,
  slugify,
  xmlEscape,
} from './dataAppShared.js';

describe('dataAppShared', () => {
  describe('slugify', () => {
    it('lowercases and hyphenates', () => {
      expect(slugify('Sales Overview')).toBe('sales-overview');
    });

    it('strips leading/trailing separators and collapses runs', () => {
      expect(slugify('  My__Cool!!App  ')).toBe('my-cool-app');
    });

    it('falls back to data-app for empty input', () => {
      expect(slugify('!!!')).toBe('data-app');
    });
  });

  describe('extensionIdFor', () => {
    it('builds a reverse-DNS id with no hyphens in the leaf', () => {
      expect(extensionIdFor('Sales Overview')).toBe('com.tableau.mcp.dataapp.salesoverview');
    });
  });

  describe('render', () => {
    it('replaces all token occurrences', () => {
      expect(render('__A__ and __A__ and __B__', { A: 'x', B: 'y' })).toBe('x and x and y');
    });
  });

  describe('xmlEscape', () => {
    it('escapes XML-significant characters', () => {
      expect(xmlEscape('a & b < c > "d" \'e\'')).toBe(
        'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;',
      );
    });
  });

  describe('normalizeResources', () => {
    it('merges the datasourceLuid shortcut into the resource array', () => {
      const resources = normalizeResources({
        datasourceLuid: 'ds-1',
        resources: [{ type: 'view', luid: 'v-1' }],
      });
      expect(resources).toEqual([
        { type: 'datasource', luid: 'ds-1', name: 'datasource1' },
        { type: 'view', luid: 'v-1', name: 'view1' },
      ]);
    });

    it('dedupes by type+luid and auto-names per type', () => {
      const resources = normalizeResources({
        resources: [
          { type: 'datasource', luid: 'ds-1' },
          { type: 'datasource', luid: 'ds-1' },
          { type: 'datasource', luid: 'ds-2', name: 'primary' },
        ],
      });
      expect(resources).toEqual([
        { type: 'datasource', luid: 'ds-1', name: 'datasource1' },
        { type: 'datasource', luid: 'ds-2', name: 'primary' },
      ]);
    });
  });

  describe('firstDatasourceLuid', () => {
    it('returns the first datasource luid', () => {
      expect(
        firstDatasourceLuid([
          { type: 'view', luid: 'v-1' },
          { type: 'datasource', luid: 'ds-9' },
        ]),
      ).toBe('ds-9');
    });

    it('returns empty string when no datasource present', () => {
      expect(firstDatasourceLuid([{ type: 'view', luid: 'v-1' }])).toBe('');
    });
  });

  describe('appUrlWithConfig', () => {
    it('keeps the URL short for the default query endpoint (no resource blob)', () => {
      const url = appUrlWithConfig({
        appUrl: 'https://my-app.herokuapp.com',
        queryEndpoint: '/query',
      });
      expect(url).toBe('https://my-app.herokuapp.com/');
      expect(url).not.toContain('resources');
    });

    it('encodes only a non-default query endpoint as a query param', () => {
      const url = appUrlWithConfig({
        appUrl: 'https://my-app.herokuapp.com',
        queryEndpoint: '/api/query',
      });
      expect(url).toContain('queryEndpoint=%2Fapi%2Fquery');
      expect(url).not.toContain('resources');
    });

    it('strips trailing slashes from the base URL', () => {
      const url = appUrlWithConfig({
        appUrl: 'https://my-app.herokuapp.com///',
      });
      expect(url).toBe('https://my-app.herokuapp.com/');
    });
  });

  describe('buildTrexManifest', () => {
    const trex = buildTrexManifest({
      appName: 'Sales & Ops',
      extensionId: 'com.tableau.mcp.dataapp.salesops',
      appUrl: 'https://my-app.herokuapp.com',
      queryEndpoint: '/query',
    });

    it('is a dashboard extension manifest', () => {
      expect(trex).toContain('<dashboard-extension id="com.tableau.mcp.dataapp.salesops"');
      expect(trex).toContain('<min-api-version>1.4</min-api-version>');
    });

    it('requests full data permission', () => {
      expect(trex).toContain('<permission>full data</permission>');
    });

    it('embeds the hosted URL without a giant resource blob', () => {
      expect(trex).toContain('<url>https://my-app.herokuapp.com/</url>');
      expect(trex).not.toContain('resources=');
    });

    it('xml-escapes the app name', () => {
      expect(trex).toContain('Sales &amp; Ops');
    });
  });

  describe('resolveOutDir', () => {
    it('accepts an existing, writable directory', () => {
      const result = resolveOutDir(tmpdir());
      expect(result.ok).toBe(true);
    });

    it('accepts a not-yet-existing dir whose parent is writable', () => {
      const result = resolveOutDir(join(tmpdir(), `tmcp-out-${Date.now()}`, 'nested'));
      expect(result.ok).toBe(true);
    });

    it('rejects a sandbox path that does not exist on this machine', () => {
      // /home/user is a common agent-container path; it is not creatable on macOS/CI.
      const result = resolveOutDir('/home/user/some-nonexistent-root-xyz/app');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('not your sandbox');
        expect(result.message).toContain('Omit outDir');
      }
    });
  });

  describe('getDataAppsBaseDir', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('honors the TABLEAU_DATA_APPS_DIR override', () => {
      vi.stubEnv('TABLEAU_DATA_APPS_DIR', '/explicit/override');
      expect(getDataAppsBaseDir()).toBe('/explicit/override');
    });

    it('returns a writable directory when no override is set', () => {
      vi.stubEnv('TABLEAU_DATA_APPS_DIR', '');
      const base = getDataAppsBaseDir();
      expect(base).toBeTruthy();
      expect(base).not.toBe('/');
    });
  });
});
