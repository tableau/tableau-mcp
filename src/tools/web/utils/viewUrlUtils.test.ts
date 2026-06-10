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

  it('removes /sheets/ segment from contentUrl', () => {
    const result = constructViewWebUrl(
      'https://tableau.example.com',
      'my-site',
      'Superstore/sheets/Overview',
    );
    expect(result).toBe('https://tableau.example.com/#/site/my-site/views/Superstore/Overview');
  });

  it('handles default site with empty string', () => {
    const result = constructViewWebUrl('https://tableau.example.com', '', 'workbook/sheets/Sheet1');
    expect(result).toBe('https://tableau.example.com/#/views/workbook/Sheet1');
  });

  it('handles default site with "Default" string', () => {
    const result = constructViewWebUrl(
      'https://tableau.example.com',
      'Default',
      'Superstore/sheets/Overview',
    );
    expect(result).toBe('https://tableau.example.com/#/views/Superstore/Overview');
  });
});
