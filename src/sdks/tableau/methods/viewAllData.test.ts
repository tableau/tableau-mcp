import { describe, expect, it, vi } from 'vitest';

import { parseViewAllData } from './viewAllData.js';
import ViewsMethods from './viewsMethods.js';

const boundary = 'all-data-boundary';

const multipartBody = Buffer.from(
  [
    `--${boundary}`,
    'Content-Disposition: form-data; name="sales"',
    'Content-Type: text/csv; charset=utf-8',
    'X-Tableau-Sheet-Name: Sales',
    'X-Tableau-Sheet-Status: 200',
    '',
    'Region,Notes',
    'West,"Seattle, WA"',
    'East,"line one',
    'line two"',
    `--${boundary}`,
    'Content-Disposition: form-data; name="broken"',
    'Content-Type: text/csv; charset=utf-8',
    'X-Tableau-Sheet-Name: Broken',
    'X-Tableau-Sheet-Status: 422',
    'X-Tableau-Sheet-Error-Code: 400081',
    'X-Tableau-Sheet-Error-Detail: Sheet+could+not+be+rendered%3A+%C3%A9',
    '',
    ' ',
    `--${boundary}--`,
    '',
  ].join('\r\n'),
);

describe('parseViewAllData', () => {
  it('preserves sheet order, headers, and CSV cells', () => {
    const sheets = parseViewAllData(multipartBody, `multipart/form-data; boundary=${boundary}`);

    expect(sheets).toEqual([
      {
        sheetName: 'Sales',
        status: 'OK',
        errorDetail: undefined,
        columns: ['Region', 'Notes'],
        rows: [
          ['West', 'Seattle, WA'],
          ['East', 'line one\r\nline two'],
        ],
      },
      {
        sheetName: 'Broken',
        status: 'ERROR',
        errorDetail: 'Sheet could not be rendered: é',
        columns: [],
        rows: [],
      },
    ]);
  });

  it('rejects a response without a multipart boundary', () => {
    expect(() => parseViewAllData(multipartBody, 'multipart/form-data')).toThrow(
      'missing multipart boundary',
    );
  });

  it('uses the sheet error code rather than the status range to identify errors', () => {
    const body = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="failed"',
        'Content-Type: text/csv; charset=utf-8',
        'X-Tableau-Sheet-Name: Failed',
        'X-Tableau-Sheet-Status: 200',
        'X-Tableau-Sheet-Error-Code: 500000',
        'X-Tableau-Sheet-Error-Detail: Timed+out',
        '',
        ' ',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    );

    expect(parseViewAllData(body, `multipart/form-data; boundary=${boundary}`)).toEqual([
      {
        sheetName: 'Failed',
        status: 'ERROR',
        errorDetail: 'Timed out',
        columns: [],
        rows: [],
      },
    ]);
  });
});

describe('ViewsMethods.getViewAllData', () => {
  it('requests raw bytes and retains the multipart content type', async () => {
    const viewsMethods = new ViewsMethods(
      'https://tableau.example/api/3.0',
      {
        type: 'Bearer',
        token: 'token',
      },
      {},
    );
    const get = vi.fn().mockResolvedValue({
      data: multipartBody,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    viewsMethods._apiClient.axios.get = get;

    await expect(
      viewsMethods.getViewAllData({ siteId: 'site-1', viewId: 'view-1' }),
    ).resolves.toEqual({
      body: multipartBody,
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
    expect(get).toHaveBeenCalledWith('/sites/site-1/views/view-1/allData', {
      headers: { Authorization: 'Bearer token' },
      responseType: 'arraybuffer',
    });
  });
});
