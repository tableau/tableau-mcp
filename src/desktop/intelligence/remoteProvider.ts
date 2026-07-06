// src/desktop/intelligence/remoteProvider.ts
//
// RemotePackIntelligenceProvider (Lane M6 milestone-2 skeleton — NO network I/O).
// Implements the SAME `AuthoringIntelligenceProvider` interface as the bundled provider,
// behind an injected transport + clock + store + verifier + bundled fallback. Resolution
// is fully SYNCHRONOUS (over the injected store) so it fits the sync provider interface;
// the only async surface is `refresh()`, which is the seam for the REAL fetch transport
// that lands later. `refresh()` VERIFIES the signed manifest in full (funnel steps 1–5,
// signature included) BEFORE it fetches any declared resources, so an unverified/forged
// manifest can never drive the transport to pull arbitrary bytes. With the shipped
// `NotConfiguredTransport`, `refresh()` performs no network I/O and leaves the bundled
// fallback in place.
//
// Fallback ladder (docs/authoring-content-pack.md §5), evaluated on EVERY load
// (construction + reload + successful refresh) so a tampered cache is caught late:
//   verified fresh pack → verified stale pack (honest stale flag) → bundled snapshot.
// Never a broken half-state: content is served WHOLLY from a verified pack or WHOLLY
// from the bundled snapshot; a pack that verifies but cannot materialize drops to bundled.

import { Err, Ok, type Result } from 'ts-results-es';

import { validateManifest } from '../binder/manifest.js';
import type { TemplateManifest } from '../binder/manifest-types.js';
import type { PackManifest, SignedPackManifest } from './contentPack.js';
import { evaluateCachedPack, type PackStore } from './packCache.js';
import {
  type CachedPack,
  type EngineInfo,
  type PackRejectionReason,
  type SignatureVerifier,
  type VerifiedPack,
  verifyPack,
  verifyPackManifest,
} from './packVerification.js';
import type {
  AuthoringIntelligenceProvider,
  ContentManifest,
  ProviderStatus,
  RemoteFallbackReason,
} from './provider.js';

/** Injected time source (so TTL logic is deterministic in tests). */
export interface Clock {
  now(): Date;
}

/** Real wall-clock. */
export const systemClock: Clock = { now: () => new Date() };

/** A typed "the transport can't serve" result — never thrown, always returned. */
export interface PackTransportUnavailable {
  reason: 'not-configured' | 'transport-unavailable';
  detail: string;
}

/**
 * The remote fetch seam. NO real implementation ships in this lane — the hosting
 * endpoint is an open question (docs §7). `fetchManifest` returns the signed pack
 * manifest; `fetchPack` returns the resource bytes for a manifest.
 */
export interface PackTransport {
  fetchManifest(): Promise<Result<SignedPackManifest, PackTransportUnavailable>>;
  fetchPack(
    manifest: PackManifest,
  ): Promise<Result<Record<string, string>, PackTransportUnavailable>>;
}

/** The shipped default transport: always unavailable (no network, no hosting decided). */
export class NotConfiguredTransport implements PackTransport {
  fetchManifest(): Promise<Result<SignedPackManifest, PackTransportUnavailable>> {
    return Promise.resolve(
      new Err({
        reason: 'not-configured',
        detail: 'no pack transport configured — hosting endpoint is an open question (docs §7)',
      }),
    );
  }

  fetchPack(
    _manifest: PackManifest,
  ): Promise<Result<Record<string, string>, PackTransportUnavailable>> {
    return Promise.resolve(
      new Err({ reason: 'not-configured', detail: 'no pack transport configured' }),
    );
  }
}

/** The served content of a verified pack, materialized into the provider's surface shape. */
export interface MaterializedPackSource {
  contentManifest: ContentManifest;
  templateManifests: Map<string, TemplateManifest>;
  xmlFragments: Map<string, string>;
}

const TM_PREFIX = 'template-manifests/';
const TM_SUFFIX = '.manifest.json';
const XML_PREFIX = 'data-visualization-templates-xml/';
const XML_SUFFIX = '.xml';

/**
 * Materialize a verified pack's bytes into the served surface. All-or-nothing: any
 * inner manifest that is not valid JSON / fails shape validation / disagrees with its
 * filename fails the WHOLE materialization (caller drops to bundled — never a half-state).
 * Non-manifest / non-XML resources (index, fixture) are hash-verified but not part of
 * the served surface, so they are skipped here. A pack that verifies but yields ZERO
 * template manifests is rejected (Err) rather than served as an empty template set.
 */
