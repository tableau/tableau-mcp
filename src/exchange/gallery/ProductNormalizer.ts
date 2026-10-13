import { ExchangeAsset, ExchangeDetails, ExchangeTag } from '../types.js';
import { GalleryProduct, GalleryTag } from './galleryApiSchemas.js';

const signedKeys =
  /^(?:x-amz-.+|signature|awsaccesskeyid|access_token|token|key-pair-id|policy|sig)$/i;
const packagePath = /\.(?:tskill|trex|taco|zip|twbx?|tdsx?)(?:$|\/)/i;
const galleryArtifactPath =
  /\/(?:products|extensions|viz|connectors|submissions)\/\d+:download\b|\/products\/\d+:getdownloadurl\b/i;

function artifactPath(path: string): boolean {
  // Check escaped route separators/actions as well as ordinary Gallery paths.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (packagePath.test(path) || galleryArtifactPath.test(path)) return true;
    const decoded = path.replace(/%([\da-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (decoded === path) return false;
    path = decoded;
  }
  return true;
}

function publicUrl(value: string | null | undefined): string | undefined {
  if (!value || value.length > 8_192) return undefined;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      artifactPath(url.pathname)
    )
      return undefined;
    if ([...url.searchParams.keys()].some((key) => signedKeys.test(key))) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Catalog text stays data; strip active markup and omit artifact/signed links. */
function plainText(value: string | null | undefined): string {
  const decoded = (value ?? '')
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/gi,
      (entity) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[
          entity.toLowerCase()
        ] ?? ' ',
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const point = code.startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    });
  return decoded
    .replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => publicUrl(url) ?? '[link omitted]')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDetails(raw: GalleryProduct): ExchangeDetails | undefined {
  const details = raw.details;
  if (!details || raw.product_type === 'skill') return undefined;
  if (raw.product_type === 'connector') {
    const versionNumber = plainText(details.version_number).slice(0, 200);
    const dataSourceClass = plainText(details.data_source_class).slice(0, 200);
    const installationInstructions = plainText(details.installation_instructions).slice(0, 20_000);
    if (!versionNumber && !dataSourceClass && !installationInstructions) return undefined;
    return {
      kind: 'connector',
      ...(versionNumber ? { versionNumber } : {}),
      ...(dataSourceClass ? { dataSourceClass } : {}),
      ...(installationInstructions ? { installationInstructions } : {}),
    };
  }
  if (raw.product_type === 'accelerator') {
    const connectionTypeDisplayName = plainText(details.connection_type_display_name).slice(0, 500);
    return connectionTypeDisplayName
      ? { kind: 'accelerator', connectionTypeDisplayName }
      : undefined;
  }
  const extensionUrl = publicUrl(details.extension_url);
  const publicExamples = (details.public_examples ?? []).slice(0, 20).flatMap((example) => {
    const name = plainText(example.name).slice(0, 500);
    const url = publicUrl(example.url);
    return name && url ? [{ name, url }] : [];
  });
  return extensionUrl || publicExamples.length
    ? {
        kind: raw.product_type,
        ...(extensionUrl ? { extensionUrl } : {}),
        ...(publicExamples.length ? { publicExamples } : {}),
      }
    : undefined;
}

export function normalizeTag(tag: GalleryTag): ExchangeTag | undefined {
  const normalized = {
    id: tag.id,
    name: plainText(tag.name),
    canonicalName: plainText(tag.canonicalName),
    type: plainText(tag.type),
    applicableProductType: tag.applicableProductType,
  };
  return normalized.name && normalized.canonicalName && normalized.type ? normalized : undefined;
}

export function normalizeProduct(
  raw: GalleryProduct,
  webBaseUrl: URL,
  mode: 'summary' | 'detail',
): ExchangeAsset {
  const tags = raw.typed_tags.flatMap((tag) => {
    const normalized = normalizeTag(tag);
    return normalized ? [normalized] : [];
  });
  const uniqueTags = [...new Map(tags.map((tag) => [tag.id, tag])).values()];
  const base = new URL(webBaseUrl.href);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const listingUrl = new URL(`products/${raw.id}`, base).href;
  const detailedText = mode === 'detail' ? plainText(raw.detailed_description) : undefined;
  const details = mode === 'detail' ? normalizeDetails(raw) : undefined;
  const minimumTableauVersion = plainText(raw.minimum_tableau_version).slice(0, 100);
  const date = raw.publish_date ? new Date(raw.publish_date) : undefined;
  const publishDate = date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  const iconUrl = publicUrl(raw.product_icon_url);
  const pictureUrls = (raw.pictures ?? []).flatMap((picture) => {
    const url = publicUrl(picture);
    return url ? [url] : [];
  });
  const supportUrl = publicUrl(raw.support_url);
  const privacyPolicyUrl = publicUrl(raw.privacy_policy);
  return {
    id: raw.id,
    type: raw.product_type,
    name: plainText(raw.name),
    shortDescription: plainText(raw.short_description).slice(0, 600),
    publisher: { id: raw.publisher_id ?? null, name: plainText(raw.publisher_name) },
    tags: uniqueTags,
    listingUrl,
    communityContribution: raw.community_contribution,
    technicalMetadataStatus: details ? 'available' : 'unavailable',
    ...(minimumTableauVersion ? { minimumTableauVersion } : {}),
    ...(raw.downloads != null ? { downloads: raw.downloads } : {}),
    ...(publishDate ? { publishDate } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(pictureUrls.length ? { pictureUrls } : {}),
    ...(supportUrl ? { supportUrl } : {}),
    ...(privacyPolicyUrl ? { privacyPolicyUrl } : {}),
    ...(detailedText !== undefined
      ? {
          detailedDescription: detailedText.slice(0, 20_000),
          descriptionTruncated: detailedText.length > 20_000,
        }
      : {}),
    ...(details ? { details } : {}),
  };
}
