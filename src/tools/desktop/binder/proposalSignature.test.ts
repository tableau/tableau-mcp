import { proposalSignature } from './proposalSignature.js';

const baseProposal = {
  template: 'ranking-ordered-bar',
  title: 'Sales by Region',
  bindings: [
    { slot_id: 'measure', field: 'Sales', derivation: 'sum' },
    { slot_id: 'dimension', field: 'Region' },
  ],
  confidence: 0.62,
  sort: { by: 'Sales', direction: 'desc' },
  top_n: 10,
};

describe('proposalSignature', () => {
  it('treats title confidence minConfidence and binding order as non-semantic', () => {
    const sameSemantics = {
      ...baseProposal,
      title: 'A better display title',
      confidence: 0.99,
      minConfidence: 0.1,
      bindings: [...baseProposal.bindings].reverse(),
    };

    expect(proposalSignature(sameSemantics)).toBe(proposalSignature(baseProposal));
  });

  it('changes when the template changes', () => {
    expect(proposalSignature({ ...baseProposal, template: 'dot-plot' })).not.toBe(
      proposalSignature(baseProposal),
    );
  });

  it('changes when a binding slot changes', () => {
    expect(
      proposalSignature({
        ...baseProposal,
        bindings: [
          { slot_id: 'measure', field: 'Sales', derivation: 'sum' },
          { slot_id: 'color', field: 'Region' },
        ],
      }),
    ).not.toBe(proposalSignature(baseProposal));
  });

  it('changes when a binding field changes', () => {
    expect(
      proposalSignature({
        ...baseProposal,
        bindings: [
          { slot_id: 'measure', field: 'Profit', derivation: 'sum' },
          { slot_id: 'dimension', field: 'Region' },
        ],
      }),
    ).not.toBe(proposalSignature(baseProposal));
  });

  it('changes when sort changes', () => {
    expect(
      proposalSignature({
        ...baseProposal,
        sort: { by: 'Region', direction: 'asc' },
      }),
    ).not.toBe(proposalSignature(baseProposal));
  });

  it('changes when top_n changes', () => {
    expect(proposalSignature({ ...baseProposal, top_n: 5 })).not.toBe(
      proposalSignature(baseProposal),
    );
  });

  it('changes when a declarative filter is added (m7 — so an add-filter re-bind is not blocked as unchanged)', () => {
    // The recovery gate blocks a retry whose signature is unchanged. Adding an interactive
    // context filter is a real semantic change and MUST produce a distinct signature, else the
    // "add the Region context filter" re-bind would be refused as a duplicate.
    expect(
      proposalSignature({
        ...baseProposal,
        filters: [{ field: 'Region', context: true }],
      }),
    ).not.toBe(proposalSignature(baseProposal));
  });

  it('treats filter order as non-semantic but values/context as semantic', () => {
    const a = {
      ...baseProposal,
      filters: [
        { field: 'Region', context: true },
        { field: 'Segment', values: ['Consumer'] },
      ],
    };
    const reordered = { ...baseProposal, filters: [...a.filters].reverse() };
    expect(proposalSignature(reordered)).toBe(proposalSignature(a));

    const contextFlipped = {
      ...baseProposal,
      filters: [
        { field: 'Region', context: false },
        { field: 'Segment', values: ['Consumer'] },
      ],
    };
    expect(proposalSignature(contextFlipped)).not.toBe(proposalSignature(a));
  });
});