export function materializePackSource(
  verified: VerifiedPack,
): Result<MaterializedPackSource, string> {
  const templateManifests = new Map<string, TemplateManifest>();
  const xmlFragments = new Map<string, string>();

  for (const resource of verified.manifest.resources) {
    const p = resource.path;
    const content = verified.resources[p];
    if (content === undefined) {
      return new Err(`missing resource bytes for ${p}`);
    }
    if (p.startsWith(TM_PREFIX) && p.endsWith(TM_SUFFIX)) {
      const name = p.slice(TM_PREFIX.length, p.length - TM_SUFFIX.length);
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        return new Err(`resource ${p} is not valid JSON: ${(e as Error).message}`);
      }
      const errors = validateManifest(parsed);
      if (errors.length > 0) {
        return new Err(`resource ${p} failed manifest validation: ${errors.join('; ')}`);
      }
      const manifest = parsed as TemplateManifest;
      if (manifest.template !== name) {
        return new Err(`resource ${p}: template '${manifest.template}' != filename '${name}'`);
      }
      templateManifests.set(name, manifest);
    } else if (p.startsWith(XML_PREFIX) && p.endsWith(XML_SUFFIX)) {
      const name = p.slice(XML_PREFIX.length, p.length - XML_SUFFIX.length);
      xmlFragments.set(name, content);
    }
  }

  // A verified pack that declares ZERO template manifests would materialize an empty
  // template set yet report `remote-pack-fresh` — silent capability loss, when the
  // bundled snapshot would have been strictly better. Fail closed: the caller maps this
  // Err to the bundled fallback (`malformed-pack`), the correct fallback-ladder rung.
  if (templateManifests.size === 0) {
    return new Err('pack contains no template manifests — refusing to serve an empty template set');
  }

  const m = verified.manifest;
  const contentManifest: ContentManifest = {
    content_version: m.content_version,
    schema_version: m.schema_version,
    generated: m.generated,
    engine_compat: m.engine_compat,
    resources: m.resources,
  };
  return new Ok({ contentManifest, templateManifests, xmlFragments });
}

/** Dependencies injected into the remote provider (all seams — nothing is global). */
export interface RemoteProviderDeps {
  transport: PackTransport;
  verifier: SignatureVerifier;
  store: PackStore;
  clock: Clock;
  fallback: AuthoringIntelligenceProvider;
  engine: EngineInfo;
  ttlMs: number;
}

/** Outcome of an async `refresh()` (the transport seam). */
export type RefreshOutcome = { refreshed: true } | { refreshed: false; reason: string };

const REMOTE_FRESH_NOTE =
  'Verified remote content pack within its TTL — satisfies the executive freshness requirement.';
const REMOTE_STALE_NOTE =
  'Verified remote content pack PAST its TTL — served as an honest stale fallback; does NOT ' +
  'satisfy the executive freshness requirement. A refresh is due.';

function mapRejection(reason: PackRejectionReason): RemoteFallbackReason {
  switch (reason) {
    case 'malformed':
      return 'malformed-pack';
    case 'schema-too-new':
      return 'schema-too-new';
    case 'pack-format-too-new':
      return 'pack-format-too-new';
    case 'incompatible-engine':
      return 'incompatible-engine';
    case 'bad-signature':
      return 'bad-signature';
    case 'tampered':
      return 'tampered-cache';
  }
}

/** The resolved active content source: either a materialized pack or the bundled fallback. */
interface ActiveSource {
  status: ProviderStatus;
  getContentManifest(): ContentManifest;
  listTemplateManifests(): TemplateManifest[];
  getTemplateManifest(name: string): TemplateManifest | undefined;
  getTemplateXmlFragment(name: string): string | null;
}

export class RemotePackIntelligenceProvider implements AuthoringIntelligenceProvider {
  private active: ActiveSource;

  constructor(private readonly deps: RemoteProviderDeps) {
    this.active = this.resolveActiveSource();
  }

  /** Re-resolve from the store (re-verifying integrity). Cheap; no network. */
  reload(): void {
    this.active = this.resolveActiveSource();
  }

  getStatus(): ProviderStatus {
    return this.active.status;
  }

  getContentManifest(): ContentManifest {
    return this.active.getContentManifest();
  }

  listTemplateManifests(): TemplateManifest[] {
    return this.active.listTemplateManifests();
  }

  getTemplateManifest(name: string): TemplateManifest | undefined {
    return this.active.getTemplateManifest(name);
  }

  getTemplateXmlFragment(name: string): string | null {
    return this.active.getTemplateXmlFragment(name);
  }

