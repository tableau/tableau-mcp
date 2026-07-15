import { beforeAll, describe, expect, it } from 'vitest';

import {
  type BindingProposal,
  bindTemplate,
  classifyNoLlm,
  PROPOSAL_OUTPUT_SCHEMA,
  summarizeSchema,
} from './binder.js';
import { loadManifests } from './manifest.js';
import type { TemplateManifest } from './manifest-types.js';

// PORTABILITY-LANE behavioral evidence (ported from a2td src/binder/portability-lane.test.ts).
// tmcp's richer portability.invariant.test.ts already pins the zero-wrong-bind headline over
// three alien schemas, but those fixtures deliberately carry NO geo semantic-role and never
// exercise the histogram bin-width refusal. This suite adds the offline bind assertions that
// prove the NEW overnight behaviors are live in tmcp:
//   • W2 — a Territory-class field tagged [State].[Name] binds the choropleth state slot by
//     SEMANTIC ROLE (token affinity alone cannot see that "Territory" is state-level).
//   • W3 — a histogram with no live bin-width stats REFUSES rather than binding a
//     dataset-specific default (tmcp: fast_path gate + DATASET_SPECIFIC_FORMULA blocker; the
//     a2td Superstore-derived 500 has no home here because tmcp never carried the width adapter).
//   • W1 — non-Superstore datasources bind end-to-end with their own datasource name; the
//     field_mapping never leaks "Superstore".

const SAAS_OPS_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='SaaSOpsDS'>
      <column name='[Territory]' role='dimension' type='nominal' datatype='string' semantic-role='[State].[Name]' />
      <column name='[Country]' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[ISO3166_2]' />
      <column name='[City]' role='dimension' type='nominal' datatype='string' semantic-role='[City].[Name]' />
      <column name='[Account Segment]' role='dimension' type='nominal' datatype='string' />
      <column name='[Product Line]' role='dimension' type='nominal' datatype='string' />
      <column name='[Customer ID]' role='dimension' type='nominal' datatype='string' />
      <column name='[Signup Date]' role='dimension' type='ordinal' datatype='date' />
      <column name='[MRR]' role='measure' type='quantitative' datatype='real' />
      <column name='[Expansion ARR]' role='measure' type='quantitative' datatype='real' />
      <column name='[Seats]' role='measure' type='quantitative' datatype='integer' />
      <column name='[Churn Rate]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

const HEALTHCARE_CLAIMS_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='HealthcareClaimsDS'>
      <column name='[Claim Month]' role='dimension' type='ordinal' datatype='date' />
      <column name='[Payer]' role='dimension' type='nominal' datatype='string' />
      <column name='[Service Line]' role='dimension' type='nominal' datatype='string' />
      <column name='[Diagnosis Group]' role='dimension' type='nominal' datatype='string' />
      <column name='[Provider Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[Claim ID]' role='dimension' type='nominal' datatype='string' />
      <column name='[Allowed Amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[Paid Amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[Member Months]' role='measure' type='quantitative' datatype='integer' />
      <column name='[Denial Rate]' role='measure' type='quantitative' datatype='real' />
      <column name='[Readmission Rate]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

const FINANCE_PLANNING_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='FinancePlanningDS'>
      <column name='[Fiscal Period]' role='dimension' type='nominal' datatype='string' />
      <column name='[Posting Date]' role='dimension' type='ordinal' datatype='date' />
      <column name='[Entity]' role='dimension' type='nominal' datatype='string' />
      <column name='[Department]' role='dimension' type='nominal' datatype='string' />
      <column name='[Actual Amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[Budget Amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[Forecast Amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[Variance Percent]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

let manifests: Map<string, TemplateManifest>;
beforeAll(() => {
  manifests = loadManifests();
});

// A few tests need a blocker-held template to be eligible so binder behavior can be
// isolated from the manifest gate (mirrors portability.invariant.test.ts's helper).
function withForcedEligible(names: string[]): Map<string, TemplateManifest> {
  const out = new Map<string, TemplateManifest>();
  for (const [k, v] of loadManifests()) {
    out.set(k, names.includes(k) ? { ...v, fast_path_eligible: true } : v);
  }
  return out;
}

describe('portability-lane — schema fixtures summarize to their own alien datasource', () => {
  it('summarizes the three non-Superstore datasource fixtures', () => {
    expect(summarizeSchema(SAAS_OPS_WORKBOOK_XML).datasource).toBe('SaaSOpsDS');
    expect(summarizeSchema(HEALTHCARE_CLAIMS_WORKBOOK_XML).datasource).toBe('HealthcareClaimsDS');
    expect(summarizeSchema(FINANCE_PLANNING_WORKBOOK_XML).datasource).toBe('FinancePlanningDS');
  });
});

