import type { TargetWorksheetState } from '../metadata/targetWorksheetState.js';

export interface TemplateWorksheetArtifact {
  id: string;
  sessionId: string;
  instanceId: string;
  templateName: string;
  templateSourceHash: string;
  title: string;
  datasource: string;
  fieldMapping: Record<string, string>;
  worksheetXml: string;
  windowXml: string;
  targetState: TargetWorksheetState;
}

export interface TemplateArtifactLease {
  artifactId: string;
  token: string;
}

export type TemplateArtifactUnavailableReason =
  | 'evicted'
  | 'consumed'
  | 'in-use'
  | 'session-mismatch'
  | 'unknown';

export type TemplateArtifactReserveResult =
  | { ok: true; artifact: Readonly<TemplateWorksheetArtifact>; lease: TemplateArtifactLease }
  | { ok: false; reason: TemplateArtifactUnavailableReason };

interface StoredArtifact {
  artifact: Readonly<TemplateWorksheetArtifact>;
  lastUsed: number;
  leaseToken?: string;
}

function cloneAndFreeze<T>(value: T): Readonly<T> {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(clone);
  return clone;
}

export class TemplateArtifactStore {
  private readonly entries = new Map<string, StoredArtifact>();
  private readonly tombstones = new Map<string, 'evicted' | 'consumed'>();
  private sequence = 0;
  private leaseSequence = 0;
  private readonly capacity: number;
  private readonly tombstoneCapacity: number;

  constructor({ capacity = 64, tombstoneCapacity = 128 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Template artifact capacity must be a positive integer.');
    }
    if (!Number.isInteger(tombstoneCapacity) || tombstoneCapacity < 1) {
      throw new Error('Template artifact tombstone capacity must be a positive integer.');
    }
    this.capacity = capacity;
    this.tombstoneCapacity = tombstoneCapacity;
  }

  put(
    artifact: TemplateWorksheetArtifact,
  ): { ok: true } | { ok: false; reason: 'capacity-in-use' } {
    if (this.entries.has(artifact.id)) {
      throw new Error(`Template artifact "${artifact.id}" already exists.`);
    }
    if (this.entries.size >= this.capacity && !this.evictLeastRecentlyUsedAvailable()) {
      return { ok: false, reason: 'capacity-in-use' };
    }
    this.tombstones.delete(artifact.id);
    this.entries.set(artifact.id, {
      artifact: cloneAndFreeze(artifact),
      lastUsed: ++this.sequence,
    });
    return { ok: true };
  }

  reserve(artifactId: string, sessionId: string): TemplateArtifactReserveResult {
    const entry = this.entries.get(artifactId);
    if (!entry) {
      return { ok: false, reason: this.tombstones.get(artifactId) ?? 'unknown' };
    }
    if (entry.artifact.sessionId !== sessionId) {
      return { ok: false, reason: 'session-mismatch' };
    }
    if (entry.leaseToken) return { ok: false, reason: 'in-use' };

    entry.lastUsed = ++this.sequence;
    entry.leaseToken = `${artifactId}:${++this.leaseSequence}`;
    return {
      ok: true,
      artifact: entry.artifact,
      lease: { artifactId, token: entry.leaseToken },
    };
  }

  release(lease: TemplateArtifactLease): boolean {
    const entry = this.entries.get(lease.artifactId);
    if (!entry || entry.leaseToken !== lease.token) return false;
    delete entry.leaseToken;
    entry.lastUsed = ++this.sequence;
    return true;
  }

  consume(lease: TemplateArtifactLease): boolean {
    const entry = this.entries.get(lease.artifactId);
    if (!entry || entry.leaseToken !== lease.token) return false;
    this.entries.delete(lease.artifactId);
    this.addTombstone(lease.artifactId, 'consumed');
    return true;
  }

  private evictLeastRecentlyUsedAvailable(): boolean {
    let candidate: [string, StoredArtifact] | undefined;
    for (const entry of this.entries) {
      if (entry[1].leaseToken) continue;
      if (!candidate || entry[1].lastUsed < candidate[1].lastUsed) candidate = entry;
    }
    if (!candidate) return false;
    this.entries.delete(candidate[0]);
    this.addTombstone(candidate[0], 'evicted');
    return true;
  }

  private addTombstone(artifactId: string, reason: 'evicted' | 'consumed'): void {
    this.tombstones.delete(artifactId);
    this.tombstones.set(artifactId, reason);
    while (this.tombstones.size > this.tombstoneCapacity) {
      const oldest = this.tombstones.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.tombstones.delete(oldest);
    }
  }
}

const STORES_BY_OWNER = new WeakMap<object, TemplateArtifactStore>();

export function getTemplateArtifactStore(owner: object): TemplateArtifactStore {
  let store = STORES_BY_OWNER.get(owner);
  if (!store) {
    store = new TemplateArtifactStore();
    STORES_BY_OWNER.set(owner, store);
  }
  return store;
}
