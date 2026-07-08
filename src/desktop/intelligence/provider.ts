// src/desktop/intelligence/provider.ts
//
// AuthoringIntelligenceProvider — the named seam through which the authoring
// binder obtains its content (Lane M3 milestone 1). The freshness decision
// (staged D→B) is: milestone 1 ships a BUNDLED snapshot behind this seam plus a
// generated content manifest. Milestone 2 (remote content-pack fetch) can later
// implement the SAME interface without touching binder callers.
//
// MILESTONE 2 (Lane M6): the remote content-pack provider is skeletoned in
// remoteProvider.ts / contentPack.ts / packVerification.ts / packCache.ts / factory.ts,
// implementing THIS interface behind an injected transport + clock (no network I/O yet).
// See docs/authoring-content-pack.md for the pack contract and fallback ladder.
//
// SEAM CHOICE (documented): the provider WRAPS the existing `loadManifests()`
// loader rather than the reverse. `loadManifests()` has many callers (binder,
// classify, memo, prewarm, the bind-template tool, tests); making it depend on a
// provider would touch all of them. Wrapping it here changes ZERO existing callers
// while giving future milestones a single place to swap the content source.
//
// HONESTY: `getStatus().freshness` is 'bundled-snapshot' and
// `satisfies_exec_freshness` is false — a bundled snapshot does NOT yet satisfy the
// executive freshness requirement (no remote fetch). The status says so explicitly.
//
// Milestone-1 surface ONLY: getStatus / getContentManifest / listTemplateManifests /
// getTemplateManifest / getTemplateXmlFragment. Knowledge / dashboards / prefabs
// methods arrive in a later milestone and are intentionally NOT stubbed here.

import { readDataAsset } from '../assets.js';
import { CONTENT_MANIFEST_PATH, loadManifests } from '../binder/manifest.js';
import type { TemplateManifest } from '../binder/manifest-types.js';

/**
 * How this provider serves content. `'bundled'` = the in-package snapshot;
 * `'remote-pack'` = a verified milestone-2 content pack (see remoteProvider.ts).
 * Widened for milestone 2 — the bundled provider still only ever reports `'bundled'`.
 */
export type ProviderKind = 'bundled' | 'remote-pack';

/**
 * Freshness posture of the served content. `'remote-pack-fresh'` = a verified pack
 * within its TTL (the only state that satisfies exec freshness); `'remote-pack-stale'`
 * = a verified pack past its TTL served with an honest stale flag.
 */
export type Freshness = 'bundled-snapshot' | 'remote-pack-fresh' | 'remote-pack-stale';

/**
 * Why a remote provider fell back to the bundled snapshot (surfaced honestly in status).
 * Documented in docs/authoring-content-pack.md §5. Only set by RemotePackIntelligenceProvider.
 */
export type RemoteFallbackReason =
  | 'not-configured'
  | 'transport-unavailable'
  | 'no-cache'
  | 'tampered-cache'
  | 'bad-signature'
  | 'schema-too-new'
  | 'pack-format-too-new'
  | 'incompatible-engine'
  | 'malformed-pack';

/** Honest status of the content source (surfaced to callers/telemetry). */
export interface ProviderStatus {
  kind: ProviderKind;
  content_version: string;
  schema_version: string;
  /** Date-only (YYYY-MM-DD) the content was generated. */
  generated: string;
  freshness: Freshness;
  /**
   * TRUE only when a verified content pack within its TTL is the active source
   * (milestone 2). A bundled snapshot and a stale pack are both `false`.
   */
  satisfies_exec_freshness: boolean;
  note: string;
  /**
   * Remote-only: present when a content pack is the active source. `true` when the
   * pack is past its TTL (served as an honest stale fallback). Omitted by the
   * bundled provider so its serialized status is byte-identical to milestone 1.
   */
  stale?: boolean;
  /**
   * Remote-provider-only: present when the remote provider fell back to the bundled
   * snapshot, naming why. Omitted by the bundled provider.
   */
  fallback?: RemoteFallbackReason;
}

/** One hashed bundled resource. */
export interface ContentResource {
  path: string;
  sha256: string;
  bytes: number;
}

