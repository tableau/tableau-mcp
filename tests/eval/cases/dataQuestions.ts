/**
 * Data questions with known answers on the `tableauagent1` eval site (test-dataplane1).
 *
 * Shared by:
 * - `../dataQuestionsOracle.test.ts`: runs each turn's `oracle` query through `query-datasource`,
 *   with no model, and checks that `expected.numbers` are still what the data says.
 * - `../dataQuestions.test.ts`: pass/fail evals of the plain and Tableau Agent paths.
 * - `../cabuAb.test.ts`: the A/B measurement run.
 *
 * Rules for adding cases:
 * - Every expected number must come from the turn's `oracle`. Use `EVAL_WRITE_EXPECTED=true` with
 *   the oracle test to print the values.
 * - Prompts name content the way a user would: the data source and project by name, never by
 *   LUID. The site has 8 data sources named "Sample - Superstore", so the project tells them apart.
 * - Avoid relative dates ("last year"); the data spans fixed years.
 * - Avoid top-N questions over fields with a null bucket (Medicare Speciality, Gender, Patient
 *   State), and the "Kaiser" / "Kaiser Permanente" payer pair, unless the question makes the
 *   intended reading unambiguous.
 * - No questions that need dashboard or filter context. These conversations only have a data source.
 */

export type ExpectedAnswer = {
  /**
   * Values that must all appear in the final answer (within `tolerance`). Graded without an LLM.
   * Order does not matter.
   */
  numbers?: Array<number>;
  /** Relative tolerance for `numbers`. Defaults to 0.005 (0.5%), enough for "$739.8K"-style rounding. */
  tolerance?: number;
  /**
   * A reference answer for the LLM judge. Used when there are no `numbers`, or as the fallback
   * when the numeric check fails (e.g. a loss written as "a loss of $25.7K" instead of "-25,729").
   */
  reference?: string;
};

/** A VizQL Data Service query whose result contains every number in `expected.numbers`. */
export type OracleQuery = {
  fields: Array<Record<string, unknown>>;
  filters?: Array<Record<string, unknown>>;
};

export type AbTurn = {
  question: string;
  expected: ExpectedAnswer;
  /** Required for `DATA_QUESTION_CASES`; imported suites may only have reference answers. */
  oracle?: OracleQuery;
};

export type CaseTag =
  | 'aggregate'
  | 'breakdown'
  | 'topN'
  | 'filter'
  | 'date'
  | 'ratio'
  | 'count'
  | 'multiturn'
  | 'fiscal'
  | 'hierarchy'
  | 'edgecase'
  | 'outOfScope';

export type AbCase = {
  id: string;
  /** Named in the first turn's prompt. */
  datasourceName: string;
  /** The data source's project, named in the first turn's prompt to tell same-named copies apart. */
  projectName?: string;
  /** Not in the prompt: the model must find it, and the eval checks it picked this one. */
  datasourceLuid: string;
  /** Same-named copies of the data source that also count as the right choice. */
  altDatasourceLuids?: Array<string>;
  /** A view of a workbook built on the data source, named in the first turn's prompt. */
  viewName?: string;
  /** The workbook containing `viewName`. Not in the prompt; the eval checks the model found it. */
  workbookLuid?: string;
  tags: Array<CaseTag>;
  /** Smoke cases run by default in `dataQuestions.test.ts`; the rest need EVAL_DATA_CASES. */
  smoke?: boolean;
  turns: Array<AbTurn>;
};

const SUPERSTORE = {
  datasourceName: 'Sample - Superstore',
  // This copy has Region and answers through Tableau Agent.
  projectName: 'ACE AI Applications',
  datasourceLuid: '434405df-0708-4505-9eac-a678f87a893c',
};

const MEDICARE = {
  datasourceName: 'Medicare-Claims',
  projectName: 'Datasets',
  datasourceLuid: '799ac010-28d7-4436-b36f-8ecdef9a7312',
};

