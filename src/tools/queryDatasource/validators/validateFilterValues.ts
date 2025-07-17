import levenshtein from 'fast-levenshtein';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { log } from '../../../logging/log.js';
import {
  Datasource,
  MatchFilter,
  Query as QueryType,
  QueryRequest,
  SetFilter,
} from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import VizqlDataServiceMethods from '../../../sdks/tableau/methods/vizqlDataServiceMethods.js';
import { Server } from '../../../server.js';
import { Query } from '../queryDatasourceValidator.js';

type MatchFilter = z.infer<typeof MatchFilter>;
type SetFilter = z.infer<typeof SetFilter>;

interface FilterValidationError {
  field: string;
  invalidValues: string[];
  sampleValues: string[];
  message: string;
}

/**
 * Validates SET and MATCH filter values by querying the VDS to check if they exist in the target field.
 * Returns fuzzy matched sample values from the field if validation fails.
 */
export async function validateFilterValues(
  server: Server,
  query: Query,
  vizqlDataServiceMethods: VizqlDataServiceMethods,
  datasource: z.infer<typeof Datasource>,
): Promise<Result<void, FilterValidationError[]>> {
  if (!query.filters) {
    return Ok.EMPTY;
  }

  const validationErrors: FilterValidationError[] = [];

  // Filter for SET and MATCH filters that need validation
  const filtersToValidate = query.filters.filter(
    (filter) =>
      (filter.filterType === 'SET' || filter.filterType === 'MATCH') &&
      'fieldCaption' in filter.field &&
      filter.field.fieldCaption,
  ) as Array<MatchFilter | SetFilter>;

  if (filtersToValidate.length === 0) {
    return Ok.EMPTY;
  }

  // Validate each filter
  for (const filter of filtersToValidate) {
    const fieldCaption = filter.field.fieldCaption;

    try {
      if (filter.filterType === 'SET') {
        const result = await validateSetFilter(
          filter,
          fieldCaption,
          vizqlDataServiceMethods,
          datasource,
        );
        if (result.isErr()) {
          validationErrors.push(result.error);
        }
      } else if (filter.filterType === 'MATCH') {
        const result = await validateMatchFilter(
          filter,
          fieldCaption,
          vizqlDataServiceMethods,
          datasource,
        );
        if (result.isErr()) {
          validationErrors.push(result.error);
        }
      }
    } catch (error) {
      // If validation query fails, we'll let the original query proceed
      // This ensures we don't block valid queries due to validation issues
      log.warning(server, `Filter value validation failed for field ${fieldCaption}: ${error}`);
    }
  }

  if (validationErrors.length > 0) {
    return new Err(validationErrors);
  }

  return Ok.EMPTY;
}

/**
 * Validates a SET filter by checking if all values exist in the target field
 */
async function validateSetFilter(
  filter: SetFilter,
  fieldCaption: string,
  vizqlDataServiceMethods: VizqlDataServiceMethods,
  datasource: z.infer<typeof Datasource>,
): Promise<Result<void, FilterValidationError>> {
  const filterValues = filter.values.map((v) => String(v));

  // Query to get distinct values from the field
  const distinctValuesQuery: z.infer<typeof QueryType> = {
    fields: [
      {
        fieldCaption: fieldCaption,
        fieldAlias: 'DistinctValues',
      },
    ],
  };

  const queryRequest: z.infer<typeof QueryRequest> = {
    datasource,
    query: distinctValuesQuery,
    options: {
      returnFormat: 'OBJECTS',
      debug: true,
      disaggregate: false,
    },
  };

  const result = await vizqlDataServiceMethods.queryDatasource(queryRequest);

  if (result.isErr()) {
    // If we can't query the field, let the original query proceed
    return Ok.EMPTY;
  }

  const data = result.value.data || [];
  const existingValues = new Set(
    (data as Record<string, unknown>[]).map((row) =>
      String(row.DistinctValues || row[fieldCaption] || ''),
    ),
  );

  // Check which filter values don't exist in the field
  const invalidValues = filterValues.filter((value) => !existingValues.has(value));

  if (invalidValues.length > 0) {
    // Use fuzzy matching to find similar values
    const suggestedValues = getFuzzyMatches(
      invalidValues,
      Array.from(existingValues),
      3, // max edit distance
      5, // max suggestions
    );

    const message = `Filter validation failed for field "${fieldCaption}". The following values were not found: ${invalidValues.join(', ')}. Did you mean: ${suggestedValues.join(', ')}? Please evaluate whether you included the wrong filter value or if you are trying to filter on the wrong field entirely.`;

    return new Err({
      field: fieldCaption,
      invalidValues,
      sampleValues: suggestedValues, // Now contains fuzzy matches instead of random samples
      message,
    });
  }

  return Ok.EMPTY;
}

