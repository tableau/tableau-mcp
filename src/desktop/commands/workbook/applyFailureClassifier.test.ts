import { classifyApplyFailure, formatApplyFailureForAgent } from './applyFailureClassifier.js';

describe('classifyApplyFailure', () => {
  it('classifies XML grammar rejections (Qualified Name Parse Error / not well-formed)', () => {
    const parseError = classifyApplyFailure({
      context: 'workbook',
      serverError:
        'The load was not able to complete successfully. Qualified Name Parse Error --- ' +
        'Invalid input: mismatched brackets --- Input: [Sample - Superstore].[[Sub-Category]]',
    });
    expect(parseError.failure_class).toBe('xml-grammar');
    expect(parseError.confidence).toBe(0.82);
    expect(parseError.evidence.length).toBeGreaterThan(0);
    expect(parseError.evidence.join(' ')).toContain('Qualified Name Parse Error');
    expect(parseError.guidance).toContain('structurally rejected');

    const notWellFormed = classifyApplyFailure({
      context: 'worksheet',
      serverError: 'The worksheet XML is not well-formed near line 4.',
    });
    expect(notWellFormed.failure_class).toBe('xml-grammar');
    expect(notWellFormed.evidence.length).toBeGreaterThan(0);
  });

  it('classifies unresolved field/calc references as field-binding', () => {
    const c = classifyApplyFailure({
      context: 'worksheet',
      serverError: 'Unknown field [Sales Amount] referenced on the Rows shelf.',
    });
    expect(c.failure_class).toBe('field-binding');
    expect(c.confidence).toBe(0.78);
    expect(c.guidance).toContain('schema lookup');
  });

  it('classifies a missing target worksheet as worksheet-not-found', () => {
    const c = classifyApplyFailure({
      context: 'worksheet',
      serverError: "worksheet 'Regional Sales' not found",
    });
    expect(c.failure_class).toBe('worksheet-not-found');
    expect(c.confidence).toBe(0.9);
    expect(c.guidance).toContain('does not exist');
  });

  it('classifies a rejected External Client API verb as command-rejected', () => {
    const c = classifyApplyFailure({
      context: 'workbook',
      serverError: "unknown verb 'frobnicate' - the External Client API rejected the command",
    });
    expect(c.failure_class).toBe('command-rejected');
    expect(c.confidence).toBe(0.85);
    expect(c.guidance).toContain('command name');
  });

  it('classifies a bare command failure without inventing a cause', () => {
    const c = classifyApplyFailure({
      context: 'workbook',
      serverError: 'Command tabui:load-underlying-metadata failed',
    });
    expect(c.failure_class).toBe('command-failed-bare');
    expect(c.evidence).toEqual(['Command tabui:load-underlying-metadata failed']);
    expect(c.guidance).toContain('raw error verbatim');
    expect(c.guidance).toContain('Do not name, guess, or imply a cause');
  });

  it('keeps a detailed command failure classified as worksheet-not-found', () => {
    const c = classifyApplyFailure({
      context: 'worksheet',
      serverError: 'Command tabdoc:load-workbook failed: worksheet "Sales" not found',
    });
    expect(c.failure_class).toBe('worksheet-not-found');
  });

  it('keeps a detailed command failure classified as xml-grammar', () => {
    const c = classifyApplyFailure({
      context: 'workbook',
      serverError: 'Command tabdoc:load-workbook failed: Qualified Name Parse Error',
    });
    expect(c.failure_class).toBe('xml-grammar');
  });

  it('keeps a detailed command failure classified as field-binding', () => {
    const c = classifyApplyFailure({
      context: 'worksheet',
      serverError: 'Command tabdoc:apply failed: unknown field [Profit Ratio]',
    });
    expect(c.failure_class).toBe('field-binding');
  });

  it('keeps a detailed command failure classified as timeout-or-transport', () => {
    const c = classifyApplyFailure({
      context: 'workbook',
      serverError: 'Command tabui:x failed: request timed out',
    });
    expect(c.failure_class).toBe('timeout-or-transport');
  });

  it('falls back to unknown with low confidence on a generic wrapper', () => {
    const c = classifyApplyFailure({
      context: 'workbook',
      serverError: 'Internal error - an unexpected error occurred',
    });
    expect(c.failure_class).toBe('unknown');
    expect(c.confidence).toBe(0.2);
    // The honest fallback must forbid blind retrying and force evidence-gathering.
    expect(c.guidance).toContain('blind-retry');
    expect(c.guidance).toContain('raw error verbatim');
    expect(c.guidance).toContain('Do not name, guess, or imply a cause');
    expect(c.guidance).toContain('cause is unknown');
    expect(c.evidence.join(' ')).toContain('an unexpected error occurred');
  });

  it('detects an undeclared auto-calc reference in the payload as field-binding', () => {
    const c = classifyApplyFailure({
      context: 'worksheet',
      // References Calculation_123456 but never declares it as a <column>.
      xmlSnippet:
        '<worksheet name="Sheet 1"><table><rows>[Parameters].[Calculation_123456]</rows></table></worksheet>',
    });
    expect(c.failure_class).toBe('field-binding');
    expect(c.confidence).toBe(0.6);
    expect(c.evidence.join(' ')).toContain('Calculation_123456');
  });
});

describe('formatApplyFailureForAgent', () => {
  it('renders an actionable "Apply failed: ... FIX:" message', () => {
    const message = formatApplyFailureForAgent({
      context: 'workbook',
      serverError:
        'The load was not able to complete successfully. Qualified Name Parse Error --- ' +
        'Invalid input: mismatched brackets',
    });
    expect(message).toContain('Apply failed:');
    expect(message).toContain('FIX:');
    expect(message).toContain('Qualified Name Parse Error');
    expect(message.startsWith('{')).toBe(false);
  });
});
