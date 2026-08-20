import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import type { SlotSpec } from '../../../../desktop/binder/manifest-types.js';
import { TEMPLATE_VISIBLE_CHANNELS } from '../../../../desktop/templates/bookmarkTemplate.js';
import type { TemplateFitFacts } from '../../../../desktop/templates/inferSlots.js';
import { preferredAutomaticTemplateForNoun } from '../../../../desktop/templates/puppetCompatibilityProjection.js';
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
  cursor: z.string().max(255).optional().describe('Previous nextCursor.'),
  limit: z.number().int().min(1).max(50).optional().describe('Page size; default 20, max 50.'),
  includeSlots: z.boolean().optional().describe('Include slots; limit must be 1.'),
  pass1EligibleOnly: z.boolean().optional().describe('Only validation-passing templates.'),
  requiredChannels: z
    .array(z.enum(TEMPLATE_VISIBLE_CHANNELS))
    .max(TEMPLATE_VISIBLE_CHANNELS.length)
    .optional()
    .describe('Visible channels every result must provide.'),
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
  binding_usage: 'direct' | 'calculation-input' | 'both';
  calculation_channels: string[];
  semantic_role?: string;
  communicative_role?: string;
  purpose?: string;
}

type CompactSlotSummary = Pick<
  SlotSummary,
  | 'slot_id'
  | 'kind'
  | 'derivation'
  | 'role'
  | 'binding_usage'
  | 'calculation_channels'
  | 'semantic_role'
>;

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
    required_slots: CompactSlotSummary[];
    optional_slots: CompactSlotSummary[];
  };
  visible_channels: TemplateFitFacts['visible_channels'];
  same_field_groups: string[][];
  slots?: SlotSummary[];
}

function compareTemplateNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function fitOf(snapshot: TemplateRuntimeSnapshot): TemplateFitFacts {
  if (!snapshot.fit) throw new Error(`Missing fit metadata for template '${snapshot.template}'.`);
  return snapshot.fit;
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

function summarizeSlot(slot: SlotSpec, usage: TemplateFitFacts['slot_usage'][number]): SlotSummary {
  return {
    slot_id: slot.slot_id,
    kind: slot.kind,
    required: slot.required,
    bindable: slot.bindable,
    derivation: slot.derivation,
    role: usage.direct_roles.slice(),
    binding_usage: usage.binding_usage,
    calculation_channels: usage.calculation_channels.slice(),
    ...(slot.semantic_role ? { semantic_role: slot.semantic_role } : {}),
    ...(slot.communicative_role ? { communicative_role: slot.communicative_role } : {}),
    ...(slot.purpose ? { purpose: slot.purpose } : {}),
  };
}

function slotUsage(slot: SlotSpec, fit: TemplateFitFacts): TemplateFitFacts['slot_usage'][number] {
  const usage = fit.slot_usage.find(({ slot_id }) => slot_id === slot.slot_id);
  if (!usage) throw new Error(`Missing fit metadata for slot '${slot.slot_id}'.`);
  return usage;
}

function summarizeCompactSlot(slot: SlotSpec, fit: TemplateFitFacts): CompactSlotSummary {
  const usage = slotUsage(slot, fit);
  return {
    slot_id: slot.slot_id,
    kind: slot.kind,
    derivation: slot.derivation,
    role: usage.direct_roles.slice(),
    binding_usage: usage.binding_usage,
    calculation_channels: usage.calculation_channels.slice(),
    ...(slot.semantic_role ? { semantic_role: slot.semantic_role } : {}),
  };
}

function summarizeTemplate(
  { entry, snapshot }: ResolvedTemplate,
  includeSlots: boolean,
): TemplateSummary {
  const slots = snapshot.descriptor.slots;
  const fit = fitOf(snapshot);
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
        .map((slot) => summarizeCompactSlot(slot, fit)),
      optional_slots: slots
        .filter((slot) => !slot.required)
        .map((slot) => summarizeCompactSlot(slot, fit)),
    },
    visible_channels: fit.visible_channels,
    same_field_groups: fit.same_field_groups,
    ...(includeSlots
      ? {
          slots: slots.map((slot) => summarizeSlot(slot, slotUsage(slot, fit))),
        }
      : {}),
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
    description: 'Search worksheet templates.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async (
      {
        query,
        cursor,
        limit,
        includeSlots = false,
        pass1EligibleOnly = false,
        requiredChannels = [],
      },
      extra,
    ): Promise<CallToolResult> => {
      const resolvedLimit = limit ?? (includeSlots ? 1 : 20);
      return await listTemplatesTool.logAndExecute({
        extra,
        args: {
          query,
          cursor,
          limit: resolvedLimit,
          includeSlots,
          pass1EligibleOnly,
          requiredChannels,
        },
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
          const hasWholeTokenMatch =
            normalizedQuery !== undefined &&
            catalog.some((entry) => fuzzyQueryScore(entry.template, normalizedQuery) > 0);
          const queryMatches = (entry: TemplateCatalogEntry): boolean =>
            normalizedQuery === undefined ||
            (hasExactIdMatch
              ? entry.template.toLowerCase() === normalizedQuery
              : hasWholeTokenMatch
                ? fuzzyQueryScore(entry.template, normalizedQuery) > 0
                : hasLiteralMatch && entry.template.toLowerCase().includes(normalizedQuery));
          const discoveryDiagnostics: DiscoveryDiagnostic[] = catalog
            .filter((entry) => entry.discoveryIssue !== undefined && queryMatches(entry))
            .map((entry) => ({
              template: entry.template,
              provenance: entry.provenance,
              issue: entry.discoveryIssue!,
            }));
          let matchingEntries = catalog.filter(
            (entry) => entry.discoveryIssue === undefined && queryMatches(entry),
          );
          const resolvedByTemplate = new Map<string, TemplateRuntimeSnapshot | null>();
          const prefilterRuntimeDiagnostics: DiscoveryDiagnostic[] = [];
          const resolveOnce = (entry: TemplateCatalogEntry): TemplateRuntimeSnapshot | null => {
            if (resolvedByTemplate.has(entry.template)) {
              return resolvedByTemplate.get(entry.template) ?? null;
            }
            const snapshot = dependencies.resolve(entry);
            resolvedByTemplate.set(entry.template, snapshot);
            return snapshot;
          };
          if (requiredChannels.length > 0) {
            const required = new Set(requiredChannels);
            matchingEntries = matchingEntries.filter((entry) => {
              const snapshot = resolveOnce(entry);
              if (snapshot === null) {
                prefilterRuntimeDiagnostics.push({
                  template: entry.template,
                  provenance: entry.provenance,
                  issue: 'changed-or-unreadable',
                });
                return false;
              }
              const available = new Set([
                ...fitOf(snapshot).visible_channels.direct,
                ...fitOf(snapshot).visible_channels.calculated.map(({ channel }) => channel),
              ]);
              return [...required].every((channel) =>
                channel === 'detail' || channel === 'lod'
                  ? available.has('detail') || available.has('lod')
                  : available.has(channel),
              );
            });
          }
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
              if (normalizedQuery !== undefined && !hasExactIdMatch && hasWholeTokenMatch) {
                const scoreDifference =
                  fuzzyQueryScore(b.template, normalizedQuery) -
                  fuzzyQueryScore(a.template, normalizedQuery);
                if (scoreDifference !== 0) return scoreDifference;
                const preferredTemplate = preferredAutomaticTemplateForNoun(normalizedQuery);
                if (preferredTemplate !== undefined) {
                  const preferredDifference =
                    Number(b.template === preferredTemplate) -
                    Number(a.template === preferredTemplate);
                  if (preferredDifference !== 0) return preferredDifference;
                }
                if (includeSlots) {
                  const aSnapshot = resolveOnce(a);
                  const bSnapshot = resolveOnce(b);
                  const eligibilityDifference =
                    Number(bSnapshot?.eligibility.pass1_eligible === true) -
                    Number(aSnapshot?.eligibility.pass1_eligible === true);
                  if (eligibilityDifference !== 0) return eligibilityDifference;
                }
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
            snapshot: resolveOnce(entry),
          }));
          let processedCount = processed.length;

          const diagnosticsPayload = (
            runtimeDiagnostics: DiscoveryDiagnostic[],
          ): Record<string, unknown> => {
            const diagnostics = [
              ...new Map(
                [
                  ...discoveryDiagnostics,
                  ...prefilterRuntimeDiagnostics,
                  ...runtimeDiagnostics,
                ].map((diagnostic) => [
                  `${diagnostic.template}\u001f${diagnostic.provenance}\u001f${diagnostic.issue}`,
                  diagnostic,
                ]),
              ).values(),
            ];
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
