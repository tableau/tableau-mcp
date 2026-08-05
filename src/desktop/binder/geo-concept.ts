// src/desktop/binder/geo-concept.ts
//
// The geo-concept vocabulary shared by the binder's ranking and compatibility
// legs: which geographic LEVEL a slot asks for, and which one a field's Tableau
// semantic-role declares.
//
// Two copies of these tables already exist and are deliberately left alone:
//   - src/desktop/binder/classify.ts — private, hash-gated lockstep core.
//   - src/desktop/binder/validate.ts — an intentional MIRROR whose header states
//     it is "intentionally not exported because this port must keep lockstep-core
//     bytes unchanged".
// This module exists so `explicit-bind.ts` can rank geo candidates WITHOUT
// becoming a third hand-maintained copy. It is byte-independent of both: a
// mismatch here degrades ranking (a coarser field may win a finer slot), it can
// never bypass validate.ts's gates, which re-derive concepts from their own copy.

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

function geoNameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The geographic level a slot asks for, read from its slot_id ('state_province' -> 'state'). */
export function geoConceptFromSlotId(slotId: string): GeoConcept | null {
  for (const t of geoNameTokens(slotId)) {
    const concept = GEO_TOKEN_CONCEPT[t];
    if (concept) return concept;
  }
  return null;
}

/** The geographic level a FIELD declares, read from its Tableau semantic role. */
export function geoConceptFromSemanticRole(semanticRole?: string): GeoConcept | null {
  if (!semanticRole) return null;
  return GEO_SEMANTIC_ROLE_CONCEPT[semanticRole] ?? null;
}