/**
 * Validates a MATCH filter by checking if the pattern matches any values in the target field
 */
async function validateMatchFilter(
  filter: MatchFilter,
  fieldCaption: string,
  vizqlDataServiceMethods: VizqlDataServiceMethods,
  datasource: z.infer<typeof Datasource>,
): Promise<Result<void, FilterValidationError>> {
  // Query to get a sample of values from the field
  const sampleValuesQuery: z.infer<typeof QueryType> = {
    fields: [
      {
        fieldCaption: fieldCaption,
        fieldAlias: 'SampleValues',
      },
    ],
  };

  const queryRequest: z.infer<typeof QueryRequest> = {
    datasource,
    query: sampleValuesQuery,
    options: {
      returnFormat: 'OBJECTS',
      debug: true,
      disaggregate: false,
    },
  };

  const result = await vizqlDataServiceMethods.queryDatasource(queryRequest);

  if (result.isErr()) {
    // If we can't query the field, let the original query proceed
    return Ok.EMPTY;
  }

  const data = result.value.data || [];
  const fieldValues = (data as Record<string, unknown>[]).map((row: any) =>
    String(row.SampleValues || row[fieldCaption] || ''),
  );

  // Check if any values match the pattern
  const hasMatch = fieldValues.some((value) => {
    if (filter.startsWith && !value.startsWith(filter.startsWith)) return false;
    if (filter.endsWith && !value.endsWith(filter.endsWith)) return false;
    if (filter.contains && !value.includes(filter.contains)) return false;
    return true;
  });

  if (!hasMatch) {
    // Find values that are similar to the pattern
    const patternString = filter.startsWith || filter.endsWith || filter.contains || '';
    const similarValues = fieldValues
      .map((value) => ({
        value,
        distance: levenshtein.get(patternString.toLowerCase(), value.toLowerCase()),
      }))
      .filter((match) => match.distance <= 5) // Allow up to 5 character differences
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
      .map((match) => match.value);

    const suggestions = similarValues.length > 0 ? similarValues : getRandomSample(fieldValues, 5);

    const patterns: Array<string> = [];
    if (filter.startsWith) patterns.push(`starts with "${filter.startsWith}"`);
    if (filter.endsWith) patterns.push(`ends with "${filter.endsWith}"`);
    if (filter.contains) patterns.push(`contains "${filter.contains}"`);

    const message = `Filter validation failed for field "${fieldCaption}". No values found that ${patterns.join(' and ')}. Similar values in this field: ${suggestions.join(', ')}. Please evaluate whether you included the wrong filter value or if you are trying to filter on the wrong field entirely.`;

    return new Err({
      field: fieldCaption,
      invalidValues: patterns,
      sampleValues: suggestions,
      message,
    });
  }

  return Ok.EMPTY;
}

/**
 * Gets a random sample of values from an array
 */
function getRandomSample<T>(array: T[], count: number): T[] {
  if (array.length <= count) {
    return array;
  }

  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, count);
}

/**
 * Finds the closest matches to invalid filter values using fuzzy matching
 */
function getFuzzyMatches(
  invalidValues: string[],
  existingValues: string[],
  maxDistance: number = 3,
  maxSuggestions: number = 5,
): string[] {
  const suggestions = new Set<string>();

  for (const invalidValue of invalidValues) {
    // Find existing values within the specified edit distance
    const matches = existingValues
      .map((existingValue) => ({
        value: existingValue,
        distance: levenshtein.get(invalidValue, existingValue),
      }))
      .filter((match) => match.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.ceil(maxSuggestions / invalidValues.length))
      .map((match) => match.value);

    matches.forEach((match) => suggestions.add(match));
  }

  // If we don't have enough suggestions, fill with random samples
  if (suggestions.size < maxSuggestions) {
    const remaining = maxSuggestions - suggestions.size;
    const randomSamples = getRandomSample(
      existingValues.filter((v) => !suggestions.has(v)),
      remaining,
    );
    randomSamples.forEach((sample) => suggestions.add(sample));
  }

  return Array.from(suggestions).slice(0, maxSuggestions);
}
