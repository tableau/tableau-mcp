import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import {
  DataLineageTraversal,
  LineageWireNode,
} from '../../../sdks/tableau/methods/dataLineage.js';
import { parsePulseLineagePayload } from '../../../sdks/tableau/methods/pulseLineagePayload.js';
import { DataLineageResult, LineageNode } from '../../../sdks/tableau/types/dataLineage.js';
import {
  PulseFieldUse,
  PulseLineageOwner,
  PulseLineagePage,
  PulseLineageRequest,
} from '../../../sdks/tableau/types/pulseLineage.js';

type Dependencies = {
  read: (request: PulseLineageRequest) => Promise<unknown>;
  isDatasourceAllowed: (luid: string) => Promise<boolean>;
  metadataEnabled: boolean;
  signal: AbortSignal;
};
const identity = (owner: Pick<PulseLineageOwner, 'kind' | 'luid'>): string =>
  `pulse:${owner.kind === 'pulse-definition' ? 'definition' : 'metric'}:${owner.luid}`;

/** Catalog hops consume depth; saved Prep internals/handoffs are already bounded
 * by field-version limits and do not spend another catalog hop. A terminal
 * membership can be a result, but never becomes a Pulse traversal seed. */
export function pulseDownstreamContexts(graph: DataLineageResult): Map<string, number> {
  const distances = new Map<string, number>();
  if (!graph.sourceId) return distances;
  const pending = [{ id: graph.sourceId, depth: 0 }];
  const outgoing = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges)
    if (edge.propagates) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  while (pending.length) {
    const current = pending.shift()!;
    if ((distances.get(current.id) ?? Infinity) <= current.depth) continue;
    distances.set(current.id, current.depth);
    for (const edge of outgoing.get(current.id) ?? []) {
      const cost =
        edge.provenance === 'flow-document' ||
        edge.provenance === 'local-flow-file' ||
        edge.relationship === 'native-flow-field-id'
          ? 0
          : 1;
      pending.push({ id: edge.to, depth: current.depth + cost });
    }
  }
  return distances;
}

/** Read-only, request-scoped Pulse collector. API bodies stay in memory; usage
 * sites become explicit edges and bounded details, never row/insight queries. */
export class PulseLineageCollector {
  private readonly owners = new Map<string, PulseLineageOwner>();
  private readonly invalid = new Set<string>();
  private readonly allowed = new Map<string, Promise<boolean>>();
  private readonly bindings = new Map<string, Promise<LineageWireNode | undefined>>();
  private readonly edgeIds = new Set<string>();
  private readonly depths = new Map<string, number>();
  private successfulReads = 0;
  private projectedBytes = 0;
  private projectedUses = 0;
  private stopped = false;

  constructor(
    readonly traversal: DataLineageTraversal,
    private readonly dependencies: Dependencies,
  ) {
    this.graph.limitations.push(
      'Pulse field links require an exact unique selector in a permitted published datasource. Allowed breakdown dimensions remain possible; partial listings and opaque specifications do not prove no impact. Saved filter values are configuration, not queried data rows.',
    );
  }
  private get graph(): DataLineageResult {
    return this.traversal.result;
  }

  private gap(code: string, message: string, nodeId?: string): void {
    this.graph.coverage.pulse = this.successfulReads ? 'partial' : 'unavailable';
    this.traversal.warn(code, message, nodeId);
  }

  private async permitted(datasourceLuid?: string): Promise<boolean> {
    this.dependencies.signal.throwIfAborted();
    if (!luidSchema.safeParse(datasourceLuid).success) return false;
    if (!this.allowed.has(datasourceLuid!)) {
      if (
        this.allowed.size >=
        Math.min(this.traversal.options.maxRequests, this.traversal.options.maxNodes)
      ) {
        this.gap(
          'PULSE_SCOPE_LIMIT',
          'Pulse datasource permission checks reached their request-local scope limit.',
        );
        return false;
      }
      this.allowed.set(datasourceLuid!, this.dependencies.isDatasourceAllowed(datasourceLuid!));
    }
    return this.allowed.get(datasourceLuid!)!;
  }