const sum = (fieldCaption: string): Record<string, unknown> => ({
  fieldCaption,
  function: 'SUM',
  maxDecimalPlaces: 2,
});
const countd = (fieldCaption: string): Record<string, unknown> => ({
  fieldCaption,
  function: 'COUNTD',
});
const dim = (fieldCaption: string): Record<string, unknown> => ({ fieldCaption });
const year = (fieldCaption: string): Record<string, unknown> => ({
  fieldCaption,
  function: 'YEAR',
});
const calc = (fieldCaption: string, calculation: string): Record<string, unknown> => ({
  fieldCaption,
  calculation,
  maxDecimalPlaces: 2,
});
const inSet = (fieldCaption: string, values: Array<string>): Record<string, unknown> => ({
  field: { fieldCaption },
  filterType: 'SET',
  values,
  context: true,
});
const top = (fieldCaption: string, howMany: number, measure: string): Record<string, unknown> => ({
  field: { fieldCaption },
  filterType: 'TOP',
  howMany,
  direction: 'TOP',
  fieldToMeasure: { fieldCaption: measure, function: 'SUM' },
});

// ---- Superstore oracles, reused across cases ----

const SS_BY_REGION: OracleQuery = { fields: [dim('Region'), sum('Sales'), sum('Profit')] };
const SS_BY_CATEGORY: OracleQuery = { fields: [dim('Category'), sum('Sales'), sum('Profit')] };
const SS_BY_REGION_CATEGORY: OracleQuery = {
  fields: [dim('Region'), dim('Category'), sum('Sales'), sum('Profit')],
};
const SS_BY_SEGMENT: OracleQuery = {
  fields: [dim('Segment'), sum('Sales'), countd('Customer ID')],
};
const SS_BY_YEAR: OracleQuery = {
  fields: [year('Order Date'), sum('Sales'), countd('Order ID')],
};
const SS_TOP5_STATES: OracleQuery = {
  fields: [dim('State/Province'), sum('Sales'), sum('Profit')],
  filters: [top('State/Province', 5, 'Sales')],
};

// ---- Medicare oracles, reused across cases ----

const MC_TOTALS: OracleQuery = {
  fields: [sum('Paid Amt'), sum('Charge Amt'), countd('Patient ID')],
};
const MC_BY_PAYER: OracleQuery = { fields: [dim('Payer'), sum('Paid Amt'), countd('Patient ID')] };
const MC_BY_YEAR: OracleQuery = { fields: [year('Service Date'), sum('Paid Amt')] };
const MC_CARDIOLOGY: OracleQuery = {
  fields: [sum('Paid Amt'), countd('Patient ID')],
  filters: [inSet('Speciality', ['CARDIOLOGY'])],
};
const MC_CARDIOLOGY_BY_STATE: OracleQuery = {
  fields: [dim('Patient State'), sum('Paid Amt')],
  filters: [inSet('Speciality', ['CARDIOLOGY'])],
};
const MC_CARDIOLOGY_WI_SHARE: OracleQuery = {
  fields: [
    calc(
      'Cardiology WI Share',
      "SUM(IF [Speciality] = 'CARDIOLOGY' AND [Patient State] = 'WI' THEN [Paid Amt] END) / SUM(IF [Speciality] = 'CARDIOLOGY' THEN [Paid Amt] END) * 100",
    ),
  ],
};
const MC_TOP3_POS: OracleQuery = {
  fields: [dim('POS Description'), sum('Paid Amt')],
  filters: [top('POS Description', 3, 'Paid Amt')],
};
const MC_CIGNA_BY_YEAR: OracleQuery = {
  fields: [year('Service Date'), sum('Paid Amt')],
  filters: [inSet('Payer', ['Cigna'])],
};

const SALES_BY_REGION = [739813.61, 691828.17, 503170.67, 391721.91];
const WEST_SALES_BY_CATEGORY = [260679.73, 252766.99, 226366.89];
const SALES_BY_CATEGORY = [839893.28, 754747.76, 731893.31];
const TOP5_STATE_SALES = [457687.63, 310876.27, 170188.05, 138641.27, 116511.91];
const SALES_BY_SEGMENT = [1170659.79, 715806.13, 440068.43];
const CUSTOMERS_BY_SEGMENT = [416, 239, 149];
const PAID_BY_PAYER = [
  15710363.18, 13633764.72, 9424678.75, 8075427.95, 7981607.94, 7109685.83, 6666315.94, 4731428.03,
];
const PAID_BY_YEAR = [370310.52, 30850314.71, 37649913.35, 4462733.76];

