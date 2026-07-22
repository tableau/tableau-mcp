export interface ProposalSignatureBinding {
  slot_id: string;
  field: string;
  derivation?: string;
}

export interface ProposalSignatureInput {
  template: string;
  bindings: ProposalSignatureBinding[];
  sort?: {
    by: string;
    direction: string;
  };
  top_n?: number;
}

function compareText(a: string | undefined, b: string | undefined): number {
  return (a ?? '').localeCompare(b ?? '');
}

export function proposalSignature(proposal: ProposalSignatureInput): string {
  const bindings = proposal.bindings
    .map((binding) => ({
      slot_id: binding.slot_id,
      field: binding.field,
      ...(binding.derivation !== undefined ? { derivation: binding.derivation } : {}),
    }))
    .sort((a, b) => {
      const slot = compareText(a.slot_id, b.slot_id);
      if (slot !== 0) return slot;
      const field = compareText(a.field, b.field);
      if (field !== 0) return field;
      return compareText(a.derivation, b.derivation);
    });

  return JSON.stringify({
    template: proposal.template,
    bindings,
    ...(proposal.sort !== undefined
      ? { sort: { by: proposal.sort.by, direction: proposal.sort.direction } }
      : {}),
    ...(proposal.top_n !== undefined ? { top_n: proposal.top_n } : {}),
  });
}