  private invalidate(id: string): void {
    const pending = [id];
    while (pending.length) {
      const current = pending.pop()!;
      if (this.invalid.has(current)) continue;
      this.invalid.add(current);
      const owner = this.owners.get(current);
      if (owner?.kind === 'pulse-definition')
        for (const candidate of this.owners.values())
          if (candidate.definitionLuid === owner.luid) pending.push(identity(candidate));
      this.graph.nodes = this.graph.nodes.filter((node) => node.id !== current);
      this.graph.edges = this.graph.edges.filter(
        (edge) => edge.from !== current && edge.to !== current,
      );
      this.graph.pulseDetails = this.graph.pulseDetails?.filter(
        (detail) => detail.ownerId !== current,
      );
      if (this.graph.sourceId === current) {
        this.graph.sourceId = undefined;
        this.graph.resolution = 'unavailable';
      }
    }
    this.gap(
      'PULSE_IDENTITY_CHANGED',
      'Conflicting Pulse owner identities were omitted; their dependencies are unknown.',
    );
  }

  private async read(request: PulseLineageRequest): Promise<PulseLineagePage | undefined> {
    if (this.stopped) return undefined;
    this.dependencies.signal.throwIfAborted();
    if (!this.traversal.reserveRequest()) {
      this.gap('PULSE_REQUEST_LIMIT', 'Pulse collection stopped at the shared request budget.');
      return undefined;
    }
    try {
      const page = parsePulseLineagePayload(
        await this.dependencies.read(request),
        request.kind === 'definitions' ? 'definitions' : 'metrics',
      );
      this.successfulReads++;
      if (this.graph.coverage.pulse !== 'partial') this.graph.coverage.pulse = 'visible-subgraph';
      if (page.limited)
        this.gap(
          'PULSE_PAYLOAD_LIMIT',
          'Some Pulse configuration exceeded bounded metadata limits.',
        );
      for (const owner of page.owners) {
        const id = identity(owner),
          old = this.owners.get(id);
        if (this.invalid.has(id)) continue;
        if (
          old &&
          ((old.datasourceLuid &&
            owner.datasourceLuid &&
            old.datasourceLuid !== owner.datasourceLuid) ||
            (old.definitionLuid &&
              owner.definitionLuid &&
              old.definitionLuid !== owner.definitionLuid))
        ) {
          this.invalidate(id);
          continue;
        }
        if (old && old.uses.length && owner.uses.length) {
          const ds = old.datasourceLuid ?? owner.datasourceLuid;
          const selectors = (uses: PulseFieldUse[]): string =>
            JSON.stringify(
              [
                ...new Set(
                  uses.map((use) =>
                    JSON.stringify([
                      use.datasourceLuid ?? ds,
                      use.selector,
                      use.role,
                      use.aggregation,
                      use.operator,
                      use.values,
                    ]),
                  ),
                ),
              ].sort(),
            );
          if (selectors(old.uses) !== selectors(owner.uses)) {
            this.invalidate(id);
            continue;
          }
        }
        this.projectedBytes += Buffer.byteLength(JSON.stringify(owner));
        this.projectedUses += owner.uses.length;
        if (
          this.owners.size >= 5000 ||
          this.projectedUses > 5000 ||
          this.projectedBytes > 8 * 1024 * 1024
        ) {
          this.stopped = true;
          this.traversal.truncate('PULSE_CONTENT_LIMIT');
          this.gap(
            'PULSE_CONTENT_LIMIT',
            'Pulse metadata reached the request-local content limit.',
          );
          break;
        }
        if (old) {
          old.datasourceLuid ??= owner.datasourceLuid;
          old.definitionLuid ??= owner.definitionLuid;
          old.opaque ||= owner.opaque;
          const paths = new Set(old.uses.map((use) => use.path));
          old.uses.push(...owner.uses.filter((use) => !paths.has(use.path)));
        } else this.owners.set(id, owner);
      }
      return page;
    } catch {
      this.dependencies.signal.throwIfAborted();
      this.gap(
        'PULSE_UNAVAILABLE',
        'Pulse metadata was denied, unavailable, unsupported or invalid. Existing lineage is retained.',
      );
      return undefined;
    }
  }

  private async pages(
    request: Extract<PulseLineageRequest, { kind: 'definitions' | 'metrics' }>,
    consume: (page: PulseLineagePage) => Promise<void>,
  ): Promise<void> {
    const seen = new Set<string>(),
      ids = new Set<string>();
    let current = request;
    for (;;) {
      const page = await this.read(current);
      if (!page) return;
      page.owners
        .filter(
          (owner) =>
            owner.kind === (request.kind === 'definitions' ? 'pulse-definition' : 'pulse-metric'),
        )
        .forEach((owner) => ids.add(identity(owner)));
      await consume(page);
      if (this.stopped) return;
      if (!page.nextPageToken) {
        if (page.totalAvailable !== undefined && page.totalAvailable > ids.size)
          this.gap(
            'PULSE_LIST_PARTIAL',
            'Pulse reported more configuration than the completed listing returned.',
          );
        return;
      }
      if (seen.has(page.nextPageToken)) {
        this.gap('PULSE_CURSOR_INVALID', 'Pulse pagination did not make verifiable progress.');
        return;
      }
      seen.add(page.nextPageToken);
      current = { ...request, after: page.nextPageToken };
    }
  }

