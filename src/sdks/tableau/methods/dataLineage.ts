import { z } from 'zod';

import {
  DataLineageResult,
  LineageKind,
  LineageNode,
  LineageOptions,
} from '../types/dataLineage.js';
import {
  identitySelection,
  metadataQuery,
  metadataRoots,
  prepInputVisibilityQuery,
  Relation,
  relations,
  relationSelection,
} from './dataLineageQueries.js';

const scopeRef = z.object({ id: z.string().optional(), luid: z.string().nullish() });
export const lineageWireNodeSchema = z
  .object({
    id: z.string().min(1),
    __typename: z.string(),
    name: z.string().nullish(),
    luid: z.string().nullish(),
    dataType: z.string().nullish(),
    formula: z.string().nullish(),
    stepId: z.string().nullish(),
    datasource: z
      .object({
        id: z.string(),
        __typename: z.string(),
        luid: z.string().nullish(),
        workbook: scopeRef.nullish(),
      })
      .nullish(),
    workbook: scopeRef.nullish(),
    flow: z.union([scopeRef, z.array(scopeRef.nullable())]).nullish(),
    table: z
      .object({
        name: z.string().nullish(),
        schema: z.string().nullish(),
        database: z.object({ name: z.string().nullish() }).nullish(),
      })
      .nullish(),
  })
  .passthrough();
export type LineageWireNode = z.infer<typeof lineageWireNodeSchema>;

const connectionSchema = z.object({
  nodes: z.array(lineageWireNodeSchema.nullable()),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
});

export function toLineageNode(wire: LineageWireNode, kind: LineageKind): LineageNode {
  const flows = Array.isArray(wire.flow) ? wire.flow : wire.flow ? [wire.flow] : [];
  return {
    id: `metadata:${wire.id}`,
    metadataId: wire.id,
    metadataType: wire.__typename,
    kind,
    ...(wire.name != null ? { name: wire.name } : {}),
    ...(wire.luid ? { luid: wire.luid } : {}),
    ...(wire.dataType ? { dataType: wire.dataType } : {}),
    ...(wire.formula != null ? { formula: wire.formula.slice(0, 8000) } : {}),
    ...(wire.stepId ? { stepId: wire.stepId } : {}),
    ...(flows.length === 1 && flows[0]?.luid ? { flowLuid: flows[0].luid } : {}),
    ...(wire.table
      ? {
          table: {
            name: wire.table.name ?? undefined,
            schema: wire.table.schema ?? undefined,
            database: wire.table.database?.name ?? undefined,
          },
        }
      : {}),
  };
}

export type LineageDependencies = {
  graphql: (query: string) => Promise<unknown>;
  isAllowed: (node: LineageWireNode, kind: LineageKind) => Promise<boolean>;
  prepEnabled: boolean;
  signal?: AbortSignal;
};

export const lineageLimitations = [
  'Results describe indexed, permission-visible metadata, not a proof that a change is safe. Indexing delays and unsupported/custom SQL can omit dependencies.',
  'Metadata downstream/upstream rollups are marked possible; their intermediate column or step paths are not inferred.',
  'Optional Prep details statically follow supported saved operations and namespaces. Catalog-field identity bindings, dynamic schemas, unsupported expressions and external/model execution remain unverified.',
  'Container membership is terminal and does not imply that every field or sheet in that container depends on the source.',
  'Detailed Prep input/output settings are scoped to non-database files and published Tableau data sources. Provider-specific database connection and database-write settings are outside this iteration; catalog database-column lineage is separate.',
];

/** Request-local graph builder. No global cache can mix users or site scopes. */
export class DataLineageTraversal {
  readonly result: DataLineageResult;
  private readonly wires = new Map<string, { wire: LineageWireNode; kind: LineageKind }>();
  private readonly allowed = new Map<string, boolean>();
  private readonly verifiedInputs = new Map<string, LineageWireNode>();
  private readonly expanded = new Set<string>();
  private readonly edgeIds = new Set<string>();
  private readonly queue: Array<{ id: string; depth: number }> = [];

  constructor(
    readonly options: LineageOptions,
    private readonly dependencies: LineageDependencies,
  ) {
    this.result = {
      resolution: 'not-found',
      direction: options.direction,
      nodes: [],
      edges: [],
      warnings: [],
      coverage: {
        metadata: 'indexed-visible-subgraph',
        prep: 'not-requested',
        truncated: false,
        requests: 0,
        permissionMode: 'FILTER',
      },
      limitations: [...lineageLimitations],
    };
  }

  warn(code: string, message: string, nodeId?: string): void {
    if (!this.result.warnings.some((w) => w.code === code && w.nodeId === nodeId)) {
      this.result.warnings.push({ code, message, ...(nodeId ? { nodeId } : {}) });
    }
  }

