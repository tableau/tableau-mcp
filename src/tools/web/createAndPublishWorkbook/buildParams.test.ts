import { strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildParamsToInput } from './buildParams.js';

function assetBody(
  assets: Array<{ path: string; bytes: Uint8Array }> | undefined,
  path: string,
): string {
  const a = (assets ?? []).find((x) => x.path === path);
  if (!a) {
    throw new Error(`asset ${path} not present`);
  }
  return strFromU8(a.bytes);
}

const base = { packageId: 'com.example.viz', workbookName: 'Viz' };

describe('buildParamsToInput', () => {
  it('returns BOTH the emitted split asset and the caller asset (emitted first)', () => {
    const input = buildParamsToInput({
      ...base,
      html: '<script>go();</script>',
      assets: [{ path: 'img/logo.png', base64: Buffer.from('PNGBYTES').toString('base64') }],
    });

    // The inline <script> was externalized AND the caller's image is preserved.
    expect(input.assets?.map((a) => a.path)).toEqual(['app.js', 'img/logo.png']);
    expect(assetBody(input.assets, 'app.js')).toBe('go();');
    expect(assetBody(input.assets, 'img/logo.png')).toBe('PNGBYTES');
    // index.html now references the externalized asset.
    expect(input.html).toBe('<script src="app.js"></script>');
  });

  it('does not collide when the caller reserves a name the transform would have minted', () => {
    const input = buildParamsToInput({
      ...base,
      html: '<script>real();</script>',
      // Caller owns app.js — the transform must NOT overwrite/drop it; it allocates app-2.js.
      assets: [{ path: 'app.js', base64: Buffer.from('caller-bytes').toString('base64') }],
    });

    const paths = input.assets?.map((a) => a.path) ?? [];
    // Exactly one app.js and it holds the CALLER's bytes; the model's code lives at app-2.js.
    expect(paths.filter((p) => p === 'app.js')).toHaveLength(1);
    expect(assetBody(input.assets, 'app.js')).toBe('caller-bytes');
    expect(assetBody(input.assets, 'app-2.js')).toBe('real();');
    expect(input.html).toBe('<script src="app-2.js"></script>');
  });

  it('passes html through unchanged with no assets when nothing is externalizable', () => {
    const input = buildParamsToInput({ ...base, html: '<h1>hi</h1>' });
    expect(input.html).toBe('<h1>hi</h1>');
    expect(input.assets).toBeUndefined();
  });
});
