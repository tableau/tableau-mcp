// Shared waterfall identity and sequence-field heuristic. This low-level module keeps
// classification and bind-time defaults aligned without creating a classify ↔ binder cycle.
export const WATERFALL_TEMPLATE_NAME = 'part-to-whole-waterfall';

export const WATERFALL_ORDER_FIELD_RE =
  /(display|sort|step|row|item|line)[_\s-]?(order|no|num|number|index|rank|seq)|^(order|sequence|seq|ordinal|rank|step[_\s-]?order)$/i;

export const WATERFALL_ANCHOR_FIELD_RE = /categor|type|kind|class|flag|marker/i;
