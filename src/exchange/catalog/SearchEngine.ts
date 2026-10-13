import { ExchangeInputError } from '../../errors/mcpToolError.js';
import { AssetSearchResult, AssetType, ExchangeAsset, SearchData, SearchInput } from '../types.js';
import {
  compareReportedVersions,
  hasPhrase,
  hasToken,
  normalizeSearchText,
  searchableTokens,
} from './searchText.js';

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
    const ranked = hasQuery
      ? filtered.flatMap((asset) => {
          const result = scoreAsset(asset, normalizedQuery, queryTokens);
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

function scoreAsset(
  asset: ExchangeAsset,
  normalizedQuery: string,
  queryTokens: string[],
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

  let everyTokenMatched = true;
  for (const token of queryTokens) {
    let tokenMatched = false;
    if (hasToken(asset.name, token)) {
      score += 20;
      tokenMatched = true;
      matched.add('name');
      reasons.push(`Name token match: ${token}`);
    }
    if (tags.some((tag) => hasToken(tag, token))) {
      score += 15;
      tokenMatched = true;
      matched.add('tag');
      reasons.push(`Tag token match: ${token}`);
    }
    if (hasToken(description, token)) {
      score += 8;
      tokenMatched = true;
      matched.add('description');
      reasons.push(`Description token match: ${token}`);
    }
    if (hasToken(asset.publisher.name, token)) {
      score += 5;
      tokenMatched = true;
      matched.add('publisher');
      reasons.push(`Publisher token match: ${token}`);
    }
    everyTokenMatched &&= tokenMatched;
  }
  if (queryTokens.length > 0 && everyTokenMatched) {
    score += 15;
    reasons.push('All query tokens matched');
  }

  return {
    asset,
    score,
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
