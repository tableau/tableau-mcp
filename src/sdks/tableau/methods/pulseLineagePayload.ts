import { luidSchema } from '../../routeSafety/ids.js';
import { PulseFieldUse, PulseLineageOwner, PulseLineagePage } from '../types/pulseLineage.js';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 1024 ? value : undefined;
const luid = (value: unknown): string | undefined => {
  const result = luidSchema.safeParse(value);
  return result.success ? result.data : undefined;
};
// Preserve an explicitly invalid scope as unresolved; never fall back to a
// parent's datasource merely because an explicit override failed validation.
const scopeId = (value: unknown): string | undefined =>
  typeof value === 'string' ? (text(value) ?? 'invalid-datasource-scope') : undefined;
const pointer = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');

/** Pulse JSON is metadata, never code. Keep only literal selectors, safe scalar
 * settings and saved categorical values. Do not parse viz-state strings or URLs. */
export function parsePulseLineagePayload(
  payload: unknown,
  kind: 'definitions' | 'metrics',
): PulseLineagePage {
  const envelope = object(payload);
  const singular = kind === 'definitions' ? 'definition' : 'metric';
  const rows = Array.isArray(payload)
    ? payload
    : Object.hasOwn(envelope, kind)
      ? envelope[kind]
      : Object.hasOwn(envelope, singular)
        ? [envelope[singular]]
        : Object.hasOwn(envelope, kind === 'definitions' ? 'metadata' : 'definition_id')
          ? [envelope]
          : undefined;
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error('Invalid Pulse collection.');
  const token = envelope.next_page_token;
  if (token !== undefined && token !== '' && (typeof token !== 'string' || token.length > 4096))
    throw new Error('Invalid Pulse cursor.');
  const total = envelope.total_available;
  if (total !== undefined && (!Number.isSafeInteger(total) || (total as number) < 0))
    throw new Error('Invalid Pulse count.');
  const owners: PulseLineageOwner[] = [];
  let visits = 0,
    useCount = 0,
    limited = false;
  const add = (row: unknown, family: 'definitions' | 'metrics', path: string): void => {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      throw new Error('Invalid Pulse row.');
    if (owners.length >= 5000) {
      limited = true;
      return;
    }
    const value = object(row),
      metadata = object(value.metadata);
    const id = luid(family === 'definitions' ? metadata.id : value.id);
    if (!id) throw new Error('Invalid Pulse identity.');
    const owner: PulseLineageOwner = {
      kind: family === 'definitions' ? 'pulse-definition' : 'pulse-metric',
      luid: id,
      name: text(metadata.name) ?? id,
      datasourceLuid:
        family === 'definitions'
          ? scopeId(object(object(value.specification).datasource).id)
          : scopeId(value.datasource_luid),
      definitionLuid: family === 'metrics' ? luid(value.definition_id) : undefined,
      path,
      uses: [],
      opaque: false,
    };
    owners.push(owner);
    const pending = [{ value: row, path, scope: owner.datasourceLuid, depth: 0 }];
    while (pending.length) {
      const item = pending.pop()!;
      if (++visits > 100000 || item.depth > 40 || item.path.length > 8192 || useCount >= 5000) {
        limited = true;
        return;
      }
      if (Array.isArray(item.value)) {
        for (let i = item.value.length - 1; i >= 0; i--)
          pending.push({
            ...item,
            value: item.value[i],
            path: `${item.path}/${i}`,
            depth: item.depth + 1,
          });
        continue;
      }
      const part = object(item.value);
      let scope = item.scope;
      if (typeof object(part.datasource).id === 'string')
        scope = scopeId(object(part.datasource).id);
      if (typeof part.datasource_luid === 'string') scope = scopeId(part.datasource_luid);
      if (typeof part.viz_state_string === 'string' && part.viz_state_string) owner.opaque = true;
      for (const key of ['field', 'identifier_col', 'name_col'] as const) {
        const selector = text(part[key]);
        if (!selector) {
          if (Object.hasOwn(part, key) && part[key] !== '') limited = true;
          continue;
        }
        const role =
          Object.hasOwn(part, 'categorical_values') || item.path.includes('/filters/')
            ? 'pulse-filter'
            : item.path.includes('/time_dimension')
              ? 'pulse-time'
              : item.path.includes('/measure')
                ? 'pulse-measure'
                : 'pulse-field';
        const values: PulseFieldUse['values'] = [];
        if (Object.hasOwn(part, 'categorical_values') && !Array.isArray(part.categorical_values))
          limited = true;
        if (Array.isArray(part.categorical_values)) {
          if (part.categorical_values.length > 100) limited = true;
          for (const category of part.categorical_values.slice(0, 100))
            for (const [tag, entry] of Object.entries(object(category)))
              if (['string_value', 'bool_value', 'null_value', 'number_value'].includes(tag)) {
                if (values.length >= 100) {
                  limited = true;
                  break;
                }
                if (
                  entry === null ||
                  typeof entry === 'boolean' ||
                  (typeof entry === 'number' && Number.isFinite(entry)) ||
                  (typeof entry === 'string' && entry.length <= 1024)
                )
                  values.push(entry as string | number | boolean | null);
                else limited = true;
              }
        }
        owner.uses.push({
          path: `${item.path}/${key}`,
          datasourceLuid: scope,
          selector,
          role,
          evidence: 'direct',
          aggregation: text(part.aggregation),
          operator: text(part.operator),
          values,
        });
        useCount++;
      }
      if (Array.isArray(part.allowed_dimensions)) {
        for (let index = 0; index < part.allowed_dimensions.length; index++) {
          if (useCount >= 5000) {
            limited = true;
            break;
          }
          const selector = text(part.allowed_dimensions[index]);
          if (selector) {
            owner.uses.push({
              path: `${item.path}/allowed_dimensions/${index}`,
              datasourceLuid: scope,
              selector,
              role: 'pulse-allowed-dimension',
              evidence: 'possible',
              values: [],
            });
            useCount++;
          } else limited = true;
        }
      }
      for (const [key, child] of Object.entries(part).reverse())
        if (key !== 'metrics' && child !== null && typeof child === 'object')
          pending.push({
            value: child,
            path: `${item.path}/${pointer(key)}`,
            scope,
            depth: item.depth + 1,
          });
    }
    if (family === 'definitions' && Array.isArray(value.metrics))
      for (let i = 0; i < value.metrics.length; i++)
        add(value.metrics[i], 'metrics', `${path}/metrics/${i}`);
  };
  for (let index = 0; index < rows.length; index++) {
    const path = Array.isArray(payload)
      ? `/${index}`
      : Object.hasOwn(envelope, kind)
        ? `/${kind}/${index}`
        : Object.hasOwn(envelope, singular)
          ? `/${singular}`
          : '';
    add(rows[index], kind, path);
    if (limited && (visits > 100000 || useCount >= 5000)) break;
  }
  return {
    owners,
    rowCount: rows.length,
    limited,
    ...(typeof token === 'string' && token ? { nextPageToken: token } : {}),
    ...(typeof total === 'number' ? { totalAvailable: total } : {}),
  };
}
