import { extractEqValue, looksLikeUuid } from './flowFilterUtils.js';

describe('looksLikeUuid', () => {
  it.each([
    ['6f8a2966-e173-11e8-ae74-ffd84c19d7f3', true],
    ['d00700fe-28a0-4ece-a7af-5543ddf38a82', true],
    ['00000000-0000-0000-0000-000000000000', true],
    ['6F8A2966-E173-11E8-AE74-FFD84C19D7F3', true],
    ['  6f8a2966-e173-11e8-ae74-ffd84c19d7f3  ', true],
    ['Finance', false],
    ['My Daily Flow', false],
    ['not-a-uuid', false],
    ['default', false],
    ['6f8a2966-e173-11e8-ae74', false],
    ['', false],
  ])('classifies %s as %s', (value, expected) => {
    expect(looksLikeUuid(value as string)).toBe(expected);
  });
});

describe('extractEqValue', () => {
  it.each([
    ['ownerName:eq:Jane Doe', 'ownerName', 'Jane Doe'],
    ['ownerName:eq:jane.doe@example.com', 'ownerName', 'jane.doe@example.com'],
    ['ownerName:eq:value:with:colons', 'ownerName', 'value:with:colons'],
    ['name:eq:Sales,ownerName:eq:Jane Doe', 'ownerName', 'Jane Doe'],
    ['ownerName:eq:Jane Doe,projectName:eq:Finance', 'ownerName', 'Jane Doe'],
    ['projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3', 'projectId', '6f8a2966-e173-11e8-ae74-ffd84c19d7f3'],
    ['name:eq:X,projectId:eq:abc-123', 'projectId', 'abc-123'],
    ['flowId:eq:d00700fe-28a0-4ece-a7af-5543ddf38a82', 'flowId', 'd00700fe-28a0-4ece-a7af-5543ddf38a82'],
    ['status:eq:Failed,flowId:eq:My Flow', 'flowId', 'My Flow'],
  ])('extracts %s for field %s', (input, field, expected) => {
    expect(extractEqValue(input, field)).toBe(expected);
  });

  // A bracketed `in` list before the target clause is broken into junk fragments
  // by the comma split, but the `ownerName:eq:` clause that follows is still
  // intact and is matched.
  it('still finds an :eq: clause that follows a bracketed in:[...] list', () => {
    expect(extractEqValue('name:in:[A,B],ownerName:eq:Jane Doe', 'ownerName')).toBe('Jane Doe');
  });

  it.each([
    [undefined, 'ownerName'],
    ['', 'ownerName'],
    ['name:eq:Sales', 'ownerName'],
    ['projectName:eq:Finance', 'projectId'],
    ['status:eq:Failed', 'flowId'],
    // present but with a non-eq operator -> not extracted
    ['ownerName:in:[Jane,Joe]', 'ownerName'],
  ])('returns undefined for %s (field %s)', (input, field) => {
    expect(extractEqValue(input, field)).toBeUndefined();
  });
});