  private async ownerScope(owner: PulseLineageOwner): Promise<string | undefined> {
    const parent = owner.definitionLuid
      ? this.owners.get(`pulse:definition:${owner.definitionLuid}`)
      : undefined;
    const ds = owner.datasourceLuid ?? parent?.datasourceLuid;
    if (
      this.invalid.has(identity(owner)) ||
      (parent && this.invalid.has(identity(parent))) ||
      !(await this.permitted(ds))
    )
      return undefined;
    return ds;
  }

  private async node(owner: PulseLineageOwner, depth: number): Promise<LineageNode | undefined> {
    if (depth > this.traversal.options.maxDepth) {
      this.traversal.truncate('DEPTH_LIMIT');
      return undefined;
    }
    const ds = await this.ownerScope(owner);
    if (!ds) return undefined;
    const id = identity(owner),
      existing = this.graph.nodes.find((node) => node.id === id);
    this.depths.set(id, Math.min(this.depths.get(id) ?? Infinity, depth));
    if (existing) return existing;
    if (this.graph.nodes.length >= this.traversal.options.maxNodes) {
      this.traversal.truncate('NODE_LIMIT');
      this.gap('PULSE_NODE_LIMIT', 'Pulse targets exceed the graph node limit.');
      return undefined;
    }
    const node: LineageNode = {
      id,
      kind: owner.kind,
      luid: owner.luid,
      name: owner.name,
      pulse: { datasourceLuid: ds },
      documentPath: owner.path,
    };
    this.graph.nodes.push(node);
    if (owner.opaque)
      this.gap(
        'PULSE_OPAQUE_SPECIFICATION',
        'Opaque Pulse visualization specifications are not interpreted as field references.',
        id,
      );
    return node;
  }

  private edge(
    from: string,
    to: string,
    relationship: string,
    evidence: 'direct' | 'possible',
    path: string,
  ): void {
    if (
      !this.graph.nodes.some((node) => node.id === from) ||
      !this.graph.nodes.some((node) => node.id === to)
    )
      return;
    const id = JSON.stringify(['pulse-rest', from, to, relationship, path]);
    if (this.edgeIds.has(id)) return;
    if (this.graph.edges.length >= this.traversal.options.maxEdges) {
      this.traversal.truncate('EDGE_LIMIT');
      this.gap('PULSE_EDGE_LIMIT', 'Pulse references exceed the graph edge limit.');
      return;
    }
    this.edgeIds.add(id);
    this.graph.edges.push({
      id,
      from,
      to,
      relationship,
      evidence,
      provenance: 'pulse-rest',
      propagates: true,
      documentPath: path,
    });
  }

  private async uses(owner: PulseLineageOwner): Promise<PulseFieldUse[]> {
    const scope = await this.ownerScope(owner);
    if (!scope) return [];
    const uses: PulseFieldUse[] = [];
    for (const use of owner.uses) {
      const ds = use.datasourceLuid ?? scope;
      if (await this.permitted(ds)) uses.push({ ...use, datasourceLuid: ds });
      else
        this.gap(
          'PULSE_REFERENCE_FILTERED',
          'A Pulse reference has no permitted, verifiable datasource scope.',
        );
    }
    return uses;
  }

  private async field(use: PulseFieldUse): Promise<LineageWireNode | undefined> {
    if (!this.dependencies.metadataEnabled || !use.datasourceLuid) return undefined;
    const key = JSON.stringify([use.datasourceLuid, use.selector]);
    if (!this.bindings.has(key))
      this.bindings.set(key, this.traversal.lookupPulseField(use.datasourceLuid, use.selector));
    return this.bindings.get(key)!;
  }

  private detail(ownerId: string): NonNullable<DataLineageResult['pulseDetails']>[number] {
    this.graph.pulseDetails ??= [];
    let detail = this.graph.pulseDetails.find((detail) => detail.ownerId === ownerId);
    if (!detail) {
      detail = { ownerId, uses: [] };
      this.graph.pulseDetails.push(detail);
    }
    return detail;
  }

