import { summarizeCustomTheme } from './customThemeSummary.js';

describe('summarizeCustomTheme', () => {
  it('returns only the stable schema version and sorted top-level style groups', () => {
    expect(
      summarizeCustomTheme({
        version: '1.0.0',
        'base-theme': 'default',
        styles: {
          mark: { 'mark-color': '#123456' },
          'dashboard-title': { 'font-family': 'Tableau Bold' },
          'worksheet-title': { 'font-color': '#654321' },
        },
      }),
    ).toEqual({
      schemaVersion: '1.0.0',
      propertyGroups: ['dashboard-title', 'mark', 'worksheet-title'],
    });
  });

  it('supports a valid sparse theme', () => {
    expect(
      summarizeCustomTheme({
        version: '1.0.0',
        'base-theme': 'default',
        styles: {},
      }),
    ).toEqual({ schemaVersion: '1.0.0', propertyGroups: [] });
  });
});
