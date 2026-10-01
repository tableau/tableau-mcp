import { createHash } from 'crypto';

import {
  bookmarkToTemplateWorkbook,
  deriveTemplatePass1Eligibility,
  type TemplatePass1Eligibility,
} from './bookmarkTemplate.js';
import {
  deriveTemplateFitFacts,
  inferBindingDescriptor,
  inferFromBookmark,
  type TemplateBindingDescriptor,
  type TemplateFitFacts,
} from './inferSlots.js';

export interface TemplateRuntimeSnapshot {
  template: string;
  sourceHash: string;
  descriptor: TemplateBindingDescriptor;
  /** Mark classes authored across every relevant bookmark pane, preserving pane count. */
  markClasses?: string[];
  fit?: TemplateFitFacts;
  xml: string;
  eligibility: TemplatePass1Eligibility;
}

export function createTemplateRuntimeSnapshot(
  template: string,
  bookmarkXml: string,
  options: { plainTemporalLineColorOptional?: boolean } = {},
): TemplateRuntimeSnapshot {
  const inference = inferFromBookmark(bookmarkXml, options);
  const converted = bookmarkToTemplateWorkbook(bookmarkXml, inference);
  const descriptor = inferBindingDescriptor(template, inference);
  return {
    template,
    sourceHash: createHash('sha256').update(bookmarkXml).digest('hex'),
    descriptor,
    markClasses: inference.markClasses?.slice() ?? [],
    fit: deriveTemplateFitFacts(inference, descriptor),
    xml: converted.xml,
    eligibility: deriveTemplatePass1Eligibility(converted),
  };
}
