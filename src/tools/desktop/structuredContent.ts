import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MAX_NEXT_ACTION_LABEL_LENGTH = 60;

declare const nextActionLabelBrand: unique symbol;
declare const receiptBrand: unique symbol;

export type NextActionKind = 'execute' | 'prefill' | 'done';

export type NextActionLabel = string & { readonly [nextActionLabelBrand]: true };

export type ReceiptBinding = {
  readonly slot_id: string;
  /** Resolved workbook column, not the caller's token. */
  readonly field: string;
  /** Caller token, present only when resolution changed it to `field`. */
  readonly asked?: string;
};

/**
 * What a tool can honestly say about work it is calling finished, split three ways:
 * `did` — outcomes the tool OBSERVED for itself; `didNot` — requested work it knowingly
 * left undone; `unverified` — claims a reader would otherwise infer that this tool never
 * checked.
 *
 * The third list is the load-bearing one. This codebase has shipped a status written by a
 * producer that could not see the outcome more than once (a judge that scored 93 on a
 * worksheet with no marks; an apply path that reported success it never read back). A
 * `done` marker is the loudest such claim in the protocol — it tells the agent to stop —
 * so the brand makes it unmintable without the producer's own account of what it did not
 * see. `receipt()` is the only way to obtain one.
 */
export type Receipt = {
  readonly did: readonly string[];
  readonly didNot: readonly string[];
  readonly unverified: readonly string[];
  /** Resolved bindings the tool observed after structural readback. */
  readonly bound?: readonly ReceiptBinding[];
  /** Resolved bindings the tool intended to write when structural readback did not run. */
  readonly attempted?: readonly ReceiptBinding[];
} & { readonly [receiptBrand]: true };

export type NextAction =
  | {
      readonly label: NextActionLabel;
      readonly kind: 'execute' | 'prefill';
    }
  | {
      readonly label: NextActionLabel;
      readonly kind: 'done';
      readonly receipt: Receipt;
    };

export type StructuredContent = {
  readonly nextAction: NextAction;
};

/**
 * The block that actually reaches the client: the tool's own result body folded in under
 * the nextAction envelope.
 *
 * Measured 2026-07-25 against a live client: when one result carried both a 371-char
 * `content[0]` and a 90-char `structuredContent`, only the structured block was delivered
 * to the model — the text block was dropped. A bare `{nextAction}` therefore erased the
 * whole receipt on every successful bind: status, guidance, applied, phase_ms, and the
 * sheet_name of the sheet the agent had just created. MCP (2025-06-18, "Structured
 * Content") treats the TextContent block as the backwards-compatibility copy — "a tool
 * that returns structured content SHOULD also return the serialized JSON in a TextContent
 * block" — not the authoritative one, so the structured block has to be a superset of it:
 * whichever branch a client takes, it sees the entire receipt.
 */
export type WireStructuredContent = StructuredContent & { readonly [field: string]: unknown };

type StructuredContentCarrier = {
  readonly structuredContent?: StructuredContent;
};

export type StructuredResult<T extends object> = T & StructuredContentCarrier;

export function receipt(facts: {
  readonly did: readonly string[];
  readonly didNot?: readonly string[];
  readonly unverified: readonly string[];
  readonly bound?: readonly ReceiptBinding[];
  readonly attempted?: readonly ReceiptBinding[];
}): Receipt {
  if (facts.did.length === 0) {
    throw new RangeError('receipt.did must name at least one outcome the tool observed itself');
  }
  // An omitted list and an explicit "nothing unverified" both serialized as []; requiring the
  // caller to provide the list prevents "never considered it" from becoming "checked everything".
  if (!Object.hasOwn(facts, 'unverified')) {
    throw new TypeError('receipt.unverified must be provided explicitly');
  }
  return {
    did: facts.did,
    didNot: facts.didNot ?? [],
    unverified: facts.unverified,
    ...(facts.bound !== undefined ? { bound: facts.bound } : {}),
    ...(facts.attempted !== undefined ? { attempted: facts.attempted } : {}),
  } as Receipt;
}