describe('portability-lane — non-Superstore bindTemplate field_mapping (W1)', () => {
  it('binds a healthcare bar end-to-end using the fixture datasource name', async () => {
    const res = await bindTemplate({
      ask: 'bar chart of Paid Amount by Payer',
      workbookXml: HEALTHCARE_CLAIMS_WORKBOOK_XML,
      manifests,
    });

    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('ranking-ordered-bar');
      expect(res.args.template_parameters.DATASOURCE).toBe('HealthcareClaimsDS');
      expect(res.args.field_mapping).toEqual({
        Region: '[HealthcareClaimsDS].[none:Payer:nk]',
        Sales: '[HealthcareClaimsDS].[sum:Paid Amount:qk]',
      });
      expect(JSON.stringify(res.args.field_mapping)).not.toContain('Superstore');
    }
  });

  it('field_mapping never contains Superstore for any portability-lane fixture', async () => {
    const cases = [
      {
        ask: 'bar chart of MRR by Account Segment',
        workbookXml: SAAS_OPS_WORKBOOK_XML,
        datasource: 'SaaSOpsDS',
      },
      {
        ask: 'bar chart of Paid Amount by Payer',
        workbookXml: HEALTHCARE_CLAIMS_WORKBOOK_XML,
        datasource: 'HealthcareClaimsDS',
      },
      {
        ask: 'trend of Actual Amount over time',
        workbookXml: FINANCE_PLANNING_WORKBOOK_XML,
        datasource: 'FinancePlanningDS',
      },
    ];

    for (const c of cases) {
      const res = await bindTemplate({ ask: c.ask, workbookXml: c.workbookXml, manifests });
      expect(res.status, `expected bound for ${c.datasource}`).toBe('bound');
      if (res.status !== 'bound') continue;
      expect(res.args.template_parameters.DATASOURCE).toBe(c.datasource);
      expect(JSON.stringify(res.args.field_mapping)).not.toContain('Superstore');
    }
  });
});

describe('portability-lane — geo semantic-role picks (W2, the Territory-class bind)', () => {
  // Before W2 both asks returned null: token affinity cannot see that "Territory" is a
  // state-level field. Tableau's semantic-role tag can — and now does, because the metadata
  // read path plumbs @_semantic-role into SchemaField.semanticRole.
  it('Territory tagged [State].[Name] binds the choropleth state slot by semantic role', () => {
    const s = summarizeSchema(SAAS_OPS_WORKBOOK_XML);
    const cls = classifyNoLlm('map of MRR by Territory', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('spatial-choropleth-map');
    const byId = Object.fromEntries(cls!.bindings.map((b) => [b.slot_id, b.field]));
    expect(byId.state).toBe('Territory');
    expect(byId.country).toBe('Country');
  });

  it('a Country map ask auto-completes the state slot with the semantic-role state field', () => {
    const s = summarizeSchema(SAAS_OPS_WORKBOOK_XML);
    const cls = classifyNoLlm('map of MRR by Country', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('spatial-choropleth-map');
    const byId = Object.fromEntries(cls!.bindings.map((b) => [b.slot_id, b.field]));
    expect(byId.country).toBe('Country');
    expect(byId.state).toBe('Territory');
  });

  it('the Territory map binds end-to-end (used_llm=false, non-Superstore datasource)', async () => {
    const res = await bindTemplate({
      ask: 'map of MRR by Territory',
      workbookXml: SAAS_OPS_WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('spatial-choropleth-map');
      expect(res.args.template_parameters.DATASOURCE).toBe('SaaSOpsDS');
      expect(JSON.stringify(res.args.field_mapping)).not.toContain('Superstore');
    }
  });
});

describe('portability-lane — histogram bin-width refusal (W3)', () => {
  it('the real distribution-histogram manifest is NOT fast-path eligible (bin width is dataset-specific)', () => {
    const m = manifests.get('distribution-histogram');
    expect(m).toBeDefined();
    expect(m!.fast_path_eligible).toBe(false);
    expect(m!.fast_path_blockers).toContain('DATASET_SPECIFIC_FORMULA');
  });

  it('Call 1: a Denial Rate histogram falls through to propose — never a default-width bind', async () => {
    const res = await bindTemplate({
      ask: 'histogram of Denial Rate',
      workbookXml: HEALTHCARE_CLAIMS_WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('propose');
  });

  it('Call 2: an explicit Denial Rate histogram proposal escalates with DATASET_SPECIFIC_FORMULA', async () => {
    const proposal: BindingProposal = {
      template: 'distribution-histogram',
      title: 'Distribution of Denial Rate',
      bindings: [{ slot_id: 'measure', field: 'Denial Rate' }],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'histogram of Denial Rate',
      workbookXml: HEALTHCARE_CLAIMS_WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('escalate');
    if (res.status === 'escalate') {
      expect(res.blockers.some((b) => b.code === 'DATASET_SPECIFIC_FORMULA')).toBe(true);
    }
  });

  it('even forced eligible, a histogram bind never emits a Superstore-derived 500 default width', async () => {
    // tmcp never ported a2td's deriveHistogramBinWidth adapter, so there is no code path
    // that could inject the old Superstore-derived 500; the template width stays an
    // unsubstituted placeholder for a data-aware retune. This locks that absence.
    const proposal: BindingProposal = {
      template: 'distribution-histogram',
      title: 'Distribution of Denial Rate',
      bindings: [{ slot_id: 'measure', field: 'Denial Rate' }],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'histogram of Denial Rate',
      workbookXml: HEALTHCARE_CLAIMS_WORKBOOK_XML,
      manifests: withForcedEligible(['distribution-histogram']),
      proposal,
    });
    if (res.status === 'bound') {
      expect(JSON.stringify(res.args)).not.toContain('500');
    }
  });
});

describe('portability-lane — under-specified scatter proposes with only bindable slots', () => {
  it('healthcare scatter with too few fields → propose payload exposes the PROPOSAL_OUTPUT_SCHEMA', async () => {
    const res = await bindTemplate({
      ask: 'scatter of Paid Amount vs Allowed Amount',
      workbookXml: HEALTHCARE_CLAIMS_WORKBOOK_XML,
      manifests: withForcedEligible(['correlation-scatter-plot-chart']),
    });
    expect(res.status).toBe('propose');
    if (res.status === 'propose') {
      expect(res.output_schema).toBe(PROPOSAL_OUTPUT_SCHEMA);
      expect(res.llm_input.fields.some((f) => f.name === 'Paid Amount')).toBe(true);
      expect(res.llm_input.fields.some((f) => f.name === 'Payer')).toBe(true);
    }
  });
});