  private async upstream(owner: PulseLineageOwner, depth: number): Promise<void> {
    const node = await this.node(owner, depth);
    if (!node) return;
    for (const use of await this.uses(owner)) {
      if (depth >= this.traversal.options.maxDepth) {
        this.traversal.truncate('DEPTH_LIMIT');
        break;
      }
      const wire = await this.field(use);
      const field = wire ? await this.traversal.seedPulseField(wire, depth + 1) : undefined;
      this.detail(node.id).uses.push({
        ...use,
        ...(field ? { fieldId: field.id } : {}),
        status: field ? 'resolved' : 'unresolved',
      });
      if (field) this.edge(field.id, node.id, 'scoped-api-field-reference', use.evidence, use.path);
      else
        this.gap(
          'PULSE_FIELD_UNRESOLVED',
          'A Pulse selector could not be resolved uniquely in its permitted published datasource.',
          node.id,
        );
    }
  }

  private link(parent: PulseLineageOwner, child: PulseLineageOwner): void {
    if (child.definitionLuid !== parent.luid) return;
    const metric = this.graph.nodes.find((node) => node.id === identity(child));
    if (metric?.pulse) metric.pulse.definitionLuid = parent.luid;
    this.edge(
      identity(parent),
      identity(child),
      'definition-instantiated-as-metric',
      'direct',
      `${child.path}/definition_id`,
    );
  }

  private async children(
    parent: PulseLineageOwner,
    consume: (child: PulseLineageOwner) => Promise<void>,
  ): Promise<void> {
    const seen = new Set<string>();
    const process = async (children: PulseLineageOwner[], strict = false): Promise<void> => {
      for (const child of children) {
        const id = identity(child);
        if (strict && child.kind === 'pulse-metric' && child.definitionLuid !== parent.luid) {
          this.gap(
            'PULSE_METRIC_OWNER_MISMATCH',
            'A listed metric did not confirm the requested definition owner.',
          );
          continue;
        }
        if (child.kind !== 'pulse-metric' || child.definitionLuid !== parent.luid || seen.has(id))
          continue;
        seen.add(id);
        const current = this.owners.get(id);
        if (current && !this.invalid.has(id)) await consume(current);
      }
    };
    await this.pages(
      { kind: 'metrics', definitionId: parent.luid, pageSize: this.traversal.options.pageSize },
      (page) => process(page.owners, true),
    );
    await process([...this.owners.values()]);
  }

  async resolveSource(): Promise<void> {
    const source = this.traversal.options.source;
    if (source.type !== 'pulse-definition' && source.type !== 'pulse-metric') return;
    this.graph.coverage.pulse = 'unavailable';
    this.graph.coverage.metadata = this.dependencies.metadataEnabled
      ? 'not-requested'
      : 'unavailable';
    this.graph.coverage.permissionMode = 'NOT_REQUESTED';
    const page = await this.read(
      source.type === 'pulse-definition'
        ? { kind: 'definitions', id: source.luid }
        : { kind: 'metric', id: source.luid },
    );
    if (!page) {
      this.graph.resolution = 'unavailable';
      return;
    }
    const owner = this.owners.get(identity({ kind: source.type, luid: source.luid }));
    if (!owner) {
      this.graph.resolution = page.rowCount ? 'unavailable' : 'not-found';
      return;
    }
    let parent: PulseLineageOwner | undefined;
    if (
      owner.kind === 'pulse-metric' &&
      owner.definitionLuid &&
      (!owner.datasourceLuid || this.traversal.options.direction !== 'downstream')
    ) {
      await this.read({ kind: 'definitions', id: owner.definitionLuid });
      parent = this.owners.get(`pulse:definition:${owner.definitionLuid}`);
    }
    const root = await this.node(owner, 0);
    if (!root) {
      this.graph.resolution = 'not-allowed';
      return;
    }
    this.graph.resolution = 'resolved';
    this.graph.sourceId = root.id;
    if (this.traversal.options.direction !== 'downstream') {
      await this.upstream(owner, 0);
      if (parent && (await this.node(parent, 1))) {
        this.link(parent, owner);
        await this.upstream(parent, 1);
      }
    }
    if (owner.kind === 'pulse-definition' && this.traversal.options.direction !== 'upstream')
      await this.children(owner, async (child) => {
        if (await this.node(child, 1)) this.link(owner, child);
      });
  }

