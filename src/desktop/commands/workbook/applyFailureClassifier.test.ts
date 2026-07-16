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

  it('classifies a rejected Agent API verb as command-rejected', () => {
    const c = classifyApplyFailure({
      context: 'workbook',
      serverError: "unknown verb 'frobnicate' — the Agent API rejected the command",
    });
    expect(c.failure_class).toBe('command-rejected');
    expect(c.confidence).toBe(0.85);
    expect(c.guidance).toContain('command name');
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
