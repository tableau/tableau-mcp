export const KINDS = [
  'progress',
  'reasoning',
  'invocation',
  'result',
  'answer',
  'disclosure',
  'correction',
  'delivery',
  'question',
  'proposal',
  'conflict',
  'resolution',
] as const;

export type Kind = (typeof KINDS)[number];

export const TOOL_ALLOWLISTED_KINDS = ['result', 'delivery', 'question', 'proposal'] as const;

export type ToolAllowlistedKind = (typeof TOOL_ALLOWLISTED_KINDS)[number];

export const SOUTH_OWNED_KINDS = [
  'progress',
  'reasoning',
  'invocation',
  'answer',
  'disclosure',
  'correction',
  'conflict',
  'resolution',
] as const;

export type SouthOwnedKind = (typeof SOUTH_OWNED_KINDS)[number];

export const BODY_TYPES = ['text', 'table', 'code', 'ask', 'artifact'] as const;

export type BodyType = (typeof BODY_TYPES)[number];

export const ASK_MODES = ['binary', 'radio', 'chips'] as const;

export type AskMode = (typeof ASK_MODES)[number];

export type AskOption = {
  pick: string;
  note?: string;
};

export type UtteranceBody =
  | { type: 'text'; text: string }
  | { type: 'table'; caption?: string; columns: string[]; rows: string[][] }
  | { type: 'code'; code: string; preview?: string }
  | { type: 'ask'; stem: string; mode: AskMode; options: AskOption[] }
  | { type: 'artifact'; artifactType: string; payload: unknown };

export type Utterance = {
  kind: Kind;
  state?: string;
  body: UtteranceBody;
  supersedes?: string;
};

export type UtteranceToolMeta = {
  defaultKind: Kind;
  bodyTypes: BodyType[];
};

export const INSIGHT_BUNDLE_ARTIFACT_TYPE = 'insight-bundle';

export const RESULT_TABLE_TOOL_META: UtteranceToolMeta = {
  defaultKind: 'result',
  bodyTypes: ['table'],
};

export const DELIVERY_ARTIFACT_TOOL_META: UtteranceToolMeta = {
  defaultKind: 'delivery',
  bodyTypes: ['artifact'],
};

export const ASK_TOOL_META: UtteranceToolMeta = {
  defaultKind: 'question',
  bodyTypes: ['ask'],
};

export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

export function toolMaySetKind(kind: Kind): kind is ToolAllowlistedKind {
  return (TOOL_ALLOWLISTED_KINDS as readonly string[]).includes(kind);
}

export function requireToolAllowlistedKind(kind: Kind): asserts kind is ToolAllowlistedKind {
  if (!toolMaySetKind(kind)) {
    throw new Error(`${kind} is South-owned; MCP tools cannot set it.`);
  }
}

export function utteranceToWire(utterance: Utterance): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    kind: utterance.kind,
    body: bodyToWire(utterance.body),
  };
  if (utterance.state !== undefined) {
    wire.state = utterance.state;
  }
  if (utterance.supersedes !== undefined) {
    wire.supersedes = utterance.supersedes;
  }
  return wire;
}

export function bodyToWire(body: UtteranceBody): Record<string, unknown> {
  if (body.type === 'text') {
    return { type: 'text', text: body.text };
  }
  if (body.type === 'table') {
    const wire: Record<string, unknown> = {
      type: 'table',
      columns: body.columns.slice(),
      rows: body.rows.map((row) => row.slice()),
    };
    if (body.caption !== undefined) {
      wire.caption = body.caption;
    }
    return wire;
  }
  if (body.type === 'code') {
    const wire: Record<string, unknown> = { type: 'code', code: body.code };
    if (body.preview !== undefined) {
      wire.preview = body.preview;
    }
    return wire;
  }
  if (body.type === 'ask') {
    return {
      type: 'ask',
      stem: body.stem,
      mode: body.mode,
      options: body.options.map(askOptionToWire),
    };
  }
  return {
    type: 'artifact',
    artifactType: body.artifactType,
    payload: body.payload,
  };
}

export function utteranceToolMetaToWire(meta: UtteranceToolMeta): Record<string, unknown> {
  requireToolAllowlistedKind(meta.defaultKind);
  return { defaultKind: meta.defaultKind, bodyTypes: meta.bodyTypes.slice() };
}