export function prefillNextAction(label: string): NextAction {
  return { label: nextActionLabel(label), kind: 'prefill' };
}

/**
 * Mint the terminal marker. `toolReceipt` comes first and is required so a future author
 * cannot ship a bare "done" the way bind-template did: `doneNextAction()` no longer
 * compiles, and the brand on {@link Receipt} means the argument cannot be faked with an
 * object literal either — it has to come from {@link receipt}, which forces the author to
 * explicitly account for what the tool did not check.
 */
export function doneNextAction(
  toolReceipt: Receipt,
  label = 'Chart complete — no further calls needed',
): NextAction {
  // The type is the real gate; this catches the caller that gets past it — plain JS, an
  // `as` cast, or a hand-built marker — because a "done" with nothing behind it is the
  // exact defect the brand exists to stop.
  if (!toolReceipt) {
    throw new TypeError('doneNextAction requires a Receipt — mint one with receipt()');
  }
  return { label: nextActionLabel(label), kind: 'done', receipt: toolReceipt };
}

function nextActionLabel(label: string): NextActionLabel {
  if (label.length === 0 || label.length > MAX_NEXT_ACTION_LABEL_LENGTH) {
    throw new RangeError(`nextAction label must be 1-${MAX_NEXT_ACTION_LABEL_LENGTH} characters`);
  }
  return label as NextActionLabel;
}

export function withNextAction<T extends object>(
  result: T,
  nextAction: NextAction,
): StructuredResult<T> {
  return { ...result, structuredContent: { nextAction } };
}

export function attachNextAction<T extends object>(
  result: T,
  nextAction: NextAction,
): StructuredResult<T> {
  // Errors reach the client through this path and tool.ts copies the attached block
  // verbatim, so the body has to be folded in here — the wire helpers below never see it.
  const structuredContent = wireStructuredContent(wireBody(result), { nextAction });
  return Object.assign(result, { structuredContent });
}

export function getStructuredContent(value: unknown): StructuredContent | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return (value as StructuredContentCarrier).structuredContent;
}

/** See {@link WireStructuredContent} for why the body is duplicated into the block. */
export function wireStructuredContent(
  body: object,
  structuredContent: StructuredContent,
): WireStructuredContent {
  return { ...body, ...structuredContent } as WireStructuredContent;
}

type ErrorTextCarrier = { readonly getErrorText: () => string };

/**
 * The wire copy of a value's own body. An McpToolError keeps its payload behind
 * getErrorText() and `Error.message` is non-enumerable, so a plain spread would fold an
 * empty body and delete the very receipt this module exists to preserve.
 */
function wireBody(value: object): Record<string, unknown> {
  const carrier = value as Partial<ErrorTextCarrier>;
  return typeof carrier.getErrorText === 'function'
    ? { message: carrier.getErrorText() }
    : { ...value };
}

export function textToolResult(
  text: string,
  options: { readonly isError?: boolean; readonly nextAction?: NextAction } = {},
): CallToolResult {
  return {
    ...(options.isError !== undefined ? { isError: options.isError } : {}),
    content: [{ type: 'text', text }],
    ...(options.nextAction
      ? {
          structuredContent: wireStructuredContent(
            { message: text },
            { nextAction: options.nextAction },
          ),
        }
      : {}),
  };
}

export function jsonToolResult<T extends object>(
  result: StructuredResult<T>,
  options: { readonly isError?: boolean } = {},
): CallToolResult {
  const { structuredContent, ...body } = result;
  return {
    ...(options.isError !== undefined ? { isError: options.isError } : {}),
    content: [{ type: 'text', text: JSON.stringify(body) }],
    ...(structuredContent
      ? { structuredContent: wireStructuredContent(body, structuredContent) }
      : {}),
  };
}
