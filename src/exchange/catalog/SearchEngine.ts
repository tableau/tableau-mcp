import { ExchangeInputError } from '../../errors/mcpToolError.js';
import { AssetSearchResult, AssetType, ExchangeAsset, SearchData, SearchInput } from '../types.js';
import {
  compareReportedVersions,
  hasPhrase,
  hasToken,
  normalizeSearchText,
  searchableTokens,
  stemmedTokens,
  stemToken,
} from './searchText.js';
import { RelatedTerm, relatedTerms } from './synonyms.js';

// Below this IDF weight a token match is labelled as a common term in its reason.
const COMMON_TERM_WEIGHT = 0.5;
// Related terms score only their best field. Several related terms usually evidence the same
// concept, so each one after the best counts at a quarter, and the total is capped at one
// name-token match so a listing matching the user's own words keeps ranking above it.
const RELATED_TERMS_MAX = 20;
const ADDITIONAL_RELATED_TERM_FACTOR = 0.25;
const searchTermsCache = new WeakMap<ExchangeAsset, Set<string>>();

const MATCHED_FIELD_ORDER: Array<AssetSearchResult['matchedFields'][number]> = [
  'name',
  'description',
  'tag',
  'publisher',
  'type',
];

export class SearchEngine {
  search(assets: ExchangeAsset[], input: SearchInput, defaultLimit: number): SearchData {
    const normalizedQuery = normalizeSearchText(input.query);
    const queryTokens = searchableTokens(input.query);
    if (input.query.length > 300)
      throw new ExchangeInputError('Search query must be 300 characters or fewer.');
    if (
      input.query.trim().length > 0 &&
      (normalizedQuery.length === 0 || queryTokens.length === 0)
    ) {
      throw new ExchangeInputError('Search query must contain searchable text.');
    }

    const hasQuery = normalizedQuery.length > 0;
    const requestedTags = input.tags?.map(normalizeSearchText) ?? [];
    if (requestedTags.some((tag) => !tag))
      throw new ExchangeInputError('Every tag filter must contain searchable text.');
    if (!hasQuery && !hasMeaningfulFilter(input, requestedTags)) {
      throw new ExchangeInputError(
        'A query or at least one filter is required to browse the catalog.',
      );
    }

    const filtered = assets.filter((asset) => matchesFilters(asset, input, requestedTags));
    const related = hasQuery ? relatedTerms(normalizedQuery, queryTokens) : [];
    const weights = hasQuery
      ? tokenWeights(assets, [...queryTokens, ...related.map(({ term }) => term)])
      : new Map<string, number>();
    const ranked = hasQuery
      ? filtered.flatMap((asset) => {
          const result = scoreAsset(asset, normalizedQuery, queryTokens, related, weights);
          return result.score > 0 ? [result] : [];
        })
      : filtered.map((asset) => ({ asset, score: 0, reasons: [], matchedFields: [] }));

    ranked.sort((left, right) => {
      if (hasQuery && right.score !== left.score) return right.score - left.score;
      const downloadDifference = (right.asset.downloads ?? 0) - (left.asset.downloads ?? 0);
      if (downloadDifference !== 0) return downloadDifference;
      const leftName = normalizeSearchText(left.asset.name);
      const rightName = normalizeSearchText(right.asset.name);
      const nameDifference = leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
      return nameDifference || left.asset.id - right.asset.id;
    });

    const limit = Math.min(Math.max(input.limit ?? 5, 1), defaultLimit);
    return { results: ranked.slice(0, limit), totalMatches: ranked.length };
  }
}

function hasMeaningfulFilter(input: SearchInput, requestedTags: string[]): boolean {
  return Boolean(
    input.assetTypes?.length ||
    requestedTags.length ||
    input.publisher?.trim() ||
    input.tableauVersion?.trim() ||
    (input.communityContent && input.communityContent !== 'include'),
  );
}

function matchesFilters(
  asset: ExchangeAsset,
  input: SearchInput,
  requestedTags: string[],
): boolean {
  if (input.assetTypes?.length && !input.assetTypes.includes(asset.type)) return false;
  if (input.communityContent === 'exclude' && asset.communityContribution) return false;
  if (input.communityContent === 'only' && !asset.communityContribution) return false;

  if (
    requestedTags.length &&
    !requestedTags.every((tag) =>
      asset.tags.some((candidate) => normalizeSearchText(candidate.canonicalName) === tag),
    )
  ) {
    return false;
  }

  if (input.publisher?.trim() && !hasPhrase(asset.publisher.name, input.publisher)) return false;
  if (input.tableauVersion?.trim()) {
    if (!asset.minimumTableauVersion) return false;
    const versionComparison = compareReportedVersions(
      asset.minimumTableauVersion,
      input.tableauVersion,
    );
    if (versionComparison === null || versionComparison > 0) return false;
  }
  return true;
}