export function utteranceFromWire(value: unknown): Utterance {
  const record = requireObject(value, 'utterance');
  const utterance: Utterance = {
    kind: parseKind(record.kind, 'utterance.kind'),
    body: bodyFromWire(record.body),
  };
  const state = optionalString(record.state, 'utterance.state');
  if (state !== undefined) {
    utterance.state = state;
  }
  const supersedes = optionalString(record.supersedes, 'utterance.supersedes');
  if (supersedes !== undefined) {
    utterance.supersedes = supersedes;
  }
  return utterance;
}

export function bodyFromWire(value: unknown): UtteranceBody {
  const record = requireObject(value, 'utterance.body');
  const bodyType = parseBodyType(record.type, 'utterance.body.type');
  if (bodyType === 'text') {
    return { type: 'text', text: requireString(record.text, 'utterance.body.text') };
  }
  if (bodyType === 'table') {
    const body: Extract<UtteranceBody, { type: 'table' }> = {
      type: 'table',
      columns: requireStringList(record.columns, 'utterance.body.columns'),
      rows: requireStringRows(record.rows, 'utterance.body.rows'),
    };
    const caption = optionalString(record.caption, 'utterance.body.caption');
    if (caption !== undefined) {
      body.caption = caption;
    }
    return body;
  }
  if (bodyType === 'code') {
    const body: Extract<UtteranceBody, { type: 'code' }> = {
      type: 'code',
      code: requireString(record.code, 'utterance.body.code'),
    };
    const preview = optionalString(record.preview, 'utterance.body.preview');
    if (preview !== undefined) {
      body.preview = preview;
    }
    return body;
  }
  if (bodyType === 'ask') {
    return {
      type: 'ask',
      stem: requireString(record.stem, 'utterance.body.stem'),
      mode: parseAskMode(record.mode, 'utterance.body.mode'),
      options: parseAskOptions(record.options),
    };
  }
  return {
    type: 'artifact',
    artifactType: requireString(record.artifactType, 'utterance.body.artifactType'),
    payload: record.payload,
  };
}

export function utteranceToolMetaFromWire(value: unknown): UtteranceToolMeta {
  const record = requireObject(value, '_meta.utterance');
  const defaultKind = parseKind(record.defaultKind, '_meta.utterance.defaultKind');
  requireToolAllowlistedKind(defaultKind);
  if (!Array.isArray(record.bodyTypes) || record.bodyTypes.length === 0) {
    throw new Error('_meta.utterance.bodyTypes must be a non-empty array.');
  }
  return {
    defaultKind,
    bodyTypes: record.bodyTypes.map((item, i) => parseBodyType(item, `bodyTypes[${i}]`)),
  };
}

function askOptionToWire(option: AskOption): Record<string, unknown> {
  const wire: Record<string, unknown> = { pick: option.pick };
  if (option.note !== undefined) {
    wire.note = option.note;
  }
  return wire;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireString(value, label);
}

function requireStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireStringRows(value: unknown, label: string): string[][] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of string arrays.`);
  }
  return value.map((row, rowIndex) => {
    if (!Array.isArray(row)) {
      throw new Error(`${label}[${rowIndex}] must be an array of strings.`);
    }
    return row.map((cell, j) => requireString(cell, `${label}[${rowIndex}][${j}]`));
  });
}

function parseKind(value: unknown, label: string): Kind {
  if (isKind(value)) {
    return value;
  }
  throw new Error(`${label} must be one of ${KINDS.join(', ')}.`);
}

function parseBodyType(value: unknown, label: string): BodyType {
  if (typeof value === 'string' && (BODY_TYPES as readonly string[]).includes(value)) {
    return value as BodyType;
  }
  throw new Error(`${label} must be one of ${BODY_TYPES.join(', ')}.`);
}

function parseAskMode(value: unknown, label: string): AskMode {
  if (typeof value === 'string' && (ASK_MODES as readonly string[]).includes(value)) {
    return value as AskMode;
  }
  throw new Error(`${label} must be one of ${ASK_MODES.join(', ')}.`);
}

function parseAskOptions(value: unknown): AskOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('utterance.body.options must be a non-empty array.');
  }
  return value.map((item, index) => {
    const record = requireObject(item, `utterance.body.options[${index}]`);
    const option: AskOption = {
      pick: requireString(record.pick, `utterance.body.options[${index}].pick`),
    };
    const note = optionalString(record.note, `utterance.body.options[${index}].note`);
    if (note !== undefined) {
      option.note = note;
    }
    return option;
  });
}