  truncate(code: string): void {
    this.result.coverage.truncated = true;
    if (this.result.coverage.metadata !== 'not-requested')
      this.result.coverage.metadata = 'partial';
    this.warn(code, 'Traversal reached a configured limit; additional dependencies may exist.');
  }

  reserveRequest(): boolean {
    this.dependencies.signal?.throwIfAborted();
    if (this.result.coverage.requests >= this.options.maxRequests) {
      this.truncate('REQUEST_LIMIT');
      return false;
    }
    this.result.coverage.requests++;
    return true;
  }

  private async request(query: string): Promise<z.infer<typeof connectionSchema> | undefined> {
    if (!this.reserveRequest()) return undefined;
    try {
      const envelope = z
        .object({
          data: z.object({ asset: connectionSchema.nullable() }).nullable(),
          errors: z.array(z.unknown()).optional(),
        })
        .parse(await this.dependencies.graphql(query));
      if (envelope.errors?.length || !envelope.data?.asset) {
        this.result.coverage.metadata = 'partial';
        this.warn(
          'GRAPHQL_PARTIAL',
          'Metadata API reported a partial GraphQL response; missing relationships are unknown.',
        );
      }
      return envelope.data?.asset ?? undefined;
    } catch (error) {
      if (this.dependencies.signal?.aborted) throw error;
      this.result.coverage.metadata = 'partial';
      this.warn(
        'METADATA_UNAVAILABLE',
        'A Metadata API response was unavailable or invalid. Missing dependencies cannot be ruled out.',
      );
      return undefined;
    }
  }

  private async canInclude(wire: LineageWireNode, kind: LineageKind): Promise<boolean> {
    const key = `${kind}:${wire.id}`;
    if (!this.allowed.has(key)) {
      const prep = kind.startsWith('flow');
      // Check before output, edge creation, or recursive expansion. Denied
      // identities and nested scope references never reach returned results.
      let verdict =
        (!prep || this.dependencies.prepEnabled) && (await this.dependencies.isAllowed(wire, kind));
      if (verdict && wire.__typename === 'FlowFieldInputField') {
        this.result.coverage.permissionMode = 'FILTER_WITH_VERIFIED_PREP_INPUTS';
        const owners = Array.isArray(wire.flow) ? wire.flow : wire.flow ? [wire.flow] : [];
        verdict = owners.length > 0;
        for (const owner of owners) {
          if (!owner?.id) {
            verdict = false;
            break;
          }
          const response = await this.request(prepInputVisibilityQuery(owner.id, wire.id));
          const parent = response?.nodes.find((n) => n?.id === owner.id);
          const visible = connectionSchema.safeParse(parent?.r0);
          const input = visible.success
            ? visible.data.nodes.find(
                (n) => n?.id === wire.id && n.__typename === 'FlowFieldInputField',
              )
            : undefined;
          if (!input || !(await this.dependencies.isAllowed(input, kind))) {
            verdict = false;
            break;
          }
          this.verifiedInputs.set(wire.id, input);
        }
        if (!verdict) {
          this.verifiedInputs.delete(wire.id);
          this.result.coverage.metadata = 'partial';
          this.warn(
            'PREP_INPUT_VISIBILITY_UNVERIFIED',
            'A Prep input from an API without FILTER support could not be confirmed through its permitted owning Flow. Its identity and paths are omitted.',
          );
        }
      }
      this.allowed.set(key, verdict);
      if (!verdict)
        this.warn(
          'SCOPE_FILTERED',
          'Some assets were excluded by resource boundaries or disabled Prep access. Their identities and paths are omitted.',
        );
    }
    return this.allowed.get(key) === true;
  }

  async add(wire: LineageWireNode, kind: LineageKind): Promise<LineageNode | undefined> {
    if (!(await this.canInclude(wire, kind))) return undefined;
    wire = this.verifiedInputs.get(wire.id) ?? wire;
    const id = `metadata:${wire.id}`;
    const existing = this.result.nodes.find((n) => n.id === id);
    if (existing) {
      // A private owner reference may have inserted ID-only context earlier.
      // Enrich its name only from a later, permitted catalog identity.
      if (!existing.name && wire.name) existing.name = wire.name;
      return existing;
    }
    if (this.result.nodes.length >= this.options.maxNodes) {
      this.truncate('NODE_LIMIT');
      return undefined;
    }
    const node = toLineageNode(wire, kind);
    if (wire.formula && wire.formula.length > 8000)
      this.warn(
        'FORMULA_TRUNCATED',
        'A calculated-field formula was shortened to 8000 characters.',
        id,
      );
    this.result.nodes.push(node);
    this.wires.set(id, { wire, kind });
    if (this.options.includePrepDetails && kind.startsWith('flow-')) {
      const owners = Array.isArray(wire.flow) ? wire.flow : wire.flow ? [wire.flow] : [];
      for (const owner of owners)
        if (owner?.id && owner.luid)
          await this.add({ id: owner.id, luid: owner.luid, __typename: 'Flow' }, 'flow');
    }
    return node;
  }