const SUPERSTORE_CASES: Array<AbCase> = [
  {
    id: 'ss-sales-by-region',
    ...SUPERSTORE,
    tags: ['breakdown'],
    smoke: true,
    turns: [
      {
        question: 'What were the total sales by region?',
        expected: {
          numbers: SALES_BY_REGION,
          reference: 'West $739,813.61; East $691,828.17; Central $503,170.67; South $391,721.91.',
        },
        oracle: SS_BY_REGION,
      },
    ],
  },
  {
    id: 'ss-top-region',
    ...SUPERSTORE,
    tags: ['topN'],
    turns: [
      {
        question: 'Which region had the highest total sales, and how much?',
        expected: { numbers: [739813.61], reference: 'West, with $739,813.61 in sales.' },
        oracle: SS_BY_REGION,
      },
    ],
  },
  {
    id: 'ss-profit-by-category',
    ...SUPERSTORE,
    tags: ['breakdown'],
    turns: [
      {
        question: 'What was the total profit for each product category?',
        expected: {
          numbers: [146543.38, 19730, 126023.44],
          reference: 'Technology $146,543.38; Office Supplies $126,023.44; Furniture $19,730.00.',
        },
        oracle: SS_BY_CATEGORY,
      },
    ],
  },
  {
    id: 'ss-least-profitable-category',
    ...SUPERSTORE,
    tags: ['topN'],
    turns: [
      {
        question: 'Which product category had the lowest total profit, and what was it?',
        expected: { numbers: [19730], reference: 'Furniture, with $19,730.00 in profit.' },
        oracle: SS_BY_CATEGORY,
      },
    ],
  },
  {
    id: 'ss-total-profit-ratio',
    ...SUPERSTORE,
    tags: ['aggregate', 'ratio'],
    turns: [
      {
        question: 'What were total sales, total profit, and the overall profit ratio?',
        expected: {
          numbers: [2326534.35, 292296.81, 12.56],
          reference: 'Sales $2,326,534.35; profit $292,296.81; profit ratio about 12.56%.',
        },
        oracle: {
          fields: [
            sum('Sales'),
            sum('Profit'),
            calc('Profit Ratio %', 'SUM([Profit]) / SUM([Sales]) * 100'),
          ],
        },
      },
    ],
  },
  {
    id: 'ss-sales-by-segment',
    ...SUPERSTORE,
    tags: ['breakdown'],
    turns: [
      {
        question: 'What were total sales by customer segment?',
        expected: {
          numbers: SALES_BY_SEGMENT,
          reference: 'Consumer $1,170,659.79; Corporate $715,806.13; Home Office $440,068.43.',
        },
        oracle: SS_BY_SEGMENT,
      },
    ],
  },
  {
    id: 'ss-customers-by-segment',
    ...SUPERSTORE,
    tags: ['breakdown', 'count'],
    turns: [
      {
        question: 'How many distinct customers are in each customer segment?',
        expected: {
          numbers: CUSTOMERS_BY_SEGMENT,
          reference: 'Consumer 416; Corporate 239; Home Office 149.',
        },
        oracle: SS_BY_SEGMENT,
      },
    ],
  },
  {
    id: 'ss-sales-2026',
    ...SUPERSTORE,
    tags: ['aggregate', 'date'],
    turns: [
      {
        question: 'What were total sales for orders placed in calendar year 2026?',
        expected: { numbers: [745567.53], reference: '$745,567.53.' },
        oracle: SS_BY_YEAR,
      },
    ],
  },
  {
    id: 'ss-orders-by-year',
    ...SUPERSTORE,
    tags: ['breakdown', 'date', 'count'],
    turns: [
      {
        question: 'How many distinct orders were placed in each year, by order date?',
        expected: {
          numbers: [995, 1053, 1340, 1723],
          reference: '2023: 995; 2024: 1,053; 2025: 1,340; 2026: 1,723.',
        },
        oracle: SS_BY_YEAR,
      },
    ],
  },
  {
    id: 'ss-top5-states',
    ...SUPERSTORE,
    tags: ['topN'],
    turns: [
      {
        question: 'What are the top 5 states by total sales, with their sales?',
        expected: {
          numbers: TOP5_STATE_SALES,
          reference:
            'California $457,687.63; New York $310,876.27; Texas $170,188.05; Washington $138,641.27; Pennsylvania $116,511.91.',
        },
        oracle: SS_TOP5_STATES,
      },
    ],
  },
  {
    id: 'ss-texas-profit',
    ...SUPERSTORE,
    tags: ['aggregate', 'filter'],
    turns: [
      {
        question: 'What was the total profit in Texas?',
        expected: {
          numbers: [-25729.36],
          reference: 'A loss: total profit in Texas was -$25,729.36.',
        },
        oracle: {
          fields: [dim('State/Province'), sum('Profit')],
          filters: [inSet('State/Province', ['Texas'])],
        },
      },
    ],
  },
  {
    id: 'ss-unprofitable-subcategories',
    ...SUPERSTORE,
    tags: ['filter', 'breakdown'],
    turns: [
      {
        question: 'Which sub-categories had negative total profit, and how much did each lose?',
        expected: {
          numbers: [-17753.21, -3632.07, -1171.39],
          reference:
            'Tables (-$17,753.21), Bookcases (-$3,632.07), and Supplies (-$1,171.39). No other sub-category lost money.',
        },
        oracle: { fields: [dim('Sub-Category'), sum('Profit')] },
      },
    ],
  },
  {
    id: 'ss-top3-customers',
    ...SUPERSTORE,
    tags: ['topN'],
    turns: [
      {
        question: 'Who are the top 3 customers by total sales, and how much did each buy?',
        expected: {
          numbers: [25043.05, 19052.22, 15117.34],
          reference: 'Sean Miller $25,043.05; Tamara Chand $19,052.22; Raymond Buch $15,117.34.',
        },
        oracle: {
          fields: [dim('Customer Name'), sum('Sales')],
          filters: [top('Customer Name', 3, 'Sales')],
        },
      },
    ],
  },
  {
    id: 'ss-most-used-ship-mode',
    ...SUPERSTORE,
    tags: ['topN', 'count'],
    turns: [
      {
        question: 'Which ship mode was used for the most distinct orders, and how many orders?',
        expected: { numbers: [3068], reference: 'Standard Class, with 3,068 orders.' },
        oracle: { fields: [dim('Ship Mode'), countd('Order ID')] },
      },
    ],
  },
  {
    id: 'ss-same-day-sales',
    ...SUPERSTORE,
    tags: ['aggregate', 'filter'],
    turns: [
      {
        question: 'What were total sales for orders shipped Same Day?',
        expected: { numbers: [129271.95], reference: '$129,271.95.' },
        oracle: {
          fields: [dim('Ship Mode'), sum('Sales')],
          filters: [inSet('Ship Mode', ['Same Day'])],
        },
      },
    ],
  },
  {
    id: 'ss-west-furniture-sales',
    ...SUPERSTORE,
    tags: ['aggregate', 'filter'],
    turns: [
      {
        question: 'What were total Furniture sales in the West region?',
        expected: { numbers: [260679.73], reference: '$260,679.73.' },
        oracle: SS_BY_REGION_CATEGORY,
      },
    ],
  },
  {
    id: 'ss-east-technology-profit',
    ...SUPERSTORE,
    tags: ['aggregate', 'filter'],
    turns: [
      {
        question: 'What was the total profit for Technology in the East region?',
        expected: { numbers: [48441.78], reference: '$48,441.78.' },
        oracle: SS_BY_REGION_CATEGORY,
      },
    ],
  },
  {
    id: 'ss-central-furniture-profit',
    ...SUPERSTORE,
    tags: ['aggregate', 'filter'],
    turns: [
      {
        question: 'What was the total profit for Furniture in the Central region?',
        expected: { numbers: [-2802.21], reference: 'A loss of $2,802.21 (-$2,802.21).' },
        oracle: SS_BY_REGION_CATEGORY,
      },
    ],
  },
  {
    id: 'ss-mt-region-then-west-category',
    ...SUPERSTORE,
    tags: ['multiturn', 'breakdown', 'filter'],
    smoke: true,
    turns: [
      {
        question: 'What were the total sales by region?',
        expected: {
          numbers: SALES_BY_REGION,
          reference: 'West $739,813.61; East $691,828.17; Central $503,170.67; South $391,721.91.',
        },
        oracle: SS_BY_REGION,
      },
      {
        question: 'Now break that down by category, just for the West region.',
        expected: {
          numbers: WEST_SALES_BY_CATEGORY,
          reference: 'Furniture $260,679.73; Technology $252,766.99; Office Supplies $226,366.89.',
        },
        oracle: SS_BY_REGION_CATEGORY,
      },
    ],
  },
  {
    id: 'ss-mt-category-then-technology-years',
    ...SUPERSTORE,
    tags: ['multiturn', 'breakdown', 'date'],
    turns: [
      {
        question: 'What were total sales by product category?',
        expected: {
          numbers: SALES_BY_CATEGORY,
          reference: 'Technology $839,893.28; Furniture $754,747.76; Office Supplies $731,893.31.',
        },
        oracle: SS_BY_CATEGORY,
      },
      {
        question: 'How did Technology sales change from 2025 to 2026?',
        expected: {
          numbers: [226580.16, 272419.17],
          reference: 'From $226,580.16 in 2025 to $272,419.17 in 2026, up about 20%.',
        },
        oracle: {
          fields: [year('Order Date'), sum('Sales')],
          filters: [inSet('Category', ['Technology'])],
        },
      },
    ],
  },
  {
    id: 'ss-mt-top-states-then-losses',
    ...SUPERSTORE,
    tags: ['multiturn', 'topN', 'filter'],
    turns: [
      {
        question: 'What are the top 5 states by total sales?',
        expected: {
          numbers: TOP5_STATE_SALES,
          reference:
            'California $457,687.63; New York $310,876.27; Texas $170,188.05; Washington $138,641.27; Pennsylvania $116,511.91.',
        },
        oracle: SS_TOP5_STATES,
      },
      {
        question: 'Which of those states had negative total profit, and how much?',
        expected: {
          numbers: [-25729.36, -15559.96],
          reference: 'Texas (-$25,729.36) and Pennsylvania (-$15,559.96).',
        },
        oracle: SS_TOP5_STATES,
      },
    ],
  },
  {
    id: 'ss-mt-segment-then-customers',
    ...SUPERSTORE,
    tags: ['multiturn', 'breakdown', 'count'],
    turns: [
      {
        question: 'What were total sales by customer segment?',
        expected: {
          numbers: SALES_BY_SEGMENT,
          reference: 'Consumer $1,170,659.79; Corporate $715,806.13; Home Office $440,068.43.',
        },
        oracle: SS_BY_SEGMENT,
      },
      {
        question: 'How many distinct customers are in each of those segments?',
        expected: {
          numbers: CUSTOMERS_BY_SEGMENT,
          reference: 'Consumer 416; Corporate 239; Home Office 149.',
        },
        oracle: SS_BY_SEGMENT,
      },
    ],
  },
];