function searchTerms(asset: ExchangeAsset): Set<string> {
  let terms = searchTermsCache.get(asset);
  if (!terms) {
    const tagText = asset.tags.flatMap((tag) => [tag.name, tag.canonicalName]);
    terms = new Set(stemmedTokens([asset.name, asset.shortDescription, ...tagText].join(' ')));
    searchTermsCache.set(asset, terms);
  }
  return terms;
}

/**
 * BM25-style IDF over the whole catalog, normalized so a token unique to one listing weighs 1.
 * Words such as "data" or "salesforce" appear on hundreds of listings and would otherwise
 * score as much as a distinctive word such as "sankey".
 */
function tokenWeights(assets: ExchangeAsset[], queryTokens: string[]): Map<string, number> {
  const count = assets.length;
  const idf = (frequency: number): number =>
    Math.log((count - frequency + 0.5) / (frequency + 0.5) + 1);
  return new Map(
    queryTokens.map((token) => {
      const stem = stemToken(token);
      const frequency = assets.filter((asset) => searchTerms(asset).has(stem)).length;
      return [token, frequency <= 1 ? 1 : idf(frequency) / idf(1)];
    }),
  );
}

function scoreAsset(
  asset: ExchangeAsset,
  normalizedQuery: string,
  queryTokens: string[],
  related: RelatedTerm[],
  weights: Map<string, number>,
): AssetSearchResult {
  const reasons: string[] = [];
  const matched = new Set<AssetSearchResult['matchedFields'][number]>();
  let score = 0;
  const name = normalizeSearchText(asset.name);
  const description = asset.shortDescription;
  const tags = asset.tags.flatMap((tag) => [tag.name, tag.canonicalName]);

  if (name === normalizedQuery) {
    score += 120;
    reasons.push('Exact name match');
    matched.add('name');
  }
  if (hasPhrase(asset.name, normalizedQuery)) {
    score += 80;
    reasons.push('Name phrase match');
    matched.add('name');
  }
  if (tags.some((tag) => normalizeSearchText(tag) === normalizedQuery)) {
    score += 60;
    reasons.push('Tag phrase match');
    matched.add('tag');
  }
  if (hasPhrase(description, normalizedQuery)) {
    score += 45;
    reasons.push('Description phrase match');
    matched.add('description');
  }

  // Publisher names such as "Tableau" or "Salesforce" only count when the query names the
  // publisher, so first-party listings are not boosted by an incidental query word.
  const publisherMatched = hasPhrase(asset.publisher.name, normalizedQuery);
  if (publisherMatched) {
    score += 5 * queryTokens.length;
    matched.add('publisher');
    reasons.push('Publisher phrase match');
  }

  let everyTokenMatched = true;
  for (const token of queryTokens) {
    const weight = weights.get(token) ?? 1;
    const label = weight < COMMON_TERM_WEIGHT ? `${token} (common term)` : token;
    let tokenMatched = publisherMatched;
    if (hasToken(asset.name, token)) {
      score += 20 * weight;
      tokenMatched = true;
      matched.add('name');
      reasons.push(`Name token match: ${label}`);
    }
    if (tags.some((tag) => hasToken(tag, token))) {
      score += 15 * weight;
      tokenMatched = true;
      matched.add('tag');
      reasons.push(`Tag token match: ${label}`);
    }
    if (hasToken(description, token)) {
      score += 8 * weight;
      tokenMatched = true;
      matched.add('description');
      reasons.push(`Description token match: ${label}`);
    }
    everyTokenMatched &&= tokenMatched;
  }
  const relatedPoints: number[] = [];
  for (const { term, via } of related) {
    const field: [AssetSearchResult['matchedFields'][number], number] | undefined = hasToken(
      asset.name,
      term,
    )
      ? ['name', 20]
      : tags.some((tag) => hasToken(tag, term))
        ? ['tag', 15]
        : hasToken(description, term)
          ? ['description', 8]
          : undefined;
    if (!field) continue;
    relatedPoints.push(field[1] * (weights.get(term) ?? 1));
    matched.add(field[0]);
    reasons.push(`Related term match: ${term} (via "${via}")`);
  }
  relatedPoints.sort((left, right) => right - left);
  const relatedScore = relatedPoints.reduce(
    (sum, points, index) => sum + (index === 0 ? points : points * ADDITIONAL_RELATED_TERM_FACTOR),
    0,
  );
  score += Math.min(relatedScore, RELATED_TERMS_MAX);

  if (queryTokens.length > 0 && everyTokenMatched) {
    const meanWeight =
      queryTokens.reduce((sum, token) => sum + (weights.get(token) ?? 1), 0) / queryTokens.length;
    score += 15 * meanWeight;
    reasons.push('All query tokens matched');
  }

  return {
    asset,
    score: Math.round(score * 10) / 10,
    reasons,
    matchedFields: MATCHED_FIELD_ORDER.filter((field) => matched.has(field)),
  };
}

export const exchangeAssetTypes: AssetType[] = [
  'skill',
  'extension',
  'viz',
  'connector',
  'accelerator',
];
