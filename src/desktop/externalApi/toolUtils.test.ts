import { resolveItemByNameOrId } from './toolUtils.js';

type Item = { id: string; name: string };

function items(...names: string[]): Item[] {
  return names.map((name, index) => ({ id: `id-${index}`, name }));
}

describe('resolveItemByNameOrId', () => {
  it('resolves by id first', () => {
    const list = items('Sheet 1', 'Sheet 2');
    const result = resolveItemByNameOrId('Worksheet', 'id-1', list);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(list[1]);
  });

  it('resolves a literal name containing "&" without any decoding', () => {
    const list = items('Sales & Profit', 'Other');
    const result = resolveItemByNameOrId('Worksheet', 'Sales & Profit', list);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(list[0]);
  });

  it('decodes an "&amp;"-escaped request to match the plain "&" name', () => {
    const list = items('Sales & Profit', 'Other');
    const result = resolveItemByNameOrId('Worksheet', 'Sales &amp; Profit', list);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(list[0]);
  });

  it('prefers the exact (un-decoded) name over the decoded one', () => {
    // An item literally NAMED "Sales &amp; Profit" wins over the decoded "Sales & Profit".
    const list = items('Sales & Profit', 'Sales &amp; Profit');
    const result = resolveItemByNameOrId('Worksheet', 'Sales &amp; Profit', list);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(list[1]);
  });

  it('single-decodes a doubly-escaped "&amp;lt;" request to the literal "&lt;" name', () => {
    // decodeXmlEntities (xmlElement.ts) decodes &amp; LAST, so "&amp;lt;" resolves to the
    // literal "&lt;" — one decode level per call — and can no longer skip a level down to
    // "<" as the old &amp;-first private copy did.
    const list = items('Sales < Profit', 'Sales &lt; Profit');
    const result = resolveItemByNameOrId('Worksheet', 'Sales &amp;lt; Profit', list);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(list[1]);
  });

  it('leaves "&amp;amp;lt;" one level less escaped, matching "Sales &amp;lt; Profit"', () => {
    // Both decode orders agree here: one global amp pass turns "&amp;amp;lt;" into
    // "&amp;lt;" without rescanning, and no other pass can touch it.
    const list = items('Sales &amp;lt; Profit', 'Sales &lt; Profit', 'Sales < Profit');
    const result = resolveItemByNameOrId('Worksheet', 'Sales &amp;amp;lt; Profit', list);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe(list[0]);
  });

  it('errors with the available items when nothing matches', () => {
    const result = resolveItemByNameOrId('Worksheet', 'Nope', items('Sheet 1'));
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toContain('"Nope" was not found');
    expect(result.unwrapErr().message).toContain('Sheet 1 (id-0)');
  });

  it('errors on an ambiguous duplicate name', () => {
    const list = [
      { id: 'a', name: 'Sheet 1' },
      { id: 'b', name: 'Sheet 1' },
    ];
    const result = resolveItemByNameOrId('Worksheet', 'Sheet 1', list);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toContain('matched multiple');
  });
});
