import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import type { SlotSpec } from '../../../../desktop/binder/manifest-types.js';
import {
  listTemplateCatalog,
  readBookmarkFromCatalogEntry,
  type TemplateCatalogEntry,
  type TemplateDiscoveryIssue,
} from '../../../../desktop/templates/templatePath.js';
import {
  createTemplateRuntimeSnapshot,
  type TemplateRuntimeSnapshot,
} from '../../../../desktop/templates/templateRuntimeSnapshot.js';
import { ArgsValidationError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { jsonToolResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  query: z.string().trim().min(1).max(256).optional().describe('Search template IDs.'),
  cursor: z
    .string()
    .max(255)
    .optional()
    .describe('Continuation cursor returned by the previous page.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Maximum candidates examined per page; default 20, max 50.'),
  includeSlots: z.boolean().optional().describe('Include structural slot facts for one template.'),
  pass1EligibleOnly: z
    .boolean()
    .optional()
    .describe('Return only templates that pass current worksheet-template validation.'),
};

const COMPACT_RESPONSE_LIMIT_BYTES = 16_384;
const DETAIL_RESPONSE_LIMIT_BYTES = 12_288;
const MAX_DIAGNOSTICS = 20;

type DiscoveryDiagnostic = {
  template: string;
  provenance: string;
  issue: TemplateDiscoveryIssue | 'changed-or-unreadable';
};

type ResolvedTemplate = {
  entry: TemplateCatalogEntry;
  snapshot: TemplateRuntimeSnapshot;
};

interface SlotSummary {
  slot_id: string;
  kind: string;
  required: boolean;
  bindable: boolean;
  derivation: string;
  role: string[];
  semantic_role?: string;
  communicative_role?: string;
  purpose?: string;
}

interface TemplateSummary {
  template: string;
  provenance: string;
  overridesLowerPrecedence: boolean;
  pass1_eligible: boolean;
  pass1_blockers: string[];
  slot_signature: {
    total: number;
    required: number;
    kinds: string[];
    required_slots: Array<{
      slot_id: string;
      kind: string;
      semantic_role?: string;
    }>;
  };
  slots?: SlotSummary[];
}

function compareTemplateNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalSearchToken(token: string): string {
  if (token === 'ranked' || token === 'ranking' || token === 'ranks') return 'rank';
  if (token === 'bars') return 'bar';
  if (token === 'columns') return 'column';
  if (token === 'maps') return 'map';
  if (token === 'charts') return 'chart';
  if (token === 'rates') return 'rate';
  if (token === 'ratios') return 'ratio';
  return token;
}

function searchTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(canonicalSearchToken),
  );
}

function templateSearchTokens(template: string): Set<string> {
  const tokens = searchTokens(template);
  if (tokens.has('bar')) tokens.add('horizontal');
  if (tokens.has('column')) tokens.add('vertical');
  if (tokens.has('choropleth')) tokens.add('filled');
  return tokens;
}

function fuzzyQueryScore(template: string, query: string): number {
  const templateTokens = templateSearchTokens(template);
  let score = 0;
  for (const token of searchTokens(query)) {
    if (!templateTokens.has(token)) continue;
    score += token === 'horizontal' || token === 'vertical' ? 4 : token === 'rank' ? 2 : 1;
  }
  return score;
}

function summarizeSlot(slot: SlotSpec): SlotSummary {
  return {
    slot_id: slot.slot_id,
    kind: slot.kind,
    required: slot.required,
    bindable: slot.bindable,
    derivation: slot.derivation,
    role: slot.role.slice(),
    ...(slot.semantic_role ? { semantic_role: slot.semantic_role } : {}),
    ...(slot.communicative_role ? { communicative_role: slot.communicative_role } : {}),
    ...(slot.purpose ? { purpose: slot.purpose } : {}),
  };
}

