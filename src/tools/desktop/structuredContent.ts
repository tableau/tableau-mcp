import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MAX_NEXT_ACTION_LABEL_LENGTH = 60;

declare const nextActionLabelBrand: unique symbol;

export type NextActionKind = 'execute' | 'prefill' | 'done';

export type NextActionLabel = string & { readonly [nextActionLabelBrand]: true };

export type NextAction = {
  readonly label: NextActionLabel;
  readonly kind: NextActionKind;
};

export type StructuredContent = {
  readonly nextAction: NextAction;
};

type StructuredContentCarrier = {
  readonly structuredContent?: StructuredContent;
};

export type StructuredResult<T extends object> = T & StructuredContentCarrier;

export function prefillNextAction(label: string): NextAction {
  return { label: nextActionLabel(label), kind: 'prefill' };
}

export function doneNextAction(): NextAction {
  return { label: nextActionLabel('Chart complete — no further calls needed'), kind: 'done' };
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
  return Object.assign(result, { structuredContent: { nextAction } });
}

export function getStructuredContent(value: unknown): StructuredContent | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return (value as StructuredContentCarrier).structuredContent;
}

export function textToolResult(
  text: string,
  options: { readonly isError?: boolean; readonly nextAction?: NextAction } = {},
): CallToolResult {
  return {
    ...(options.isError !== undefined ? { isError: options.isError } : {}),
    content: [{ type: 'text', text }],
    ...(options.nextAction ? { structuredContent: { nextAction: options.nextAction } } : {}),
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
    ...(structuredContent ? { structuredContent } : {}),
  };
}
