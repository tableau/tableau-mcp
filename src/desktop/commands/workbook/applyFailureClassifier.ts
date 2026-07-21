export type ApplyFailureContext = 'workbook' | 'worksheet' | 'dashboard';

export type ApplyFailureClass =
  | 'xml-grammar'
  | 'field-binding'
  | 'dashboard-composition'
  | 'command-rejected'
  | 'worksheet-not-found'
  | 'timeout-or-transport'
  | 'unknown';

export interface ApplyFailureClassification {
  failure_class: ApplyFailureClass;
  confidence: number;
  evidence: string[];
  guidance: string;
}

export interface ClassifyApplyFailureInput {
  serverError?: unknown;
  applyResponse?: unknown;
  xmlSnippet?: string;
  context: ApplyFailureContext;
}

const GUIDANCE: Record<ApplyFailureClass, string> = {
  'xml-grammar':
    'The document was structurally rejected at load. Do not regenerate the workbook. Re-read the current known-good content, diff it against your payload, and apply the smallest XML patch that fixes the structural delta before re-applying.',
  'field-binding':
    'A field, calc, set, parameter, or placeholder reference did not resolve. Do a schema lookup first, bind to the exact field name already in the workbook, and declare any calc/set before referencing it.',
  'dashboard-composition':
    'The dashboard linkage was rejected. Verify every zone references a real worksheet included in the workbook, avoid guessed ids/window pairings, and patch the specific dashboard zone instead of rebuilding unrelated sheets.',
  'command-rejected':
    'The External Client API rejected the command or verb. Check the command name and required params; do not retry the same command unchanged.',
  'worksheet-not-found':
    'The target worksheet does not exist. List the live worksheets, verify the actual sheet name, then target or rename the real sheet before applying. Do not regenerate the workbook.',
  'timeout-or-transport':
    'Transport failed before Tableau could evaluate the payload. Confirm Tableau Desktop and the External Client API are reachable, then re-issue the same payload once instead of rewriting the XML.',
  unknown:
    'Only a generic wrapper survived. Do not blind-retry. First gather evidence: inspect the command result/logs, re-read the current known-good content, structural-diff it against your payload, then retry with a minimal patch.',
};

interface Rule {
  failure_class: ApplyFailureClass;
  confidence: number;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    failure_class: 'command-rejected',
    confidence: 0.85,
    patterns: [
      /unknown verb/i,
      /unknown command/i,
      /unrecognized command/i,
      /unsupported command/i,
      /no such command/i,
      /verb\s+["']?[\w-]+["']?\s+(?:is\s+)?(?:unknown|invalid|not recognized)/i,
    ],
  },
  {
    failure_class: 'worksheet-not-found',
    confidence: 0.9,
    patterns: [/worksheet\s+["'][^"']+["']\s+(?:was\s+)?not\s+found/i, /\bsheet not found\b/i],
  },
  {
    failure_class: 'field-binding',
    confidence: 0.78,
    patterns: [
      /undeclared-(?:calc|set|aggregate-ok)-reference/i,
      /unsubstituted-template-token/i,
      /parameter-field-on-shelf/i,
      /never declared as a <column>/i,
      /does not have a valid data source/i,
      /no valid data source/i,
      /unknown field/i,
      /no such field/i,
      /field\s+["'[][^"'\]]+["'\]]?\s+(?:not found|does not exist|is unknown|cannot be found)/i,
      /column\s+["'[][^"'\]]+["'\]]?\s+(?:not found|does not exist)/i,
      /unresolved\s+(?:field|reference|calc|caption)/i,
    ],
  },
  {
    failure_class: 'dashboard-composition',
    confidence: 0.72,
    patterns: [
      /dashboard-zones-reference-included-worksheets/i,
      /dashboard\s+["'][^"']+["']\s+references worksheet/i,
      /\bzone\b[^\n]*\b(?:referenc|missing|not found|invalid)/i,
      /invalid\s+uuid|uuid[^\n]*(?:invalid|not found|mismatch|unknown)/i,
      /missing (?:second )?(?:panel|zone|window)/i,
    ],
  },
  {
    failure_class: 'xml-grammar',
    confidence: 0.82,
    patterns: [
      /qualified name parse error/i,
      /well-formed-xml/i,
      /xml (?:is not well-formed|parsing error)/i,
      /not well[- ]?formed/i,
      /\bmalformed\b/i,
      /unexpected (?:element|token|end|close|eof|close tag)/i,
      /mismatched (?:tag|brackets)/i,
      /premature end/i,
      /invalid attribute/i,
      /expected\s+<\/?[\w:-]+>/i,
    ],
  },
  {
    failure_class: 'xml-grammar',
    confidence: 0.5,
    patterns: [
      /load-underlying-metadata[\s\S]*?(?:load was not able to complete|not able to complete successfully|could not be completed)/i,
      /(?:load was not able to complete|not able to complete successfully)[\s\S]*?internal error - an unexpected error/i,
      /errors occurred while trying to load the workbook/i,
    ],
  },
  {
    failure_class: 'timeout-or-transport',
    confidence: 0.65,
    patterns: [/timed out/i, /\btimeout\b/i, /null response/i, /no response/i],
  },
];

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(toText).join('\n');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

