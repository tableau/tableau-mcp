import { randomUUID } from 'node:crypto';

import type { WorksheetApplyState } from '../metadata/targetWorksheetState.js';

export const TEMPLATE_ARTIFACT_TTL_MS = 10 * 60 * 1000;
export const MAX_TEMPLATE_ARTIFACTS = 64;

export function templateArtifactSessionIdentity(
  sessionId: string,
  desktopInstanceId: string | undefined,
): string {
  return desktopInstanceId ? `${sessionId}:${desktopInstanceId}` : sessionId;
}

export interface TemplateArtifact {
  worksheetName: string;
  worksheetXml: string;
  worksheetWindowXml: string;
  expectedState: WorksheetApplyState;
  templateProvenance: string;
  metadataTrust: 'trusted-protected-or-dev' | 'untrusted-repository';
}

interface StoredTemplateArtifact extends TemplateArtifact {
  sessionId: string | null;
  expiresAt: number;
}

export type TemplateArtifactConsumeResult =
  | { ok: true; artifact: TemplateArtifact }
  | { ok: false; reason: 'not-found' | 'expired' | 'session-mismatch' };

export class TemplateArtifactStore {
  private readonly artifacts = new Map<string, StoredTemplateArtifact>();

  constructor(
    private readonly options: {
      now?: () => number;
      createId?: () => string;
      ttlMs?: number;
      maxCount?: number;
    } = {},
  ) {}

  put(
    sessionId: string | null,
    artifact: TemplateArtifact,
  ): { artifactId: string; expiresAt: number } {
    const now = this.now();
    this.removeExpired(now);
    const maxCount = this.options.maxCount ?? MAX_TEMPLATE_ARTIFACTS;
    while (this.artifacts.size >= maxCount) {
      const oldest = this.artifacts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.artifacts.delete(oldest);
    }

    const artifactId = (this.options.createId ?? randomUUID)();
    const expiresAt = now + (this.options.ttlMs ?? TEMPLATE_ARTIFACT_TTL_MS);
    this.artifacts.set(artifactId, {
      sessionId,
      expiresAt,
      worksheetName: artifact.worksheetName,
      worksheetXml: artifact.worksheetXml,
      worksheetWindowXml: artifact.worksheetWindowXml,
      expectedState: structuredClone(artifact.expectedState),
      templateProvenance: artifact.templateProvenance,
      metadataTrust: artifact.metadataTrust,
    });
    return { artifactId, expiresAt };
  }

  consume(artifactId: string, sessionId: string): TemplateArtifactConsumeResult {
    const stored = this.artifacts.get(artifactId);
    if (!stored) return { ok: false, reason: 'not-found' };
    if (stored.expiresAt <= this.now()) {
      this.artifacts.delete(artifactId);
      return { ok: false, reason: 'expired' };
    }
    if (stored.sessionId !== null && stored.sessionId !== sessionId) {
      return { ok: false, reason: 'session-mismatch' };
    }

    this.artifacts.delete(artifactId);
    return {
      ok: true,
      artifact: {
        worksheetName: stored.worksheetName,
        worksheetXml: stored.worksheetXml,
        worksheetWindowXml: stored.worksheetWindowXml,
        expectedState: structuredClone(stored.expectedState),
        templateProvenance: stored.templateProvenance,
        metadataTrust: stored.metadataTrust,
      },
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private removeExpired(now: number): void {
    for (const [artifactId, artifact] of this.artifacts) {
      if (artifact.expiresAt <= now) this.artifacts.delete(artifactId);
    }
  }
}

const stores = new WeakMap<object, TemplateArtifactStore>();

export function getTemplateArtifactStore(owner: object): TemplateArtifactStore {
  let store = stores.get(owner);
  if (!store) {
    store = new TemplateArtifactStore();
    stores.set(owner, store);
  }
  return store;
}

export function setTemplateArtifactStoreForTests(
  owner: object,
  store: TemplateArtifactStore,
): void {
  stores.set(owner, store);
}