/** Compatibility range for the engine that consumes this content. */
export interface EngineCompat {
  server_min: string;
  node: string;
}

/** The generated content manifest served verbatim (minus the `_generated` markers). */
export interface ContentManifest {
  content_version: string;
  schema_version: string;
  generated: string;
  engine_compat: EngineCompat;
  resources: ContentResource[];
}

/**
 * The content seam for authoring. A bundled implementation reads the in-package
 * snapshot; a future remote implementation can fetch content packs behind the SAME
 * contract.
 */
export interface AuthoringIntelligenceProvider {
  /** Honest posture of the served content (kind, versions, freshness). */
  getStatus(): ProviderStatus;
  /** The content manifest: versions, engine-compat, and per-resource sha256. */
  getContentManifest(): ContentManifest;
  /** Every bundled template manifest. */
  listTemplateManifests(): TemplateManifest[];
  /** A single template manifest by name, or undefined if unknown. */
  getTemplateManifest(name: string): TemplateManifest | undefined;
  /**
   * The shipped worksheet-fragment XML for a template, or null when the template is
   * unknown OR is golden-only (its golden XML does not ship in-package — e.g. ww-ou).
   */
  getTemplateXmlFragment(name: string): string | null;
}

/** The generated content manifest carries `_generated`/`_generator` markers we strip. */
interface RawContentManifest extends ContentManifest {
  _generated?: boolean;
}

const FRESHNESS_NOTE =
  'Bundled in-package snapshot of authoring content. Does NOT satisfy the executive ' +
  'freshness requirement — there is no remote content-pack fetch yet (milestone 2). ' +
  'Content is only as current as the last generator run recorded in content_version.';

/**
 * Bundled provider over the in-package data (`src/desktop/data`). Wraps
 * `loadManifests()` for template data and reads the generated `content-manifest.json`
 * for versions/hashes. All resolution is package-relative via manifest.ts (no cwd
 * assumption beyond its documented fallback); no environment reads.
 */
export class BundledIntelligenceProvider implements AuthoringIntelligenceProvider {
  private contentManifestCache: ContentManifest | null = null;

  private readContentManifest(): ContentManifest {
    if (this.contentManifestCache) {
      return this.contentManifestCache;
    }
    const rawText = readDataAsset('content-manifest.json');
    if (rawText === null) {
      throw new Error(
        `content-manifest.json missing at ${CONTENT_MANIFEST_PATH} — run ` +
          '`npx tsx src/scripts/buildTemplateManifests.ts` to generate it.',
      );
    }
    const raw = JSON.parse(rawText) as RawContentManifest;
    const { content_version, schema_version, generated, engine_compat, resources } = raw;
    this.contentManifestCache = {
      content_version,
      schema_version,
      generated,
      engine_compat,
      resources,
    };
    return this.contentManifestCache;
  }

  getStatus(): ProviderStatus {
    const cm = this.readContentManifest();
    return {
      kind: 'bundled',
      content_version: cm.content_version,
      schema_version: cm.schema_version,
      generated: cm.generated,
      freshness: 'bundled-snapshot',
      satisfies_exec_freshness: false,
      note: FRESHNESS_NOTE,
    };
  }

  getContentManifest(): ContentManifest {
    return this.readContentManifest();
  }

  listTemplateManifests(): TemplateManifest[] {
    return [...loadManifests().values()];
  }

  getTemplateManifest(name: string): TemplateManifest | undefined {
    return loadManifests().get(name);
  }

  getTemplateXmlFragment(name: string): string | null {
    // Guard against path traversal: only serve XML for a KNOWN template name (the
    // manifest keys are the closed set of valid names == filenames).
    if (!loadManifests().has(name)) {
      return null;
    }
    const xml = readDataAsset(`data-visualization-templates-xml/${name}.xml`);
    if (xml === null) {
      // Golden-only templates (e.g. ww-ou-arrow/ww-ou-diff) ship a manifest but no
      // worksheet XML — their golden .twbx does not ship in-package.
      return null;
    }
    return xml;
  }
}

/** Shared bundled provider instance (stateless beyond a content-manifest cache). */
export const bundledIntelligenceProvider: AuthoringIntelligenceProvider =
  new BundledIntelligenceProvider();
