import type { AbCase } from './dataQuestions.js';

/**
 * Tableau Agent's gold eval suite (Dreamforce sales pipeline), from tua-gaia
 * `sfdc_supra/product_evals/tabcabu/pipelines/tabcabu/suites/cabu_gold_dreamforce.yml`.
 *
 * Lives on the `tabagent-tdp1-evals` site (test-dataplane1), not `tableauagent1`. Answers are the
 * suite's `ground_truth_answer`; there are no oracle queries, since the suite's reference queries
 * are SQL over a semantic view.
 *
 * Supra sends the workbook's business preferences (fiscal year starting 1 February, "closed" means
 * ACV, "pipe" means Open Pipe). Tableau Agent loads them from the workbook, so pass the workbook to
 * `cabu-start-conversation`. The plain path doesn't see them, so expect it to miss fiscal and
 * vocabulary questions.
 *
 * Generated from the YAML: `numbers` holds every decimal amount with a K/M/B suffix in the
 * reference answer. Integer amounts are left to the judge: in this suite they are mostly category
 * labels ("$10M+" deal band) or zero.
 */

const GOLD = {
  datasourceName: 'gold_run_the_business_enhanced (local copy) (local copy)',
  datasourceLuid: '7611e6c5-c0f9-4a6d-afc2-f6647923c2e9',
  workbookLuid: '5eafe9c6-89cc-410f-ac30-f0f6a6a0f23a',
};

// References round to 2–3 significant digits ("$1.41B"), so allow 1%.
const GOLD_TOLERANCE = 0.01;