  async enrich(): Promise<void> {
    if (this.graph.direction === 'upstream') {
      this.graph.coverage.pulse = 'not-requested';
      return;
    }
    this.graph.coverage.pulse = 'visible-subgraph';
    const distances = pulseDownstreamContexts(this.graph);
    const contexts = this.traversal
      .pulseContexts()
      .filter(
        (context) =>
          distances.has(context.nodeId) &&
          distances.get(context.nodeId)! < this.traversal.options.maxDepth,
      );
    if (!contexts.length) {
      this.gap(
        'PULSE_CONTEXT_UNRESOLVED',
        'The selected graph has no expandable published field/datasource context; Pulse usage remains unverified.',
      );
      return;
    }
    const scopes = new Set(contexts.map((context) => context.datasourceLuid));
    const fields = new Map(
      contexts
        .filter((context) => context.kind === 'field')
        .map((context) => [context.nodeId, context]),
    );
    const datasources = new Map(
      contexts
        .filter((context) => context.kind === 'datasource')
        .map((context) => [context.datasourceLuid, context]),
    );
    const bind = async (owner: PulseLineageOwner): Promise<void> => {
      const uses = await this.uses(owner);
      const resolved: Array<{ use: PulseFieldUse; fieldId: string; depth: number }> = [];
      for (const use of uses) {
        if (!use.datasourceLuid || !scopes.has(use.datasourceLuid)) continue;
        const candidates = this.graph.nodes.filter(
          (node) =>
            fields.has(node.id) &&
            node.name === use.selector &&
            fields.get(node.id)!.datasourceLuid === use.datasourceLuid,
        );
        if (!candidates.length) continue;
        const wire = await this.field(use);
        if (wire && fields.has(`metadata:${wire.id}`)) {
          const fieldId = `metadata:${wire.id}`;
          resolved.push({ use, fieldId, depth: distances.get(fieldId)! + 1 });
        } else
          this.gap(
            'PULSE_FIELD_UNRESOLVED',
            'A relevant Pulse selector has no unique complete catalog-field binding.',
          );
      }
      const ds = await this.ownerScope(owner),
        dsContext = ds ? datasources.get(ds) : undefined;
      const parentDepth = owner.definitionLuid
        ? this.depths.get(`pulse:definition:${owner.definitionLuid}`)
        : undefined;
      const depth = Math.min(
        ...resolved.map((row) => row.depth),
        dsContext ? distances.get(dsContext.nodeId)! + 1 : Infinity,
        parentDepth !== undefined ? parentDepth + 1 : Infinity,
      );
      if (!Number.isFinite(depth)) return;
      const node = await this.node(owner, depth);
      if (!node) return;
      if (dsContext)
        this.edge(
          dsContext.nodeId,
          node.id,
          'pulse-datasource-reference',
          'direct',
          `${owner.path}/${owner.kind === 'pulse-definition' ? 'specification/datasource/id' : 'datasource_luid'}`,
        );
      for (const row of resolved)
        if (row.depth <= this.traversal.options.maxDepth)
          this.edge(
            row.fieldId,
            node.id,
            'scoped-api-field-reference',
            row.use.evidence,
            row.use.path,
          );
      const detail = this.detail(node.id);
      for (const use of uses) {
        const binding = resolved.find((row) => row.use.path === use.path);
        if (!detail.uses.some((old) => old.path === use.path))
          detail.uses.push({
            ...use,
            ...(binding ? { fieldId: binding.fieldId } : {}),
            status: binding ? 'resolved' : 'not-requested',
          });
      }
      const parent = owner.definitionLuid
        ? this.owners.get(`pulse:definition:${owner.definitionLuid}`)
        : undefined;
      if (parent && this.graph.nodes.some((node) => node.id === identity(parent)))
        this.link(parent, owner);
    };
    const visitedDefinitions = new Set<string>();
    await this.pages(
      { kind: 'definitions', pageSize: this.traversal.options.pageSize },
      async (page) => {
        for (const candidate of page.owners) {
          if (candidate.kind !== 'pulse-definition') continue;
          const owner = this.owners.get(identity(candidate));
          if (
            !owner ||
            this.invalid.has(identity(owner)) ||
            visitedDefinitions.has(identity(owner))
          )
            continue;
          visitedDefinitions.add(identity(owner));
          const ds = await this.ownerScope(owner),
            uses = await this.uses(owner);
          if (
            !ds ||
            (!scopes.has(ds) &&
              !uses.some((use) => use.datasourceLuid && scopes.has(use.datasourceLuid)))
          )
            continue;
          await bind(owner);
          await this.children(owner, bind);
        }
      },
    );
  }
}
