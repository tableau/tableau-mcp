import { geoConceptFromSemanticRole, geoConceptFromSlotId } from './geo-concept.js';

describe('geo concept matching', () => {
  it('normalizes slot vocabulary to Tableau geographic levels', () => {
    expect(geoConceptFromSlotId('state_province')).toBe('state');
    expect(geoConceptFromSlotId('postal-code')).toBe('zip');
  });

  it('maps Tableau semantic roles and stays silent for unknown roles', () => {
    expect(geoConceptFromSemanticRole('[City].[Name]')).toBe('city');
    expect(geoConceptFromSemanticRole('[AreaCode].[Name]')).toBeNull();
  });
});
