import { describe, expect, it } from 'vitest';

import {
  allowedPackageRootFiles,
  findMissingPackageTargets,
  findUnexpectedNonBuildFiles,
  getPackageTargets,
  normalizePackResults,
} from './packedPackageTargets.js';

describe('packedPackageTargets', () => {
  it('collects main, types, bin and nested exports targets without ./', () => {
    const pkg = {
      main: './build/index.js',
      types: './build/index.d.ts',
      bin: { 'tableau-mcp-server': './build/index.js' },
      exports: {
        '.': { types: './build/index.d.ts', default: './build/index.js' },
        './activity-log': [{ import: { types: './build/activityLog/provider.d.ts' } }],
        './package.json': './package.json',
        './blocked': null,
      },
    };

    expect(getPackageTargets(pkg).sort()).toEqual([
      'build/activityLog/provider.d.ts',
      'build/index.d.ts',
      'build/index.js',
      'package.json',
    ]);
  });

  it('accepts a string bin and skips wildcard patterns', () => {
    expect(getPackageTargets({ bin: 'build/cli.js', exports: { './*': './build/*.js' } })).toEqual([
      'build/cli.js',
    ]);
  });

  it('reports a missing exports types target by name', () => {
    const pkg = { exports: { './activity-log': { types: './build/activityLog/provider.d.ts' } } };
    expect(findMissingPackageTargets(pkg, new Set(['package.json']))).toEqual([
      'build/activityLog/provider.d.ts',
    ]);
  });

  it('checks targets nested inside condition objects', () => {
    const pkg = { exports: { '.': { node: { import: { default: './build/esm.js' } } } } };
    expect(findMissingPackageTargets(pkg, new Set())).toEqual(['build/esm.js']);
  });

  it('passes when every target is packed', () => {
    const pkg = { main: './build/index.js', bin: { x: './build/index.js' } };
    expect(findMissingPackageTargets(pkg, new Set(['build/index.js']))).toEqual([]);
  });

  describe('findUnexpectedNonBuildFiles', () => {
    const allowed = [...allowedPackageRootFiles];

    it('accepts the allowed root files and ignores build files', () => {
      expect(findUnexpectedNonBuildFiles([...allowed, 'build/index.js'])).toEqual([]);
    });

    it('rejects README.desktop.md', () => {
      expect(findUnexpectedNonBuildFiles([...allowed, 'README.desktop.md'])).toEqual([
        'README.desktop.md',
      ]);
    });

    it('rejects nested non-build paths', () => {
      expect(findUnexpectedNonBuildFiles([...allowed, 'resources/desktop/x.json'])).toEqual([
        'resources/desktop/x.json',
      ]);
    });

    it('rejects README.combined.md', () => {
      expect(findUnexpectedNonBuildFiles([...allowed, 'README.combined.md'])).toEqual([
        'README.combined.md',
      ]);
    });
  });

  describe('normalizePackResults', () => {
    const result = {
      filename: 'tableau-mcp-server-5.1.2.tgz',
      files: [{ path: 'build/index.js' }],
    };

    it('returns the npm <=11 array shape unchanged', () => {
      expect(normalizePackResults([result])).toEqual([result]);
    });

    it('unwraps the npm 12+ object keyed by package name', () => {
      expect(normalizePackResults({ '@tableau/mcp-server': result })).toEqual([result]);
    });

    it('reports more than one artifact when either shape has multiple entries', () => {
      expect(normalizePackResults([result, result])).toHaveLength(2);
      expect(normalizePackResults({ a: result, b: result })).toHaveLength(2);
    });

    it('returns an empty array for non-object JSON', () => {
      expect(normalizePackResults(null)).toEqual([]);
      expect(normalizePackResults('tableau-mcp-server-5.1.2.tgz')).toEqual([]);
      expect(normalizePackResults(42)).toEqual([]);
    });
  });
});
