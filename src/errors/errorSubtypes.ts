export const QueryValidationSubtype = {
  MetadataMismatch: 'metadata-mismatch',
  FilterValueInvalid: 'filter-value-invalid',
} as const;

/**
 * Every sub-code group. The uniqueness test iterates this so a value accidentally reused across
 * groups fails CI. Add new groups here as families adopt sub-codes.
 */
export const ALL_ERROR_SUBTYPE_GROUPS = {
  QueryValidationSubtype,
} as const;