  private edge(from: string, to: string, relation: Relation): void {
    const id = JSON.stringify([from, to, relation.field]);
    if (!this.edgeIds.has(id)) {
      if (this.result.edges.length >= this.options.maxEdges) {
        this.truncate('EDGE_LIMIT');
        return;
      }
      this.edgeIds.add(id);
      this.result.edges.push({
        id,
        from,
        to,
        relationship: relation.field,
        evidence: relation.evidence,
        provenance: 'metadata-api',
        propagates: !relation.terminal,
      });
    }
  }

  private rootFor(wire: LineageWireNode, kind: LineageKind): string | undefined {
    const candidates = metadataRoots[kind];
    if (kind === 'datasource')
      return wire.__typename === 'EmbeddedDatasource' ? candidates?.[1] : candidates?.[0];
    if (kind === 'flow-input-field')
      return wire.__typename === 'FlowFieldInputField' ? candidates?.[1] : candidates?.[0];
    if (kind === 'flow-output-field')
      return wire.__typename === 'FlowFieldOutputField' ? candidates?.[1] : candidates?.[0];
    return candidates?.[0];
  }

  private selectedRelations(kind: LineageKind): Relation[] {
    return (relations[kind] ?? []).filter(
      (r) =>
        (this.options.direction === 'both' || r.direction === this.options.direction) &&
        (this.dependencies.prepEnabled || !r.target.startsWith('flow')),
    );
  }

  /** Resolve names across every candidate page; never choose the first match. */
  async resolve(): Promise<void> {
    const source = this.options.source;
    if (source.type === 'prep-step' || source.type === 'prep-field' || source.type === 'local-flow')
      return;
    const roots = metadataRoots[source.type] ?? [];
    const filter =
      'id' in source
        ? `id: ${JSON.stringify(source.id)}`
        : 'luid' in source
          ? `luid: ${JSON.stringify(source.luid)}`
          : `name: ${JSON.stringify(source.name)}`;
    const candidates: Array<{ wire: LineageWireNode; kind: LineageKind }> = [];
    let fullyRead = true;
    let denied = false;
    for (const root of roots) {
      // A datasource LUID denotes a published datasource, not the distinct
      // unqueryable metadata ID of an embedded datasource.
      if (source.type === 'datasource' && root !== roots[0]) continue;
      let after: string | undefined;
      const cursors = new Set<string>();
      do {
        const response = await this.request(
          metadataQuery(root, filter, identitySelection(source.type), this.options.pageSize, after),
        );
        if (!response || this.result.warnings.some((w) => w.code === 'GRAPHQL_PARTIAL')) {
          fullyRead = false;
          break;
        }
        for (const wire of response.nodes) {
          if (!wire) {
            this.warn(
              'NULL_ASSET',
              'Metadata API omitted an asset; visibility or indexing may be incomplete.',
            );
            fullyRead = false;
            continue;
          }
          if (
            source.type === 'column' &&
            'name' in source &&
            (wire.name !== source.name ||
              wire.table?.name !== source.table ||
              (source.database !== undefined && wire.table.database?.name !== source.database) ||
              (source.schema !== undefined && wire.table.schema !== source.schema))
          )
            continue;
          if (!(await this.canInclude(wire, source.type))) {
            denied = true;
            continue;
          }
          if (!candidates.some((c) => c.wire.id === wire.id))
            candidates.push({ wire: this.verifiedInputs.get(wire.id) ?? wire, kind: source.type });
          if (candidates.length > this.options.maxNodes) {
            this.truncate('NODE_LIMIT');
            fullyRead = false;
            break;
          }
        }
        if (!fullyRead || !response.pageInfo.hasNextPage) break;
        const cursor = response.pageInfo.endCursor;
        if (!cursor || cursors.has(cursor)) {
          this.warn(
            'INVALID_CURSOR',
            'Metadata pagination did not advance; the candidate set is incomplete.',
          );
          fullyRead = false;
          break;
        }
        cursors.add(cursor);
        after = cursor;
      } while (after !== undefined);
    }
    if (!fullyRead || candidates.length > 1) {
      this.result.resolution = candidates.length ? 'ambiguous' : 'unavailable';
      this.result.candidates = candidates
        .slice(0, this.options.maxNodes)
        .map((c) => toLineageNode(c.wire, c.kind));
      this.warn(
        'SOURCE_UNRESOLVED',
        'The source could not be identified uniquely from a complete candidate set. Use an exact Metadata API ID.',
      );
      return;
    }
    if (!candidates.length) {
      this.result.resolution =
        this.result.coverage.metadata === 'partial'
          ? 'unavailable'
          : denied
            ? 'not-allowed'
            : 'not-found';
      this.warn(
        'SOURCE_NOT_VISIBLE',
        'No unique permitted source was found. This does not prove the asset has no dependencies.',
      );
      return;
    }
    const candidate = candidates[0];
    const node = await this.add(candidate.wire, candidate.kind);
    if (node) {
      this.result.resolution = 'resolved';
      this.result.sourceId = node.id;
      this.queue.push({ id: node.id, depth: 0 });
    }
  }