function summarizeTemplate(
  { entry, snapshot }: ResolvedTemplate,
  includeSlots: boolean,
): TemplateSummary {
  const slots = snapshot.descriptor.slots;
  return {
    template: entry.template,
    provenance: entry.provenance,
    overridesLowerPrecedence: entry.overridesLowerPrecedence,
    pass1_eligible: snapshot.eligibility.pass1_eligible,
    pass1_blockers: snapshot.eligibility.pass1_blockers.slice(),
    slot_signature: {
      total: slots.length,
      required: slots.filter((slot) => slot.required).length,
      kinds: [...new Set(slots.map((slot) => slot.kind))].sort(compareTemplateNames),
      required_slots: slots
        .filter((slot) => slot.required)
        .map((slot) => ({
          slot_id: slot.slot_id,
          kind: slot.kind,
          ...(slot.semantic_role ? { semantic_role: slot.semantic_role } : {}),
        })),
    },
    ...(includeSlots ? { slots: slots.map(summarizeSlot) } : {}),
  };
}

function resolveTemplate(entry: TemplateCatalogEntry): TemplateRuntimeSnapshot | null {
  const bookmark = readBookmarkFromCatalogEntry(entry);
  if (bookmark === null) return null;
  try {
    return createTemplateRuntimeSnapshot(entry.template, bookmark);
  } catch {
    return null;
  }
}

interface ListTemplatesDependencies {
  listCatalog(): TemplateCatalogEntry[];
  resolve(entry: TemplateCatalogEntry): TemplateRuntimeSnapshot | null;
}

const DEFAULT_DEPENDENCIES: ListTemplatesDependencies = {
  listCatalog: () => listTemplateCatalog(),
  resolve: resolveTemplate,
};

function payloadBytes(payload: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf-8');
}

const title = 'Listing templates';