const MAX_EVIDENCE_LEN = 240;

function collectEvidence(text: string, patterns: RegExp[]): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const index = match.index;
    const lineStart = text.lastIndexOf('\n', index) + 1;
    let lineEnd = text.indexOf('\n', index);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd).trim();
    let span = line.length <= MAX_EVIDENCE_LEN ? line : match[0].replace(/\s+/g, ' ').trim();
    if (span.length > MAX_EVIDENCE_LEN) span = span.slice(-MAX_EVIDENCE_LEN).trim();
    if (span) found.add(span);
  }
  return [...found];
}

const AUTO_CALC_REF = /Calculation_\d{6,}/g;

function findUndeclaredAutoCalc(xml: string): string | null {
  const referenced = new Set<string>();
  for (const match of String(xml ?? '').matchAll(AUTO_CALC_REF)) referenced.add(match[0]);
  for (const calc of referenced) {
    const declaration = new RegExp(
      `<column\\b[^>]*\\bname=(['"])\\[[^\\]]*${calc}[^\\]]*\\]\\1`,
      'i',
    );
    if (!declaration.test(xml)) return calc;
  }
  return null;
}

const GENERIC_WRAPPER = [
  /failed to apply workbook xml/i,
  /failed to (?:apply|update|load) worksheet/i,
  /(?:workbook|worksheet|dashboard) could not be loaded/i,
  /worksheet contains errors/i,
  /dashboard contains errors/i,
  /make sure tableau desktop is running/i,
  /internal error/i,
  /an unexpected error occurred/i,
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function classifyApplyFailure(input: ClassifyApplyFailureInput): ApplyFailureClassification {
  const text = [toText(input.serverError), toText(input.applyResponse)].filter(Boolean).join('\n');

  for (const rule of RULES) {
    const evidence = collectEvidence(text, rule.patterns);
    if (evidence.length === 0) continue;
    const confidence =
      rule.failure_class === 'dashboard-composition' && input.context === 'dashboard'
        ? Math.min(0.85, rule.confidence + 0.1)
        : rule.confidence;
    return {
      failure_class: rule.failure_class,
      confidence: round2(confidence),
      evidence: evidence.slice(0, 6),
      guidance: GUIDANCE[rule.failure_class],
    };
  }

  if (input.xmlSnippet) {
    const calc = findUndeclaredAutoCalc(input.xmlSnippet);
    if (calc) {
      return {
        failure_class: 'field-binding',
        confidence: 0.6,
        evidence: [`undeclared auto-calc reference in payload: ${calc} (no <column> declaration)`],
        guidance: GUIDANCE['field-binding'],
      };
    }
  }

  const generic = collectEvidence(text, GENERIC_WRAPPER);
  const evidence =
    generic.length > 0
      ? generic.slice(0, 3)
      : text.trim()
        ? [text.trim().split(/\r?\n/)[0].slice(0, MAX_EVIDENCE_LEN)]
        : ['no error text preserved'];
  return { failure_class: 'unknown', confidence: 0.2, evidence, guidance: GUIDANCE.unknown };
}

export function formatApplyFailureForAgent(input: ClassifyApplyFailureInput): string {
  const classification = classifyApplyFailure(input);
  const evidence = classification.evidence.length
    ? `\nEvidence: ${classification.evidence.join(' | ')}`
    : '';
  return `Apply failed: ${classification.failure_class} (confidence ${classification.confidence}).${evidence}\n\nFIX: ${classification.guidance}`;
}