  async expand(): Promise<void> {
    while (this.queue.length) {
      const { id, depth } = this.queue.shift()!;
      if (this.expanded.has(id)) continue;
      this.expanded.add(id);
      const entry = this.wires.get(id);
      if (!entry) continue;
      const selected = this.selectedRelations(entry.kind);
      if (!selected.length) continue;
      if (depth >= this.options.maxDepth) {
        this.truncate('DEPTH_LIMIT');
        continue;
      }
      const root = this.rootFor(entry.wire, entry.kind);
      if (!root) continue;
      let pending = selected.map((relation, index) => ({
        relation,
        alias: `r${index}`,
        after: undefined as string | undefined,
        cursors: new Set<string>(),
      }));
      while (pending.length) {
        const response = await this.request(
          metadataQuery(
            root,
            `id: ${JSON.stringify(entry.wire.id)}`,
            `${identitySelection(entry.kind)}\n${pending.map((p) => relationSelection(p.relation, p.alias, this.options.pageSize, p.after)).join('\n')}`,
          ),
        );
        if (!response) break;
        const owner = response.nodes.find((n) => n?.id === entry.wire.id);
        if (!owner) {
          this.warn(
            'ASSET_DISAPPEARED',
            'An asset became unavailable during traversal; its relationships are unknown.',
            id,
          );
          break;
        }
        const next: typeof pending = [];
        for (const p of pending) {
          const raw = owner[p.alias];
          if (raw == null) {
            if (raw === null && !p.relation.connection) continue;
            // A type-specific inline fragment can legitimately be absent.
            if (!p.relation.on) {
              this.result.coverage.metadata = 'partial';
              this.warn('RELATION_UNAVAILABLE', 'A requested relationship was not returned.', id);
            }
            continue;
          }
          const parsed = p.relation.connection
            ? connectionSchema.safeParse(raw)
            : z
                .union([lineageWireNodeSchema, z.array(lineageWireNodeSchema.nullable())])
                .safeParse(raw);
          if (!parsed.success) {
            this.result.coverage.metadata = 'partial';
            this.warn('RELATION_INVALID', 'A relationship had an unsupported response shape.', id);
            continue;
          }
          const connection = p.relation.connection
            ? connectionSchema.parse(parsed.data)
            : undefined;
          const values =
            connection?.nodes ?? (Array.isArray(parsed.data) ? parsed.data : [parsed.data]);
          for (const value of values) {
            if (!value) {
              this.result.coverage.metadata = 'partial';
              continue;
            }
            let wire = lineageWireNodeSchema.parse(value);
            if (p.relation.permissionMode === false) {
              // This reverse link has no permissionMode argument. Re-resolve
              // through its discovery root; canInclude then confirms it through
              // the owning Flow's FILTER connection before it can be exposed.
              const targetRoot = this.rootFor(wire, p.relation.target);
              if (!targetRoot) continue;
              const filtered = await this.request(
                metadataQuery(
                  targetRoot,
                  `id: ${JSON.stringify(wire.id)}`,
                  identitySelection(p.relation.target),
                ),
              );
              const visible = filtered?.nodes.find((n) => n?.id === wire.id);
              if (!visible) continue;
              wire = visible;
            }
            const node = await this.add(wire, p.relation.target);
            if (!node) continue;
            if (p.relation.direction === 'downstream') this.edge(id, node.id, p.relation);
            else this.edge(node.id, id, p.relation);
            if (!p.relation.terminal) this.queue.push({ id: node.id, depth: depth + 1 });
          }
          if (connection?.pageInfo.hasNextPage) {
            const cursor = connection.pageInfo.endCursor;
            if (!cursor || p.cursors.has(cursor)) {
              this.result.coverage.metadata = 'partial';
              this.warn(
                'INVALID_CURSOR',
                'Metadata pagination did not advance; additional relationships are unknown.',
                id,
              );
            } else {
              p.cursors.add(cursor);
              next.push({ ...p, after: cursor });
            }
          }
        }
        pending = next;
      }
    }
  }
}
