import { constructViewWebUrl } from './viewUrlUtils.js';

describe('constructViewWebUrl', () => {
  it('constructs correct URL from server, site, and contentUrl', () => {
    const result = constructViewWebUrl(
      'https://tableau.example.com',
      'my-site',
      'workbook/sheets/Sheet1',
    );
    expect(result).toBe('https://tableau.example.com/#/site/my-site/views/workbook/Sheet1');
  });
});
