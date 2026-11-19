import FlowsMethods from './methods/flowsMethods.js';
import WorkbooksMethods from './methods/workbooksMethods.js';
import { getHeader } from './responseHeaders.js';

const resourceId = '96a43833-27db-40b6-aa80-751efc776b9a';
const resources = [
  {
    kind: 'flow',
    create: () => {
      const methods = new FlowsMethods(
        'https://tableau.example',
        { type: 'Bearer', token: 'test' },
        {},
      );
      return {
        methods,
        download: () => methods.downloadFlow({ siteId: 'site', flowId: resourceId }),
      };
    },
  },
  {
    kind: 'workbook',
    create: () => {
      const methods = new WorkbooksMethods(
        'https://tableau.example',
        { type: 'Bearer', token: 'test' },
        {},
      );
      return {
        methods,
        download: () => methods.downloadWorkbook({ siteId: 'site', workbookId: resourceId }),
      };
    },
  },
];

describe.each(resources)('$kind download response metadata', ({ create }) => {
  it.each([
    { header: "attachment; filename*=UTF-8''Example%20File.tfl", filename: 'Example File.tfl' },
    { header: 'attachment; filename=" Example File.tfl "', filename: 'Example File.tfl' },
    { header: 'attachment; filename= Example File.tfl ; size=3', filename: 'Example File.tfl' },
    { header: "attachment; filename*=UTF-8''Broken%ZZ.tfl", filename: 'Broken%ZZ.tfl' },
    { header: ['attachment; filename="Array.tfl"', 'ignored'], filename: 'Array.tfl' },
    { header: 'attachment; filename="   "', filename: undefined },
    { header: undefined, filename: undefined },
  ])('preserves bytes and returns $filename for $header', async ({ header, filename }) => {
    const { methods, download } = create();
    const content = Buffer.from([0, 255, 42]);
    const get = vi.fn().mockResolvedValue({
      data: content,
      headers: {
        'content-type': ['application/octet-stream', 'ignored'],
        'content-disposition': header,
      },
    });
    Object.defineProperty(methods, '_apiClient', { value: { axios: { get } } });

    expect(await download()).toEqual({
      content,
      contentType: 'application/octet-stream',
      filename,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('getHeader', () => {
  it('uses a normalized lower-case header when the requested name is mixed case', () => {
    expect(getHeader({ 'content-type': 'application/xml' }, 'Content-Type')).toBe(
      'application/xml',
    );
  });
  it.each([42, [42, 'ignored'], [], undefined])('rejects a non-string header value %j', (value) => {
    expect(getHeader({ 'content-type': value }, 'content-type')).toBeUndefined();
  });
});