export const GOLD_DREAMFORCE_CASES: Array<AbCase> = [
  {
    id: 'gold-a.1',
    ...GOLD,
    tags: ['topN'],
    smoke: true,
    turns: [
      {
        question: 'Who are the top 10 performing AEs?',
        expected: {
          numbers: [
            41860000, 21130000, 17460000, 16290000, 16190000, 15180000, 14140000, 14130000,
            13100000, 12930000,
          ],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top-performing Account Executives (AEs) ranked by their total ACV (Annual Contract Value):\nLex Harrington: $41.86M\nDan Lynch: $21.13M\nEmma Dalton: $17.46M\nSharna Waugh: $16.29M\nGrace Haynes: $16.19M\nMinh Mendis: $15.18M\nChloe Collyer: $14.14M\nRosanna Porter: $14.13M\nRoman Liu: $13.10M\nAdam Boxoen: $12.93M\nThese results are based on the top 10 AEs by total ACV, sorted from highest to lowest.',
        },
      },
    ],
  },
  {
    id: 'gold-a.2',
    ...GOLD,
    tags: ['hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much of the closed revenue is Tableau Next?',
        expected: {
          numbers: [160950],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The closed revenue for Tableau Next is 160.95K. This total was calculated by summing the ACV Annual Contract Value field, filtered specifically for the Tableau Next Platform product family.',
        },
      },
    ],
  },
  {
    id: 'gold-a.3',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'Show me total open pipe for Q4 FY2026',
        expected: {
          numbers: [3770000000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total open pipe for Q4 FY2026 is $3.77B. This represents the sum of all open opportunities in Q4 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.4',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'Show me total open pipe for FY2026',
        expected: {
          numbers: [4150000000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total open pipeline for the FY2026 is $4.15B. This represents the full sum of the Open Pipe OP field for FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.5',
    ...GOLD,
    tags: ['hierarchy', 'breakdown'],
    turns: [
      {
        question: 'Show me open pipe by product',
        expected: {
          numbers: [
            3810000000, 3130000000, 2570000000, 2360000000, 1210000000, 1120000000, 1060000000,
            1040000000, 595500000, 402330000,
          ],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here is the open pipeline (OP) by product, sorted from highest to lowest:\nService: $3.81B\nSales: $3.13B\nAI and Data: $2.57B\nOther: $2.36B\nMarketing: $1.21B\nIntegration: $1.12B\nSalesforce Platform: $1.06B\nAnalytics: $1.04B\nSlack: $595.50M\nCommerce: $402.33M\nThis data represents a total of 10 products with open pipeline values. Service leads with the highest open pipeline, while Commerce has the lowest.',
        },
      },
    ],
  },
  {
    id: 'gold-a.6',
    ...GOLD,
    tags: ['topN', 'breakdown', 'count'],
    turns: [
      {
        question: 'Show me open pipe by Account Owner, top 5 only',
        expected: {
          numbers: [47070000, 45140000, 33520000, 32900000, 32800000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top 5 open pipeline amounts by Account Owner:\nGhanshyam Goutzamanis: $47.07M\nTherese Proulx: $45.14M\nOliver Saddler: $33.52M\nNate Pienkowski: $32.90M\nKatie Bazina: $32.80M',
        },
      },
    ],
  },
  {
    id: 'gold-a.7',
    ...GOLD,
    tags: ['topN', 'breakdown'],
    turns: [
      {
        question: 'Show me top 5 reps by open pipe.',
        expected: {
          numbers: [47070000, 45140000, 33520000, 32900000, 32800000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top sales representatives by open pipeline amount:\nGhanshyam Goutzamanis with $47.07M\nTherese Proulx with $45.14M\nOliver Saddler with $33.52M\nNate Pienkowski with $32.90M\nKatie Bazina with $32.80M',
        },
      },
    ],
  },
  {
    id: 'gold-a.8',
    ...GOLD,
    tags: ['breakdown'],
    turns: [
      {
        question: 'Show me open pipe by stage',
        expected: {
          numbers: [
            11150000000, 2800000000, 2450000000, 714100000, 161270000, 12990000, 9240000, 42350,
            34510, 20540,
          ],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here is the open pipeline by stage, sorted by the total amount in USD:\n02 - Determining Problem, Impact, Ideal: $11.15B\n03 - Validating Benefits & Value: $2.80B\n04 - Confirming Value With Power: $2.45B\n05 - Negotiating $ & Mutual Plan: $714.10M\n06 - Finalizing Closure: $161.27M\n07 - Pending: $12.99M\n01 - Identifying an Opportunity: $9.24M\n03 - Initial Proposal: $42.35K\n08 - Closed: $34.51K\n02 Negotiate: $20.54K\nThe total row count is 10, and the largest pipeline stage is 02 - Determining Problem, Impact, Ideal, contributing over $11.15B.',
        },
      },
    ],
  },
  {
    id: 'gold-a.9',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    smoke: true,
    turns: [
      {
        question: 'How much ACV have we closed Q4 FY2026?',
        expected: {
          numbers: [122900000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total ACV (Annual Contract Value) closed in Q4 FY2026 is $122.9M. This represents the sum of all closed-won opportunities for Q4 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.10',
    ...GOLD,
    tags: ['hierarchy', 'breakdown'],
    turns: [
      {
        question: 'How much ACV did we close by product?',
        expected: {
          numbers: [
            1575000000, 1387000000, 1077000000, 805100000, 558800000, 541800000, 528400000,
            281000000, 122500000, -68990000,
          ],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here is the ACV closed by Product:\nService: $1.575B\nSales: $1.387B\nSalesforce Platform: $1.077B\nMarketing: $805.1M\nIntegration: $558.8M\nAnalytics: $541.8M\nAI and Data: $528.4M\nSlack: $281.0M\nCommerce: $122.5M\nOther: -$68.99M (negative ACV)\nKey Insights:\nService leads with the highest ACV at $1.575B, followed by Sales and Salesforce Platform.\nOther shows a negative ACV of -$68.99M, which may require further investigation.',
        },
      },
    ],
  },
  {
    id: 'gold-a.11',
    ...GOLD,
    tags: ['topN', 'breakdown', 'count'],
    turns: [
      {
        question: 'How much ACV by Account Owner? Show top 5 of them.',
        expected: {
          numbers: [41860000, 21130000, 17460000, 16290000, 16190000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are top 5 ACV by Account Owner:\nLex Harrington: $41.86M\nDan Lynch: $21.13M\nEmma Dalton: $17.46M\nSharna Waugh: $16.29M\nGrace Haynes: $16.19M',
        },
      },
    ],
  },
  {
    id: 'gold-a.12',
    ...GOLD,
    tags: ['topN', 'breakdown', 'count'],
    turns: [
      {
        question: 'Show me the top 5 accounts by ACV',
        expected: {
          numbers: [45940000, 22840000, 20860000, 19870000, 17980000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top 5 accounts by ACV:\nTechSky Innovation: $45.94M\nPeakSync Solutions: $22.84M\nAeroAxis Technologies: $20.86M.\nAzureFlow Solutions: $19.87M.\nPulsePlex Venture: $17.98M.',
        },
      },
    ],
  },
  {
    id: 'gold-a.13',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much ACV have we closed in fiscal year 2026?',
        expected: {
          numbers: [3270000000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total ACV (Annual Contract Value) closed in fiscal year 2026 is $3.27B. This value represents the sum of all closed opportunities for fiscal year 2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.14',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much ACV have we closed in Q3 FY2025?',
        expected: {
          numbers: [936790000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total ACV closed in Q3 FY2025 is $936.79M. This value was calculated by summing the ACV Annual Contract Value field for all opportunities within Q3 FY2025.',
        },
      },
    ],
  },
  {
    id: 'gold-a.15',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'breakdown'],
    turns: [
      {
        question: 'How much ACV did we close by Cloud in Q3 FY2025?',
        expected: {
          numbers: [
            222450000, 180600000, 146980000, 124390000, 79570000, 79830000, 54870000, 34070000,
            12870000, 1160000, 4020000,
          ],
          tolerance: GOLD_TOLERANCE,
          reference:
            'In Q3 FY2025, the ACV closed by Cloud is as follows:\nService: $222.45M\nSales: $180.60M\nSalesforce Platform: $146.98M\nMarketing: $124.39M\nIntegration: $79.57M\nAnalytics: $79.83M\nAI and Data: $54.87M\nSlack: $34.07M\nCommerce: $12.87M\nOther: $1.16M\nThe total ACV is distributed across 10 Cloud categories, with Service leading at $222.45M and Commerce contributing the least at $4.02M.',
        },
      },
    ],
  },
  {
    id: 'gold-a.16',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'breakdown'],
    turns: [
      {
        question: 'How much ACV did we close by Subcloud in Q3 FY2025?',
        expected: {
          numbers: [114680000, 104690000, 58740000, 49060000, 43870000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'We closed a total of $114.68M in ACV for Service Cloud & Industries, $104.69M for Sales Cloud & Industries, $58.74M for Developer Services, $49.06M for Engagement, and $43.87M for Data Cloud in Q3 FY2025. In total, ACV was closed across 45 Subclouds.',
        },
      },
    ],
  },
  {
    id: 'gold-a.17',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'breakdown'],
    turns: [
      {
        question: 'How much ACV did we close by Product Family in Q3 FY2025?',
        expected: {
          numbers: [936790000, 77310000, 73770000, 42170000, 34550000, 29120000],
          tolerance: GOLD_TOLERANCE,
          reference:
            "We closed a total of $936.79M ACV in Q3 FY2025 across all Product Families. Here's the breakdown by Product Family:\nSales Cloud: $77.31M\nService Cloud: $73.77M\nSandbox: $42.17M\nEngagement & Journeys: $34.55M\nAdditional Cores: $29.12M",
        },
      },
    ],
  },
  {
    id: 'gold-a.18',
    ...GOLD,
    tags: ['fiscal', 'breakdown'],
    turns: [
      {
        question: 'How much ACV did we close by Segment Q2 FY2026?',
        expected: {
          numbers: [447610000, 213320000, 109950000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here is the ACV closed by Segment Q2 FY2026:\nEnterprise: $447.61M\nCommercial: $213.32M\nESMB: $109.95M\nThe Enterprise segment contributed the highest ACV, followed by Commercial and ESMB.',
        },
      },
    ],
  },
  {
    id: 'gold-a.19',
    ...GOLD,
    tags: ['fiscal', 'breakdown'],
    turns: [
      {
        question: 'How much ACV did we close by Opportunity Cycle Type in Q2 FY2026?',
        expected: {
          numbers: [447090000, 292970000, 30830000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'In Q2 FY2026, the ACV closed by Opportunity Cycle Type is as follows:\nCreate & Close: $447.09M\nDay 1 Open Pipe: $292.97M\nPre-Book / Future-Dated Order: $30.83M\nThe data is sorted from the highest to the lowest ACV, with Day 1 Open Pipe contributing the most.',
        },
      },
    ],
  },
  {
    id: 'gold-a.20',
    ...GOLD,
    tags: ['fiscal', 'breakdown'],
    turns: [
      {
        question: 'How much ACV did we close by Deal Band in Q2 FY2026?',
        expected: {
          numbers: [247570000, 179450000, 110000000, 105770000, 76630000, 70640000, -19170000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'ACV closed by Deal Band in Q2 FY2026: Sub-$50K: $247.57M; $150K - $500K: $179.45M; $50K - $100K: $110.00M; $10M+: $105.77M; $500K - $1M: $76.63M; $100K - $150K: $70.64M; Negative ACV: -$19.17M.',
        },
      },
    ],
  },
  {
    id: 'gold-a.21',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much ACV have we closed for Other in Q2 FY2026?',
        expected: {
          numbers: [-4430000],
          tolerance: GOLD_TOLERANCE,
          reference: 'The total ACV closed for Other in Q2 FY2026 is -4.43M.',
        },
      },
    ],
  },
  {
    id: 'gold-a.22',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    smoke: true,
    turns: [
      {
        question: 'How much AI and Data ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [71190000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total AI and Data ACV closed in Q2 FY2026 is $71.19M. This value was calculated by summing the ACV Annual Contract Value field for all relevant opportunities in Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.23',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much ACV related to Commerce have we closed in Q2 FY2026?',
        expected: {
          numbers: [11380000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total ACV (Annual Contract Value) related to Commerce closed in Q2 FY2026 is $11.38M. This was calculated by summing the ACV for closed opportunities filtered specifically for Commerce within Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.24',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much Analytics ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [58050000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total Analytics ACV closed in Q2 FY2026 is $58.05M. This was calculated by summing the ACV for all opportunities with Analytics as the cloud, filtered for Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.25',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much Marketing ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [83530000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total Marketing ACV closed in Q2 FY2026 is $83.53M. This was calculated by summing the ACV Annual Contract Value field, filtered specifically for Marketing opportunities within Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.26',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much Heroku ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [5220000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'We have closed $5.22M in Heroku ACV in Q2 FY2026. This total was calculated by summing the ACV Annual Contract Value field for all opportunities related to Heroku that were closed in Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.27',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much ACV related to AI and data success plans have we closed in Q2 FY2026?',
        expected: {
          reference:
            "There has been no ACV closed in Q2 FY2026 related to AI and Data success plans. This means no opportunities meeting those specific criteria have been finalized during Q2 FY2026. Let me know if you'd like to explore a different time period or adjust the filters!",
        },
      },
    ],
  },
  {
    id: 'gold-a.28',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much Service Cloud & Industries ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [84160000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'We have closed 84.16M in Service Cloud Industries ACV in Q2 FY2026. This total is derived by summing the ACV Annual Contract Value field for all closed opportunities in Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.29',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'count', 'aggregate'],
    turns: [
      {
        question: 'How much ACV tied to Account Engagement have we closed in Q2 FY2026?',
        expected: {
          numbers: [8240000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total ACV tied to Account Engagement that has been closed in Q2 FY2026 is $8.24M. This value was calculated by summing the ACV Annual Contract Value field for all closed opportunities within the Account Engagement product family during Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.30',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much MuleSoft Legacy ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [23280000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total MuleSoft Legacy ACV closed in Q2 FY2026 is $23.28M. This was calculated by summing the ACV Annual Contract Value field for closed won deals within Q2 FY2026, filtered specifically for MuleSoft Legacy.',
        },
      },
    ],
  },
  {
    id: 'gold-a.31',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much ACV have we closed in Q2 FY2026 for Tableau Server Embedded Analytics?',
        expected: {
          numbers: [868860],
          tolerance: GOLD_TOLERANCE,
          reference:
            'We have closed 868.86K in ACV (Annual Contract Value) in Q2 FY2026 for Tableau Server Embedded Analytics This is the total sum of all opportunities meeting the criteria in the dataset.',
        },
      },
    ],
  },
  {
    id: 'gold-a.32',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question:
          'How much ACV have we closed in Q2 FY2026 specifically for Tableau Server Advanced Management?',
        expected: {
          numbers: [339360],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total ACV closed in Q2 FY2026 specifically for Tableau Server Advanced Management is 339.36K. This value was calculated by summing the ACV for opportunities filtered to Q2 FY2026 and the product family Tableau Server Advanced Management',
        },
      },
    ],
  },
  {
    id: 'gold-a.33',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much ACV have we closed in Q2 FY2026 for CME Cloud - Service?',
        expected: {
          numbers: [2450000],
          tolerance: GOLD_TOLERANCE,
          reference: 'The total ACV closed in Q2 FY2026 for CME Cloud - Service is 2.45M.',
        },
      },
    ],
  },
  {
    id: 'gold-a.34',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much ACV have we closed in Q2 FY2026 for Order Management for B2C Commerce?',
        expected: {
          numbers: [374780],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total ACV closed in Q2 FY2026 for Order Management for B2C Commerce is 374.78K. This was calculated by summing the ACV for all opportunities closed in Q2 FY2026 with the specified product family.',
        },
      },
    ],
  },
  {
    id: 'gold-a.35',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question:
          'How much ACV have we closed in Q2 FY2026 for Other - Signature Success - Salesforce Platform?',
        expected: {
          reference:
            'The total Other - Signature Success - Salesforce Platform ACV closed in Q2 FY2026 is $0.',
        },
      },
    ],
  },
  {
    id: 'gold-a.36',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much Enterprise ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [447610000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total Enterprise ACV closed in Q2 FY2026 is 447.61M. This value was calculated by summing the ACV for opportunities in the Enterprise segment in Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.37',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much Commercial ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [213320000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total Commercial ACV closed in Q2 FY2026 is 213.32M. This value was calculated by summing the ACV Annual Contract Value field for all opportunities in the Commercial segment that were closed in Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.38',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much ESMB ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [109950000],
          tolerance: GOLD_TOLERANCE,
          reference: 'The total SMB (ESMB) ACV closed in Q2 FY2026 is $109.95M.',
        },
      },
    ],
  },
  {
    id: 'gold-a.39',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much Create & Close ACV have we closed in Q2 FY2026?',
        expected: {
          numbers: [447090000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total Create & Close ACV closed in Q2 FY2026 is $447.09M. This value represents the sum of all ACV for Create & Close opportunities closed in Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.40',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much Day 1 Open Pipe have we closed in Q2 FY2026?',
        expected: {
          numbers: [292970000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'We have closed $292.97M in Day 1 Open Pipe in Q2 FY2026. This value represents the sum of ACV (Annual Contract Value) for all closed-won opportunities categorized as Day 1 Open Pipe within Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.41',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much Pre-Book ACV do we have in Q2 FY2026?',
        expected: {
          numbers: [30830000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'We have $30.83M in Pre-Book ACV in Q2 FY2026. This value represents the total ACV (Annual Contract Value) for all opportunities categorized as Pre-Book / Future-Dated Order within Q2 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.42',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: 'How much Pull Forward Open Pipe do we have in Q2 FY2026?',
        expected: {
          reference:
            'There is no Pull Forward Open Pipe recorded in Q2 FY2026. This means there are currently no opportunities marked as "Pull Forward" with an open pipe amount for the specified time period.',
        },
      },
    ],
  },
  {
    id: 'gold-a.43',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: "What's pipeline for third quarter in FY 2026?",
        expected: {
          numbers: [381550000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total pipeline for Q3 in FY2026 is $381.55M. This represents the sum of all open opportunities for Q3 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-a.44',
    ...GOLD,
    tags: ['fiscal', 'aggregate'],
    turns: [
      {
        question: "What's the pipe in Q3 FY2026?",
        expected: {
          numbers: [381550000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total pipeline in Q3 FY2026 is $381.55M. This represents the sum of all open opportunities in Q3 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-b.1',
    ...GOLD,
    tags: ['fiscal', 'breakdown'],
    turns: [
      {
        question: 'Show me open pipe by month in FY2026',
        expected: {
          numbers: [381550000, 1410000000, 750940000, 1610000000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the open pipe amounts by month in FY2026:\nOctober: $381.55M\nNovember: $1.41B\nDecember: $750.94M\nJanuary: $1.61B',
        },
      },
    ],
  },
  {
    id: 'gold-c.1',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question:
          'What is the performance of Analytics for Jennifer Lagaly in FY2026 third quarter? How does that compare to other clouds?',
        expected: {
          numbers: [690010, 6140000, 3900000, 3470000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Jennifer Lagaly has a sum of $690.01K for ACV third quarter of Fy2026 for Analytics cloud. Compared to some other clouds, Jennifer’s ACV for that fiscal quarter is as follows: $6.14M for Sales cloud, $3.90M for Salesforce platform, $3.47M for Service cloud.',
        },
      },
    ],
  },
  {
    id: 'gold-c.2',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'Which OU has the most Tableau Cloud open pipe in Q4 FY2026?',
        expected: {
          numbers: [43460000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here’s the OU with the most Tableau Cloud open pipeline in Q4 FY2026. The AMER REG Operating Unit (OU) has the most Tableau Cloud open pipeline in Q4 FY2026, with a total of 43.46M. This value was calculated by summing the Open Pipe field for all opportunities related to Tableau Cloud in Q4 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-d.1',
    ...GOLD,
    tags: ['fiscal', 'topN', 'breakdown', 'count'],
    turns: [
      {
        question: 'Show me top 3 open pipe by Account Owner by each quarter in FY2026',
        expected: {
          numbers: [44700000, 15270000, 4000000, 20000000, 18200000, 15580000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top 3 open pipeline amounts by Account Owner and quarter in FY2026:\nTherese Proulx: $44.70M in Q3 FY2026\nNutan Mcgill: $15.27M in Q3 FY2026\nTim Wong: $4.00M in Q3 FY2026\nPolly Yeung: $20.00M in Q4 FY2026\nPoppy Harris: $18.20M in Q4 FY2026\nAllegra Darshani: $15.58M in Q4 FY2026',
        },
      },
    ],
  },
  {
    id: 'gold-d.2',
    ...GOLD,
    tags: ['fiscal', 'topN', 'breakdown', 'count'],
    turns: [
      {
        question: 'Show me top open pipe by each Stage & Account Owner in FY 2026',
        expected: {
          numbers: [
            1000000, 44760000, 20540, 22350, 6600000, 18200000, 6590000, 15270000, 2580000, 34510,
          ],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top open pipeline amounts by Stage and Account Owner:\nDavydd Ho in stage 01 - Identifying an Opportunity with $1.00M.\nTherese Proulx in stage 02 - Determining Problem, Impact, Ideal with $44.76M.\nSamuel Hillsdon in stage 02 Negotiate with $20.54K.\nJarrod Thomas in stage 03 - Initial Proposal with $22.35K.\nMaddy Gilder in stage 03 - Validating Benefits & Value with $6.60M.\nPoppy Harris in stage 04 - Confirming Value With Power with $18.20M.\nLuke Ryan in stage 05 - Negotiating $$ & Mutual Plan with $6.59M.\nNutan Mcgill in stage 06 - Finalizing Closure with $15.27M.\nEmma Dalton in stage 07 - Pending with $2.58M.\nElias Lee in stage 08 - Closed with $34.51K.',
        },
      },
    ],
  },
  {
    id: 'gold-d.3',
    ...GOLD,
    tags: ['fiscal', 'breakdown', 'count'],
    turns: [
      {
        question:
          'Show me the Account Owner with the most open pipe amount by each Stage and quarter in FY2026',
        expected: {
          numbers: [
            28870, 44680000, 1010000, 3130000, 3380000, 15270000, 2580000, 34510, 1000000, 9110000,
            20540, 22350, 6600000, 18200000, 6590000, 3500000, 1760000,
          ],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top open pipeline data broken down by Stage, Account Owner, and quarter:\nStage: 01 - Identifying an Opportunity, Account Owner: Ella Maloney, Quarter: Q3 2026, Open Pipe Amount: $28.87K.\nStage: 02 - Determining Problem, Impact, Ideal, Account Owner: Therese Proulx, Quarter: Q3 2026, Open Pipe Amount: $44.68M.\nStage: 03 - Validating Benefits & Value, Account Owner: Mark Tippett, Quarter: Q3 2026, Open Pipe Amount: $1.01M.\nStage: 04 - Confirming Value With Power, Account Owner: Brendan Glymin, Quarter: Q3 2026, Open Pipe Amount: $3.13M.\nStage: 05 - Negotiating $$ & Mutual Plan, Account Owner: Will Bruford, Quarter: Q3 2026, Open Pipe Amount: $3.38M.\nStage: 06 - Finalizing Closure, Account Owner: Nutan Mcgill, Quarter: Q3 2026, Open Pipe Amount: $15.27M.\nStage: 07 - Pending, Account Owner: Emma Dalton, Quarter: Q3 2026, Open Pipe Amount: $2.58M.\nStage: 08 - Closed, Account Owner: Elias Lee, Quarter: Q3 2026, Open Pipe Amount: $34.51K.\nStage: 01 - Identifying an Opportunity, Account Owner: Davydd Ho, Quarter: Q4 2026, Open Pipe Amount: $1.00M.\nStage: 02 - Determining Problem, Impact, Ideal, Account Owner: Richard Oneill, Quarter: Q4 2026, Open Pipe Amount: $9.11M.\nStage: 02 Negotiate, Account Owner: Samuel Hillsdon, Quarter: Q4 2026, Open Pipe Amount: $20.54K.\nStage: 03 - Initial Proposal, Account Owner: Jarrod Thomas, Quarter: Q4 2026, Open Pipe Amount: $22.35K.\nStage: 03 - Validating Benefits & Value, Account Owner: Maddy Gilder, Quarter: Q4 2026, Open Pipe Amount: $6.60M.\nStage: 04 - Confirming Value With Power, Account Owner: Poppy Harris, Quarter: Q4 2026, Open Pipe Amount: $18.20M.\nStage: 05 - Negotiating $$ & Mutual Plan, Account Owner: Luke Ryan, Quarter: Q4 2026, Open Pipe Amount: $6.59M.\nStage: 06 - Finalizing Closure, Account Owner: Edwin Arora, Quarter: Q4 2026, Open Pipe Amount: $3.50M.\nStage: 07 - Pending, Account Owner: Isaac Ault, Quarter: Q4 2026, Open Pipe Amount: $1.76M.\nThis data highlights significant open pipeline opportunities across various stages, account owners, and quarters.',
        },
      },
    ],
  },
  {
    id: 'gold-e.1',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'What is Adam Alfano’s ACV Q3 FY2026?',
        expected: {
          numbers: [70570000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Adam Alfano’s ACV (Annual Contract Value) for Q3 FY2026 is $70.57M. This value was calculated by summing the ACV for opportunities where Adam Alfano is the L2 Leader and the close date falls within the Q3 of FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-e.2',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    smoke: true,
    turns: [
      {
        question: 'What is Jennifer Lagaly’s ACV Q3 FY2026?',
        expected: {
          numbers: [16930000],
          tolerance: GOLD_TOLERANCE,
          reference: 'Jennifer Lagaly’s ACV (Annual Contract Value) for Q3 FY2026 is $16.93M.',
        },
      },
    ],
  },
  {
    id: 'gold-e.3',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much open pipe does Adam Alfano have in third quarter of FY2026?',
        expected: {
          numbers: [26070000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Adam Alfano has an open pipeline of $26.07M in third quarter of FY2026. This value was calculated by summing the Open Pipe OP field for Adam Alfano, filtered to Q3 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-e.4',
    ...GOLD,
    tags: ['fiscal', 'hierarchy', 'aggregate'],
    turns: [
      {
        question: 'How much open pipe does Jennifer Lagaly have in third quarter FY2026?',
        expected: {
          numbers: [6220000],
          tolerance: GOLD_TOLERANCE,
          reference: 'Jennifer Lagaly has an open pipeline of $6.22M in Q3 FY2026.',
        },
      },
    ],
  },
  {
    id: 'gold-f.1',
    ...GOLD,
    tags: ['fiscal', 'count', 'aggregate'],
    turns: [
      {
        question: 'How many new logo customers closed and in pipe in Q1 FY2027?',
        expected: {
          reference: 'In Q1 FY2027, there are 480 new logo customers closed and 10,735 in pipe.',
        },
      },
    ],
  },
  {
    id: 'gold-f.2',
    ...GOLD,
    tags: ['hierarchy', 'count', 'aggregate'],
    turns: [
      {
        question:
          'Show me total count and sum of open opps with Data Cloud or Agentforce in the product list',
        expected: {
          numbers: [2460000000, 1750000000, 493870000, 216220000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'The total open opps is $2.46B across 34,800 opportunities, driven by Data Cloud at $1.75B with 14,445 opportunities, Agentforce at $493.87M with 9,961 opportunities, and Data Cloud - Success Plans at $216.22M with 10,394 opportunities.',
        },
      },
    ],
  },
  {
    id: 'gold-f.3',
    ...GOLD,
    tags: ['fiscal', 'topN'],
    turns: [
      {
        question: 'Can you provide list of top 5 FDOs for FY27?',
        expected: {
          numbers: [4330000, 2010000, 1940000, 1830000],
          tolerance: GOLD_TOLERANCE,
          reference:
            'Here are the top 5 FDOs for FY2027:\nOpportunity: 006ed00000AEMxN, Account: PixelAura Corp, Amount: $4.33M.\nOpportunity: 006ed00000Bmm7F, Account: OceanicFleet Solutions, Amount: $2.01M.\nOpportunity: 006ed00000Bmihx, Account: OceanicFleet Solutions, Amount: $2.01M.\nOpportunity: 006ed000005tMt3, Account: EverEcho Solutions, Amount: $1.94M.\nOpportunity: 006ed00000D641R, Account: TechHive Innovation, Amount: $1.83M.',
        },
      },
    ],
  },
  {
    id: 'gold-f.4',
    ...GOLD,
    tags: ['outOfScope', 'edgecase'],
    turns: [
      {
        question: 'What if Lex Harrington had 10% less ACV? How much ACV would we have closed QTD?',
        expected: {
          reference: 'Out of scope - what-if questions are not supported.',
        },
      },
    ],
  },
  {
    id: 'gold-f.5',
    ...GOLD,
    tags: ['outOfScope', 'edgecase'],
    turns: [
      {
        question: 'What is the forecasted ACV for next year?',
        expected: {
          reference: 'Out of scope - forecasting is not supported.',
        },
      },
    ],
  },
];