  /**
   * The async fetch seam. Fetch the signed manifest, VERIFY it in full (funnel steps
   * 1–5: parse + schema/pack-format/engine gates + signature over the canonical bytes)
   * BEFORE fetching any resources, then fetch the pack for the VERIFIED manifest,
   * hash-verify the fetched bytes (defense-in-depth: re-run the whole funnel), store,
   * and re-resolve. Verifying the manifest first means a future real transport is never
   * driven to pull arbitrary resources declared by an unverified/forged manifest. With
   * `NotConfiguredTransport` this is a no-op that reports `not-configured` and leaves
   * the bundled fallback in place (NO network).
   */
  async refresh(): Promise<RefreshOutcome> {
    const manifestResult = await this.deps.transport.fetchManifest();
    if (manifestResult.isErr()) {
      return { refreshed: false, reason: manifestResult.error.reason };
    }
    const signedManifest = manifestResult.value;

    // Funnel steps 1–5 FIRST — the manifest's signature must cover its canonical bytes
    // before we trust it to name the resources we fetch next. No resource I/O yet.
    const verifiedManifest = verifyPackManifest(signedManifest, {
      verifier: this.deps.verifier,
      engine: this.deps.engine,
    });
    if (verifiedManifest.isErr()) {
      return { refreshed: false, reason: verifiedManifest.error.reason };
    }

    const resourcesResult = await this.deps.transport.fetchPack(verifiedManifest.value);
    if (resourcesResult.isErr()) {
      return { refreshed: false, reason: resourcesResult.error.reason };
    }
    const cached: CachedPack = {
      signedManifest,
      resources: resourcesResult.value,
      fetched_at: this.deps.clock.now().toISOString(),
    };
    // Defense-in-depth: re-run the WHOLE funnel (steps 1–7) so the sha256 + fetched_at
    // gates cover the just-fetched bytes before we persist or serve them.
    const verified = verifyPack(cached, { verifier: this.deps.verifier, engine: this.deps.engine });
    if (verified.isErr()) {
      return { refreshed: false, reason: verified.error.reason };
    }
    this.deps.store.write(cached);
    this.active = this.resolveActiveSource();
    return { refreshed: true };
  }

  private resolveActiveSource(): ActiveSource {
    const cached = this.deps.store.read();
    const state = evaluateCachedPack(cached, {
      now: this.deps.clock.now(),
      ttlMs: this.deps.ttlMs,
      verifier: this.deps.verifier,
      engine: this.deps.engine,
    });
    switch (state.state) {
      case 'absent':
        return this.bundledActive('no-cache', 'no cached pack present');
      case 'rejected':
        return this.bundledActive(mapRejection(state.reason), state.detail);
      case 'fresh':
      case 'stale': {
        const materialized = materializePackSource(state.pack);
        if (materialized.isErr()) {
          return this.bundledActive('malformed-pack', materialized.error);
        }
        return this.remotePackActive(materialized.value, state.state === 'stale');
      }
    }
  }

  private bundledActive(reason: RemoteFallbackReason, detail: string): ActiveSource {
    const fb = this.deps.fallback;
    const base = fb.getStatus();
    const status: ProviderStatus = {
      ...base,
      fallback: reason,
      note: `${base.note} [remote provider fell back to the bundled snapshot — ${reason}: ${detail}]`,
    };
    return {
      status,
      getContentManifest: () => fb.getContentManifest(),
      listTemplateManifests: () => fb.listTemplateManifests(),
      getTemplateManifest: (n) => fb.getTemplateManifest(n),
      getTemplateXmlFragment: (n) => fb.getTemplateXmlFragment(n),
    };
  }

  private remotePackActive(source: MaterializedPackSource, stale: boolean): ActiveSource {
    const cm = source.contentManifest;
    const status: ProviderStatus = {
      kind: 'remote-pack',
      content_version: cm.content_version,
      schema_version: cm.schema_version,
      generated: cm.generated,
      freshness: stale ? 'remote-pack-stale' : 'remote-pack-fresh',
      satisfies_exec_freshness: !stale,
      stale,
      note: stale ? REMOTE_STALE_NOTE : REMOTE_FRESH_NOTE,
    };
    return {
      status,
      getContentManifest: () => source.contentManifest,
      listTemplateManifests: () => [...source.templateManifests.values()],
      getTemplateManifest: (n) => source.templateManifests.get(n),
      getTemplateXmlFragment: (n) => {
        // Known-name guard: serve XML only for a template the pack actually carries
        // (no path traversal / fabrication). Golden-only templates have a manifest but
        // no XML → null, mirroring the bundled provider.
        if (!source.templateManifests.has(n)) return null;
        return source.xmlFragments.get(n) ?? null;
      },
    };
  }
}
