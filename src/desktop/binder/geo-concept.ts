export type GeoConcept = 'country' | 'state' | 'city' | 'zip';

const GEO_TOKEN_CONCEPT: Readonly<Record<string, GeoConcept>> = {
  country: 'country',
  nation: 'country',
  state: 'state',
  province: 'state',
  region: 'state',
  admin: 'state',
  city: 'city',
  zip: 'zip',
  zipcode: 'zip',
  postal: 'zip',
};

const GEO_SEMANTIC_ROLE_CONCEPT: Readonly<Record<string, GeoConcept>> = {
  '[Country].[ISO3166_2]': 'country',
  '[Country].[Name]': 'country',
  '[State].[Name]': 'state',
  '[City].[Name]': 'city',
  '[ZipCode].[Name]': 'zip',
};

export function geoConceptFromSlotId(slotId: string): GeoConcept | null {
  for (const token of slotId
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)) {
    const concept = GEO_TOKEN_CONCEPT[token];
    if (concept) return concept;
  }
  return null;
}

export function geoConceptFromSemanticRole(semanticRole?: string): GeoConcept | null {
  return semanticRole ? (GEO_SEMANTIC_ROLE_CONCEPT[semanticRole] ?? null) : null;
}
