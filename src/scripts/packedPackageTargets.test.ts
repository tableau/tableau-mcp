import { describe, expect, it } from 'vitest';

import { findMissingPackageTargets, getPackageTargets } from './packedPackageTargets.js';

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
});
