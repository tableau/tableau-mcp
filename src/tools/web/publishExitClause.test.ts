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
import { getGetCustomViewDataTool } from './views/getCustomViewData.js';
import { getGetViewDataTool } from './views/getViewData.js';

describe('publishExitClause', () => {
  it('is a non-empty string', () => {
    expect(typeof publishExitClause).toBe('string');
    expect(publishExitClause.length).toBeGreaterThan(0);
  });

  it('names the publish tools exactly and no longer references create-data-app', () => {
    expect(publishExitClause).not.toContain('create-data-app');
    expect(publishExitClause).toContain('validate-workbook-package');
    expect(publishExitClause).toContain('create-and-publish-workbook');
  });

  it('steers rendering an in-chat visualization artifact', () => {
    expect(publishExitClause).toMatch(/artifact/i);
    expect(publishExitClause).toMatch(/visualization/i);
    expect(publishExitClause).toMatch(/chart/i);
  });

  it('requires a fullscreen affordance baked into the dashboard HTML', () => {
    // A native artifact has no app chrome, so its fullscreen control must live in the generated
    // HTML itself. Guards against dropping it again.
    expect(publishExitClause).toMatch(/full ?screen/i);
    expect(publishExitClause).toContain('requestFullscreen');
  });

  it('renders as a native artifact where JavaScript runs (artifact-primary)', () => {
    // The interactive dashboard is a Claude artifact — artifacts execute JS, which is what makes
    // the charts interactive. Guard that the clause names the artifact surface and does NOT revert
    // to routing the interactive dashboard through the CSP-restricted in-feed render-data-app path.
    expect(publishExitClause).toMatch(/artifact/i);
    expect(publishExitClause).not.toContain('render-data-app');
  });

  it('conveys the shape gate (multi-row and numeric/measure)', () => {
    expect(publishExitClause).toContain('multi-row');
    expect(publishExitClause).toMatch(/numeric\/measure/);
  });

  it('conveys never-auto-publish / explicit consent', () => {
    expect(publishExitClause).toMatch(/NEVER AUTO-PUBLISH/i);
    expect(publishExitClause).toMatch(/explicit human yes/i);
  });

  it('steers rendering the visualization artifact BY DEFAULT (not offer-then-ask)', () => {
    // The whole point of this clause: after a qualifying data return, render the in-chat
    // visualization artifact automatically. Guards against a silent revert to "offer ... ask
    // first" wording.
    expect(publishExitClause).toMatch(/BY DEFAULT/);
    expect(publishExitClause).toMatch(/do NOT ask/i);
  });

  it('makes rendering the visualization the REQUIRED default, not an optional substitute (defect 1)', () => {
    // Regression guard for the AUTO-TRIGGER MISS: the model answered in plain text instead of
    // rendering the dashboard. The clause must phrase rendering as required/default and explicitly
    // forbid substituting a plain reply or a markdown table.
    expect(publishExitClause).toMatch(/REQUIRED/);
    expect(publishExitClause).toMatch(/do NOT substitute/i);
    expect(publishExitClause).toMatch(/markdown table/i);
  });

  it('mandates an opaque light theme and forbids host/browser-theme reliance (defect 2)', () => {
    // Regression guard for DARK-ON-DARK: the dashboard must set its own opaque light surface with
    // dark high-contrast text and must NOT depend on prefers-color-scheme. Anchor the concrete
    // light-bg / dark-ink hex values so the guidance can't silently regress to a dark theme.
    expect(publishExitClause).toMatch(/opaque, light/i);
    expect(publishExitClause).toContain('prefers-color-scheme');
    expect(publishExitClause).toContain('#f4f6f8');
    expect(publishExitClause).toContain('#ffffff');
    expect(publishExitClause).toContain('#1a1a1a');
  });

  it('requires at least two interactive charts plus KPI cards, table never replacing them (defect 3)', () => {
    // Regression guard for NO CHARTS (KPI cards + table only). The clause must require >= 2 actual
    // charts plus KPI cards, and keep the 'table may accompany but must never replace' rule.
    expect(publishExitClause).toMatch(/at least TWO/i);
    expect(publishExitClause).toMatch(/KPI/);
    expect(publishExitClause).toMatch(/must NEVER replace/i);
  });

  it('steers a full-bleed, fluid layout that fills the surface (not-full-screen fix)', () => {
    // Regression guard for the NOT-FULL-SCREEN / gutter symptom: the published dashboard hosts the
    // HTML in a fit-to-window extension iframe, so the HTML must fill the surface (width/height
    // 100%) rather than sit in a fixed-width column that leaves a side gutter.
    expect(publishExitClause).toMatch(/full-bleed/i);
    expect(publishExitClause).toContain('width: 100%');
    expect(publishExitClause).toContain('height: 100%');
  });

  it('mandates interactive, self-contained inline JS/CSS (artifacts run JS) (blank-charts fix)', () => {
    // Regression guard for BLANK CHARTS: the fix was to render the dashboard as a native artifact
    // (JS executes) rather than the in-feed render-data-app surface (host CSP blocks inline
    // scripts). So the clause must positively steer INTERACTIVE, inline, self-contained output —
    // and must NOT regress to the static/no-script mandate the old in-feed path required.
    expect(publishExitClause).toMatch(/interactive/i);
    expect(publishExitClause).toMatch(/inline JavaScript/i);
    expect(publishExitClause).toMatch(/self-contained/i);
    expect(publishExitClause).not.toMatch(/STATIC inline SVG/);
    expect(publishExitClause).not.toMatch(/must NOT depend on JavaScript/i);
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

  it('getViewData appends publishExitClause', () => {
    const { description } = getGetViewDataTool(new WebMcpServer());
    expect(descriptionOf(description)).toContain(publishExitClause);
  });

  it('getCustomViewData appends publishExitClause', () => {
    const { description } = getGetCustomViewDataTool(new WebMcpServer());
    expect(descriptionOf(description)).toContain(publishExitClause);
  });
});
