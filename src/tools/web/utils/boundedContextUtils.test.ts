import { appendBoundedContextTagsFilter } from './boundedContextUtils.js';

describe('appendBoundedContextTagsFilter', () => {
  it('returns the filter unchanged when no tags are configured', () => {
    expect(appendBoundedContextTagsFilter('name:eq:Foo', null)).toBe('name:eq:Foo');
  });

  it('returns an empty string when there is neither a filter nor tags', () => {
    expect(appendBoundedContextTagsFilter(undefined, null)).toBe('');
  });

  it('treats an empty tags set as no tags', () => {
    expect(appendBoundedContextTagsFilter('name:eq:Foo', new Set())).toBe('name:eq:Foo');
  });

  it('appends a single allowed tag as an eq expression when there is no filter', () => {
    expect(appendBoundedContextTagsFilter(undefined, new Set(['Finance']))).toBe('tags:eq:Finance');
  });

  it('appends multiple allowed tags as an in expression when there is no filter', () => {
    expect(appendBoundedContextTagsFilter(undefined, new Set(['Finance', 'HR']))).toBe(
      'tags:in:[Finance,HR]',
    );
  });

  it('appends a single allowed tag onto an existing non-tags filter', () => {
    expect(appendBoundedContextTagsFilter('name:eq:Foo', new Set(['Finance']))).toBe(
      'name:eq:Foo,tags:eq:Finance',
    );
  });

  it('appends multiple allowed tags onto an existing non-tags filter', () => {
    expect(appendBoundedContextTagsFilter('name:eq:Foo', new Set(['Finance', 'HR']))).toBe(
      'name:eq:Foo,tags:in:[Finance,HR]',
    );
  });

  it('does not append when the filter already has a tags expression', () => {
    expect(appendBoundedContextTagsFilter('tags:eq:Other', new Set(['Finance']))).toBe(
      'tags:eq:Other',
    );
  });

  it('does not append when a later clause in the filter is a tags expression', () => {
    expect(appendBoundedContextTagsFilter('name:eq:Foo,tags:in:[X,Y]', new Set(['Finance']))).toBe(
      'name:eq:Foo,tags:in:[X,Y]',
    );
  });

  it('does not treat a tags substring inside another clause as a tags expression', () => {
    // `name:eq:tags` has field `name`, not `tags`, so the allowed tag is still appended.
    expect(appendBoundedContextTagsFilter('name:eq:tags', new Set(['Finance']))).toBe(
      'name:eq:tags,tags:eq:Finance',
    );
  });
});
