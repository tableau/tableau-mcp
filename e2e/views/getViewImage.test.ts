import z from 'zod';

import { deleteConfigJsons, writeConfigJson } from '../configJson.js';
import { callTool } from '../startInspector.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../testEnv.js';

describe('get-view-image', () => {
  beforeAll(() => deleteConfigJsons('get-view-image'));
  afterEach(() => deleteConfigJsons('get-view-image'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should get view image', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const { filename: configJson } = writeConfigJson({
      describe: 'get-view-image',
      env,
    });

    const pngData = await callTool('get-view-image', {
      configJson,
      schema: z.string(),
      toolArgs: { viewId: superstore.defaultViewId },
      expectedContentType: 'image',
    });

    // Assert the PNG data starts with the eight-byte PNG signature.
    // https://en.wikipedia.org/wiki/PNG#File_header
    const decoded = Buffer.from(pngData, 'base64').toString('binary');
    expect(
      [...decoded.substring(0, 8)]
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
        .join(''),
    ).toBe('89504E470D0A1A0A');
  });
});
