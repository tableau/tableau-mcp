import { z } from 'zod';

import { pulseBundleRequestSchema } from '../../../sdks/tableau/types/pulse.js';

export type PulseBundleRequest = z.infer<typeof pulseBundleRequestSchema>;

export type WorkbookDatasourceIdType = 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE';

// The Insight Service validates every `field` string against HBI metadata's
// fieldName, not fieldCaption. Callers build requests from field captions
// (that's all getDatasourceMetadata / VDS readMetadata expose to a human-
// readable caller), so a calculated field's caption (e.g. "Amount_Billions")
// 400s while its underlying fieldName (e.g. "Calculation_00...") succeeds.
export function buildFieldNameByCaption(
  metadataFields: ReadonlyArray<Record<string, unknown>>,
): Map<string, string> {
  const fieldNameByCaption = new Map<string, string>();
  for (const field of metadataFields) {
    if (typeof field.fieldCaption === 'string' && typeof field.fieldName === 'string') {
      fieldNameByCaption.set(field.fieldCaption, field.fieldName);
    }
  }
  return fieldNameByCaption;
}

// The Datasources REST API returns an entry for embedded/workbook datasources
// too (it doesn't 404), but marks them with a contentUrl of the form
// '$embedded$_<workbookLuid>' instead of a normal published contentUrl. Pulse
// must always call HBI directly (never a cached query result) for those, which
// requires id_type: 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE' on the request.
export function resolveIdTypeFromContentUrl(
  contentUrl: string | undefined,
): WorkbookDatasourceIdType | undefined {
  return contentUrl?.startsWith('$embedded$')
    ? 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE'
    : undefined;
}

// Rewrites a bundle request's field captions to fieldNames using an
// already-resolved caption->fieldName map, and sets id_type when the caller
// determined the datasource is an embedded workbook datasource. Pure
// transform: callers are responsible for fetching metadata / resolving
// id_type (including best-effort fallback when those lookups fail).
export function applyFieldNameResolution(
  bundleRequest: PulseBundleRequest,
  fieldNameByCaption: ReadonlyMap<string, string>,
  idType?: WorkbookDatasourceIdType,
): PulseBundleRequest {
  const toFieldName = (caption: string): string => fieldNameByCaption.get(caption) ?? caption;

  const datasource = bundleRequest.bundle_request.input.metric.definition.datasource;
  const metric = bundleRequest.bundle_request.input.metric;
  const basicSpecification = metric.definition.basic_specification;

  return {
    ...bundleRequest,
    bundle_request: {
      ...bundleRequest.bundle_request,
      input: {
        ...bundleRequest.bundle_request.input,
        metric: {
          ...metric,
          definition: {
            ...metric.definition,
            datasource: {
              ...datasource,
              ...(idType ? { id_type: idType } : {}),
            },
            basic_specification: {
              ...basicSpecification,
              measure: {
                ...basicSpecification.measure,
                field: toFieldName(basicSpecification.measure.field),
              },
              time_dimension: {
                ...basicSpecification.time_dimension,
                field: toFieldName(basicSpecification.time_dimension.field),
              },
              filters: basicSpecification.filters.map((filter) => ({
                ...filter,
                field: toFieldName(filter.field),
              })),
            },
          },
          metric_specification: {
            ...metric.metric_specification,
            filters: metric.metric_specification.filters?.map((filter) => ({
              ...filter,
              field: toFieldName(filter.field),
            })),
          },
          extension_options: metric.extension_options
            ? {
                ...metric.extension_options,
                allowed_dimensions: metric.extension_options.allowed_dimensions?.map(toFieldName),
              }
            : metric.extension_options,
        },
      },
    },
  };
}