const MEDICARE_CASES: Array<AbCase> = [
  {
    id: 'mc-total-paid',
    ...MEDICARE,
    tags: ['aggregate'],
    turns: [
      {
        question: 'What is the total paid amount across all claims?',
        expected: { numbers: [73333272.34], reference: '$73,333,272.34.' },
        oracle: MC_TOTALS,
      },
    ],
  },
  {
    id: 'mc-charge-and-paid',
    ...MEDICARE,
    tags: ['aggregate'],
    turns: [
      {
        question: 'What are the total charge amount and the total paid amount?',
        expected: {
          numbers: [193389055.02, 73333272.34],
          reference: 'Charged $193,389,055.02; paid $73,333,272.34.',
        },
        oracle: MC_TOTALS,
      },
    ],
  },
  {
    id: 'mc-paid-pct-of-charge',
    ...MEDICARE,
    tags: ['ratio'],
    turns: [
      {
        question: 'What percentage of the total charge amount was actually paid?',
        expected: { numbers: [37.92], reference: 'About 37.92%.' },
        oracle: {
          fields: [calc('Paid Pct of Charge', 'SUM([Paid Amt]) / SUM([Charge Amt]) * 100')],
        },
      },
    ],
  },
  {
    id: 'mc-distinct-patients',
    ...MEDICARE,
    tags: ['count'],
    turns: [
      {
        question: 'How many distinct patients are in the data?',
        expected: { numbers: [5427], reference: '5,427 distinct patients.' },
        oracle: MC_TOTALS,
      },
    ],
  },
  {
    id: 'mc-cardiology-paid',
    ...MEDICARE,
    tags: ['aggregate', 'filter'],
    smoke: true,
    turns: [
      {
        question: 'What was the total paid to Cardiology providers?',
        expected: { numbers: [439939.21], reference: '$439,939.21.' },
        oracle: MC_CARDIOLOGY,
      },
    ],
  },
  {
    id: 'mc-cardiology-patients',
    ...MEDICARE,
    tags: ['count', 'filter'],
    turns: [
      {
        question: 'How many distinct patients had claims with Cardiology providers?',
        expected: { numbers: [339], reference: '339 patients.' },
        oracle: MC_CARDIOLOGY,
      },
    ],
  },
  {
    id: 'mc-internal-medicine-paid',
    ...MEDICARE,
    tags: ['aggregate', 'filter'],
    turns: [
      {
        question: 'What was the total paid to Internal Medicine providers?',
        expected: { numbers: [4141463.3], reference: '$4,141,463.30.' },
        oracle: {
          fields: [sum('Paid Amt')],
          filters: [inSet('Speciality', ['INTERNAL MEDICINE'])],
        },
      },
    ],
  },
  {
    id: 'mc-paid-by-payer',
    ...MEDICARE,
    tags: ['breakdown'],
    turns: [
      {
        question: 'What was the total paid amount for each payer?',
        expected: {
          numbers: PAID_BY_PAYER,
          reference:
            'Cigna $15,710,363.18; Anthem Inc. $13,633,764.72; Kaiser $9,424,678.75; Mayo $8,075,427.95; UnitedHealth Group $7,981,607.94; Blue Cross Blue Shield $7,109,685.83; Humana $6,666,315.94; Kaiser Permanente $4,731,428.03.',
        },
        oracle: MC_BY_PAYER,
      },
    ],
  },
  {
    id: 'mc-top-payer',
    ...MEDICARE,
    tags: ['topN'],
    turns: [
      {
        question: 'Which payer paid the most in total, and how much?',
        expected: { numbers: [15710363.18], reference: 'Cigna, with $15,710,363.18.' },
        oracle: MC_BY_PAYER,
      },
    ],
  },
  {
    id: 'mc-anthem-patients',
    ...MEDICARE,
    tags: ['count', 'filter'],
    turns: [
      {
        question: 'How many distinct patients have claims paid by Anthem Inc.?',
        expected: { numbers: [1074], reference: '1,074 patients.' },
        oracle: MC_BY_PAYER,
      },
    ],
  },
  {
    id: 'mc-paid-female-vs-male',
    ...MEDICARE,
    tags: ['breakdown', 'filter'],
    turns: [
      {
        question: 'What was the total paid for female patients versus male patients?',
        expected: {
          numbers: [37171966.31, 30058020.46],
          reference: 'Female $37,171,966.31; male $30,058,020.46.',
        },
        oracle: { fields: [dim('Gender'), sum('Paid Amt')] },
      },
    ],
  },
  {
    id: 'mc-paid-2025',
    ...MEDICARE,
    tags: ['aggregate', 'date'],
    turns: [
      {
        question: 'What was the total paid amount for services in calendar year 2025?',
        expected: { numbers: [37649913.35], reference: '$37,649,913.35.' },
        oracle: MC_BY_YEAR,
      },
    ],
  },
  {
    id: 'mc-paid-by-year',
    ...MEDICARE,
    tags: ['breakdown', 'date'],
    turns: [
      {
        question: 'What was the total paid amount for each year of service date?',
        expected: {
          numbers: PAID_BY_YEAR,
          reference:
            '2023 $370,310.52; 2024 $30,850,314.71; 2025 $37,649,913.35; 2026 $4,462,733.76.',
        },
        oracle: MC_BY_YEAR,
      },
    ],
  },
  {
    id: 'mc-top-place-of-service',
    ...MEDICARE,
    tags: ['topN'],
    turns: [
      {
        question:
          'Which place of service (POS Description) had the highest total paid, and how much?',
        expected: { numbers: [28237060.74], reference: 'Inpatient Hospital, with $28,237,060.74.' },
        oracle: MC_TOP3_POS,
      },
    ],
  },
  {
    id: 'mc-inpatient-vs-outpatient',
    ...MEDICARE,
    tags: ['breakdown', 'filter'],
    turns: [
      {
        question:
          'Compare the total paid for inpatient hospital versus outpatient hospital services.',
        expected: {
          numbers: [28237060.74, 25979723.77],
          reference: 'Inpatient hospital $28,237,060.74; outpatient hospital $25,979,723.77.',
        },
        oracle: MC_TOP3_POS,
      },
    ],
  },
  {
    id: 'mc-wi-paid',
    ...MEDICARE,
    tags: ['aggregate', 'filter'],
    turns: [
      {
        question: 'What was the total paid for patients whose Patient State is WI?',
        expected: { numbers: [25849964.18], reference: '$25,849,964.18.' },
        oracle: {
          fields: [sum('Paid Amt')],
          filters: [inSet('Patient State', ['WI'])],
        },
      },
    ],
  },
  {
    id: 'mc-cigna-2025',
    ...MEDICARE,
    tags: ['aggregate', 'filter', 'date'],
    turns: [
      {
        question: 'How much did Cigna pay for services in calendar year 2025?',
        expected: { numbers: [6863093.43], reference: '$6,863,093.43.' },
        oracle: MC_CIGNA_BY_YEAR,
      },
    ],
  },
  {
    id: 'mc-cardiology-wi-share',
    ...MEDICARE,
    tags: ['ratio', 'filter'],
    turns: [
      {
        question:
          'What percentage of the total paid to Cardiology providers was for patients whose Patient State is WI?',
        expected: { numbers: [70.17], reference: 'About 70.17% ($308,687.14 of $439,939.21).' },
        oracle: MC_CARDIOLOGY_WI_SHARE,
      },
    ],
  },
  {
    id: 'mc-mt-cardiology-state-share',
    ...MEDICARE,
    tags: ['multiturn', 'filter', 'topN', 'ratio'],
    smoke: true,
    turns: [
      {
        question: 'What was the total paid to Cardiology providers?',
        expected: { numbers: [439939.21], reference: '$439,939.21.' },
        oracle: MC_CARDIOLOGY,
      },
      {
        question: 'Which Patient State accounted for the most of that, and how much?',
        expected: { numbers: [308687.14], reference: 'WI, with $308,687.14.' },
        oracle: MC_CARDIOLOGY_BY_STATE,
      },
      {
        question: 'What percentage of the Cardiology total is that?',
        expected: { numbers: [70.17], reference: 'About 70.17%.' },
        oracle: MC_CARDIOLOGY_WI_SHARE,
      },
    ],
  },
  {
    id: 'mc-mt-top-payer-then-cardiology',
    ...MEDICARE,
    tags: ['multiturn', 'topN', 'filter'],
    turns: [
      {
        question: 'Which payer paid the most in total, and how much?',
        expected: { numbers: [15710363.18], reference: 'Cigna, with $15,710,363.18.' },
        oracle: MC_BY_PAYER,
      },
      {
        question: 'And which payer paid the most for Cardiology providers?',
        expected: { numbers: [138488.84], reference: 'Anthem Inc., with $138,488.84.' },
        oracle: {
          fields: [dim('Payer'), sum('Paid Amt')],
          filters: [inSet('Speciality', ['CARDIOLOGY'])],
        },
      },
    ],
  },
  {
    id: 'mc-mt-years-then-cigna',
    ...MEDICARE,
    tags: ['multiturn', 'date', 'filter'],
    turns: [
      {
        question: 'What was the total paid amount for each year of service date?',
        expected: {
          numbers: PAID_BY_YEAR,
          reference:
            '2023 $370,310.52; 2024 $30,850,314.71; 2025 $37,649,913.35; 2026 $4,462,733.76.',
        },
        oracle: MC_BY_YEAR,
      },
      {
        question: 'How much of the 2025 total was paid by Cigna?',
        expected: { numbers: [6863093.43], reference: '$6,863,093.43.' },
        oracle: MC_CIGNA_BY_YEAR,
      },
    ],
  },
  {
    id: 'mc-mt-gender-then-cigna-2025',
    ...MEDICARE,
    tags: ['multiturn', 'breakdown', 'filter', 'date'],
    turns: [
      {
        question: 'What was the total paid for female patients versus male patients?',
        expected: {
          numbers: [37171966.31, 30058020.46],
          reference: 'Female $37,171,966.31; male $30,058,020.46.',
        },
        oracle: { fields: [dim('Gender'), sum('Paid Amt')] },
      },
      {
        question: 'Now show the same comparison for just Cigna in calendar year 2025.',
        expected: {
          numbers: [3731117.44, 2822655.38],
          reference: 'Female $3,731,117.44; male $2,822,655.38.',
        },
        oracle: {
          fields: [dim('Gender'), year('Service Date'), sum('Paid Amt')],
          filters: [inSet('Payer', ['Cigna'])],
        },
      },
    ],
  },
];

export const DATA_QUESTION_CASES: Array<AbCase> = [...SUPERSTORE_CASES, ...MEDICARE_CASES];
