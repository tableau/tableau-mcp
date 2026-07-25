import {
  doneNextAction,
  jsonToolResult,
  prefillNextAction,
  receipt,
  textToolResult,
  withNextAction,
} from './structuredContent.js';

const boundReceipt = receipt({
  did: ['applied template "bar" as sheet "Sales by Region"'],
  didNot: ['sort the bars'],
  unverified: ['whether the sheet renders any marks'],
});

describe('structuredContent helpers', () => {
  it('preserves the plain text MCP envelope when there is no next action', () => {
    expect(textToolResult('hello')).toEqual({
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('keeps the whole receipt in the structured block, not just the next action', () => {
    // Measured 2026-07-25 against a live client: given a result carrying both a 371-char
    // content[0] and a 90-char {nextAction} structured block, only the structured block
    // reached the model. A bare {nextAction} therefore deleted status/guidance/applied/
    // sheet_name/phase_ms on every successful bind — the agent never learned the name of
    // the sheet it had just created.
    const body = {
      status: 'bound',
      applied: true,
      sheet_name: 'Sales by Region',
      guidance: 'Applied "Sales by Region" to the live workbook.',
      phase_ms: { bind: 114, inject: 30, apply: 513 },
    };
    const result = jsonToolResult(withNextAction(body, doneNextAction(boundReceipt)), {
      isError: false,
    });

    expect(result.structuredContent).toEqual({
      ...body,
      nextAction: {
        label: 'Chart complete — no further calls needed',
        kind: 'done',
        receipt: {
          did: ['applied template "bar" as sheet "Sales by Region"'],
          didNot: ['sort the bars'],
          unverified: ['whether the sheet renders any marks'],
        },
      },
    });
  });

  it('still ships the serialized body in a TextContent block, without the envelope', () => {
    // MCP 2025-06-18: "a tool that returns structured content SHOULD also return the
    // serialized JSON in a TextContent block". content stays the body only — nextAction is
    // envelope routing, not tool output — so a content-reading client sees what it always saw.
    const body = { applied: false, guidance: 'Resolve the fields first.' };
    const result = jsonToolResult(
      withNextAction(body, prefillNextAction('Resolve the fields first')),
      { isError: false },
    );

    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(body) }]);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      ...body,
      nextAction: { label: 'Resolve the fields first', kind: 'prefill' },
    });
  });

  it('emits no structured block at all when the result carries no next action', () => {
    const result = jsonToolResult({ status: 'bound' as const }, { isError: false });

    expect(result.content).toEqual([{ type: 'text', text: '{"status":"bound"}' }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it('folds the message into the structured block of a text result', () => {
    expect(
      textToolResult('No instances found', { nextAction: prefillNextAction('Start Tableau') }),
    ).toEqual({
      content: [{ type: 'text', text: 'No instances found' }],
      structuredContent: {
        message: 'No instances found',
        nextAction: { label: 'Start Tableau', kind: 'prefill' },
      },
    });
  });

  it('rejects labels over 60 characters', () => {
    expect(() => prefillNextAction('x'.repeat(61))).toThrow('nextAction label');
  });

  it('doneNextAction carries the receipt and defaults its label', () => {
    expect(doneNextAction(boundReceipt)).toEqual({
      label: 'Chart complete — no further calls needed',
      kind: 'done',
      receipt: boundReceipt,
    });
  });

  it('doneNextAction accepts tool-specific terminal guidance', () => {
    expect(doneNextAction(boundReceipt, 'Stop — report no data')).toEqual({
      label: 'Stop — report no data',
      kind: 'done',
      receipt: boundReceipt,
    });
  });

  it('refuses a done marker without a receipt — at compile time', () => {
    // The type error IS the test: CI's root `npx tsc --noEmit` step typechecks this file, so a
    // future author cannot reintroduce the bare `doneNextAction()` that shipped a "done" with
    // nothing behind it. @ts-expect-error fails typecheck if that call starts compiling again.
    // @ts-expect-error — a done marker requires a Receipt
    expect(() => doneNextAction()).toThrow('requires a Receipt');
  });

  it('refuses a receipt that observed nothing', () => {
    expect(() => receipt({ did: [], unverified: [] })).toThrow('at least one outcome');
  });

  it('requires an explicit unverified list instead of treating omission as checked', () => {
    // The root typecheck rejects omission; the runtime gate covers plain JS and casts.
    // @ts-expect-error — unverified must be considered explicitly
    expect(() => receipt({ did: ['read the workbook'] })).toThrow(
      'receipt.unverified must be provided explicitly',
    );
  });

  it('preserves an explicitly empty unverified list', () => {
    expect(receipt({ did: ['read the workbook'], unverified: [] })).toEqual({
      did: ['read the workbook'],
      didNot: [],
      unverified: [],
    });
  });
});