export const getListTemplatesTool = (
  server: DesktopMcpServer,
  dependencies: ListTemplatesDependencies = DEFAULT_DEPENDENCIES,
): DesktopTool<typeof paramsSchema> => {
  const listTemplatesTool = new DesktopTool({
    server,
    name: 'list-templates',
    title,
    description: 'Search available worksheet templates.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async (
      { query, cursor, limit, includeSlots = false, pass1EligibleOnly = false },
      extra,
    ): Promise<CallToolResult> => {
      const resolvedLimit = limit ?? (includeSlots ? 1 : 20);
      return await listTemplatesTool.logAndExecute({
        extra,
        args: { query, cursor, limit: resolvedLimit, includeSlots, pass1EligibleOnly },
        getSuccessResult: (payload) => jsonToolResult(payload, { isError: false }),
        callback: async () => {
          if (includeSlots && resolvedLimit !== 1) {
            return new ArgsValidationError(
              'includeSlots requires limit=1 so one bounded structural descriptor is returned.',
            ).toErr();
          }

          const catalog = dependencies.listCatalog();
          const normalizedQuery = query?.toLowerCase();
          const hasLiteralMatch =
            normalizedQuery !== undefined &&
            catalog.some((entry) => entry.template.toLowerCase().includes(normalizedQuery));
          const hasExactIdMatch =
            normalizedQuery !== undefined &&
            catalog.some((entry) => entry.template.toLowerCase() === normalizedQuery);
          const queryMatches = (entry: TemplateCatalogEntry): boolean =>
            normalizedQuery === undefined ||
            (hasLiteralMatch
              ? entry.template.toLowerCase().includes(normalizedQuery)
              : fuzzyQueryScore(entry.template, normalizedQuery) > 0);
          const discoveryDiagnostics: DiscoveryDiagnostic[] = catalog
            .filter((entry) => entry.discoveryIssue !== undefined && queryMatches(entry))
            .map((entry) => ({
              template: entry.template,
              provenance: entry.provenance,
              issue: entry.discoveryIssue!,
            }));
          const matchingEntries = catalog.filter(
            (entry) => entry.discoveryIssue === undefined && queryMatches(entry),
          );
          const bestCanonicalScore =
            normalizedQuery !== undefined && !hasExactIdMatch
              ? matchingEntries
                  .filter((entry) => !entry.template.includes('__'))
                  .reduce(
                    (best, entry) =>
                      Math.max(best, fuzzyQueryScore(entry.template, normalizedQuery)),
                    0,
                  )
              : 0;
          const candidates = matchingEntries
            // Exact IDs keep specialized templates available; fuzzy searches prefer an equally good canonical shape.
            .filter((entry) => {
              if (
                normalizedQuery === undefined ||
                hasExactIdMatch ||
                !entry.template.includes('__')
              ) {
                return true;
              }
              return fuzzyQueryScore(entry.template, normalizedQuery) > bestCanonicalScore;
            })
            .sort((a, b) => {
              if (normalizedQuery !== undefined && !hasLiteralMatch) {
                const scoreDifference =
                  fuzzyQueryScore(b.template, normalizedQuery) -
                  fuzzyQueryScore(a.template, normalizedQuery);
                if (scoreDifference !== 0) return scoreDifference;
                const lengthDifference = a.template.length - b.template.length;
                if (lengthDifference !== 0) return lengthDifference;
              }
              return compareTemplateNames(a.template, b.template);
            });

          let start = 0;
          if (cursor !== undefined) {
            const cursorIndex = candidates.findIndex((entry) => entry.template === cursor);
            if (cursorIndex < 0) {
              return new ArgsValidationError(
                `Invalid template cursor "${cursor}" for the current filters.`,
              ).toErr();
            }
            start = cursorIndex + 1;
          }

          const selected = candidates.slice(start, start + resolvedLimit);
          const processed = selected.map((entry) => ({
            entry,
            snapshot: dependencies.resolve(entry),
          }));
          let processedCount = processed.length;

          const diagnosticsPayload = (
            runtimeDiagnostics: DiscoveryDiagnostic[],
          ): Record<string, unknown> => {
            const diagnostics = [...discoveryDiagnostics, ...runtimeDiagnostics];
            return {
              count: diagnostics.length,
              returned: Math.min(diagnostics.length, MAX_DIAGNOSTICS),
              truncated: diagnostics.length > MAX_DIAGNOSTICS,
              templates: diagnostics
                .slice()
                .sort((a, b) => compareTemplateNames(a.template, b.template))
                .slice(0, MAX_DIAGNOSTICS),
            };
          };
          const buildPayload = (): Record<string, unknown> => {
            const examined = processed.slice(0, processedCount);
            const runtimeDiagnostics: DiscoveryDiagnostic[] = examined
              .filter(
                (resolved): resolved is { entry: TemplateCatalogEntry; snapshot: null } =>
                  resolved.snapshot === null,
              )
              .map(({ entry }) => ({
                template: entry.template,
                provenance: entry.provenance,
                issue: 'changed-or-unreadable',
              }));
            const page: ResolvedTemplate[] = examined.filter(
              (
                resolved,
              ): resolved is { entry: TemplateCatalogEntry; snapshot: TemplateRuntimeSnapshot } =>
                resolved.snapshot !== null &&
                (!pass1EligibleOnly || resolved.snapshot.eligibility.pass1_eligible),
            );
            return {
              total: catalog.length,
              candidateCount: candidates.length,
              scanned: processedCount,
              count: page.length,
              nextCursor:
                start + processedCount < candidates.length
                  ? (examined.at(-1)?.entry.template ?? null)
                  : null,
              diagnostics: diagnosticsPayload(runtimeDiagnostics),
              templates: page.map((resolved) => summarizeTemplate(resolved, includeSlots)),
            };
          };

          const responseLimit = includeSlots
            ? DETAIL_RESPONSE_LIMIT_BYTES
            : COMPACT_RESPONSE_LIMIT_BYTES;
          let payload = buildPayload();
          while (!includeSlots && processedCount > 0 && payloadBytes(payload) > responseLimit) {
            processedCount -= 1;
            payload = buildPayload();
          }
          if (
            payloadBytes(payload) > responseLimit ||
            (processedCount === 0 && selected.length > 0)
          ) {
            return new ArgsValidationError(
              `Template catalog metadata exceeds the ${responseLimit}-byte response limit.`,
            ).toErr();
          }

          return new Ok(payload);
        },
      });
    },
  });

  return listTemplatesTool;
};
