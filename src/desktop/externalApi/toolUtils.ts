import { Ok, Result } from 'ts-results-es';

import { ArgsValidationError } from '../../errors/mcpToolError.js';
import { decodeXmlEntities } from '../xmlElement.js';

export function resolveItemByNameOrId<T extends { id: string; name: string }>(
  kind: string,
  requested: string,
  items: T[],
): Result<T, ArgsValidationError> {
  const trimmed = requested.trim();
  const idMatch = items.find((candidate) => candidate.id === trimmed);
  if (idMatch) {
    return new Ok(idMatch);
  }

  const nameResult = resolveUniqueNameMatch(kind, requested, trimmed, items);
  if (nameResult !== undefined) {
    return nameResult;
  }

  if (containsXmlEntity(trimmed)) {
    const decoded = decodeXmlEntities(trimmed);
    const decodedResult = resolveUniqueNameMatch(kind, requested, decoded, items);
    if (decodedResult !== undefined) {
      return decodedResult;
    }
  }

  return new ArgsValidationError(
    `${kind} "${requested}" was not found. Available ${kind.toLowerCase()}s: ${formatItems(items)}`,
  ).toErr();
}

function resolveUniqueNameMatch<T extends { id: string; name: string }>(
  kind: string,
  requested: string,
  name: string,
  items: T[],
): Result<T, ArgsValidationError> | undefined {
  const nameMatches = items.filter((candidate) => candidate.name === name);
  if (nameMatches.length === 1) {
    return new Ok(nameMatches[0]);
  }
  if (nameMatches.length > 1) {
    return new ArgsValidationError(
      `${kind} "${requested}" matched multiple ${kind.toLowerCase()}s. Specify one id: ${formatItems(
        nameMatches,
      )}`,
    ).toErr();
  }
  return undefined;
}

function containsXmlEntity(value: string): boolean {
  return /&#|&(amp|lt|gt|quot|apos);/.test(value);
}

function formatItems(items: Array<{ id: string; name: string }>): string {
  return items.map((item) => `${item.name} (${item.id})`).join(', ');
}
