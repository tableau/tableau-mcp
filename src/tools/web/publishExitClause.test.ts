import { describe, expect, it } from 'vitest';

import { WebMcpServer } from '../../server.web.js';
import { testProductVersion } from '../../testShared.js';
import { getSearchContentTool } from './contentExploration/searchContent.js';
import { getListDatasourcesTool } from './datasources/listDatasources.js';
import { getGetDatasourceMetadataTool } from './getDatasourceMetadata/getDatasourceMetadata.js';
import { publishExitClause } from './publishExitClause.js';
import { queryDatasourceToolDescription20253 } from './queryDatasource/descriptions/queryDescription.2025.3.js';
import { queryDatasourceToolDescription20261 } from './queryDatasource/descriptions/queryDescription.2026.1.js';
import { queryDatasourceToolDescription } from './queryDatasource/descriptions/queryDescription.js';

describe('publishExitClause', () => {
  it('is a non-empty string', () => {
    expect(typeof publishExitClause).toBe('string');
    expect(publishExitClause.length).toBeGreaterThan(0);
  });

  it('names the two workbook tools exactly', () => {
    expect(publishExitClause).toContain('validate-workbook-package');
    expect(publishExitClause).toContain('create-and-publish-workbook');
  });

  it('conveys the shape gate (multi-row and numeric/measure)', () => {
    expect(publishExitClause).toContain('multi-row');
    expect(publishExitClause).toMatch(/numeric\/measure/);
  });

  it('conveys never-auto-publish / explicit consent', () => {
    expect(publishExitClause).toMatch(/NEVER AUTO-PUBLISH/i);
    expect(publishExitClause).toMatch(/explicit human yes/i);
  });

  it('states that validation does not guarantee dashboard quality', () => {
    expect(publishExitClause).toContain('NOT a guaranteed-good dashboard');
    expect(publishExitClause).toContain('64MB');
  });
});

describe('queryDescription composition', () => {
  it('appends the clause to the default query description', () => {
    expect(queryDatasourceToolDescription.includes(publishExitClause)).toBe(true);
  });

  it('appends the clause to the 2025.3 query description', () => {
    expect(queryDatasourceToolDescription20253.includes(publishExitClause)).toBe(true);
  });

  it('appends the clause to the 2026.1 query description', () => {
    expect(queryDatasourceToolDescription20261.includes(publishExitClause)).toBe(true);
  });
});

describe('inline-description composition', () => {
  // Construct the tool and assert the CLAUSE landed in the composed description string. This is
  // stronger than grepping the source for the identifier: it proves the interpolation actually
  // resolved into the tool's description. The description is a static template literal, so
  // `tool.description` is a plain string.
  const descriptionOf = (description: unknown): string => {
    expect(typeof description).toBe('string');
    return description as string;
  };

  it('listDatasources appends publishExitClause', () => {
    const { description } = getListDatasourcesTool(new WebMcpServer());
    expect(descriptionOf(description)).toContain(publishExitClause);
  });

  it('getDatasourceMetadata appends publishExitClause', () => {
    const { description } = getGetDatasourceMetadataTool(new WebMcpServer(), testProductVersion);
    expect(descriptionOf(description)).toContain(publishExitClause);
  });

  it('searchContent appends publishExitClause', () => {
    const { description } = getSearchContentTool(new WebMcpServer());
    expect(descriptionOf(description)).toContain(publishExitClause);
  });
});
