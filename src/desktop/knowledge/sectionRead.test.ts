// Section-scoped knowledge reads.
//
// Live incident (v11 bundle): mid-spiral the agent read two whole knowledge documents
// (~27,000 characters) to learn one rule. The corpus's biggest module is 33,543 bytes;
// every read-knowledge-resource call paid the full file. A URI fragment
// (expertise://tableau/<slug>#best-practices) now returns just that section.

import { readKnowledgeResource, readKnowledgeSections } from './index.js';

const MARKS = 'expertise://tableau/tactics/viz/marks-and-encodings';

describe('read-knowledge-resource URI fragments', () => {
  it('returns the whole file when no fragment is given', () => {
    const whole = readKnowledgeResource(MARKS);
    expect(whole).toBeTypeOf('string');
    expect(whole!.length).toBeGreaterThan(20_000);
  });

  it('returns only the named section, and it is far smaller than the file', () => {
    const whole = readKnowledgeResource(MARKS)!;
    const section = readKnowledgeResource(`${MARKS}#best-practices`);

    expect(section).toBeTypeOf('string');
    expect(section!.length).toBeLessThan(whole.length / 2);
    expect(section!.split('\n')[0]).toMatch(/^#{1,6}\s+Best Practices\s*$/i);
    expect(whole).toContain(section!.trim());
  });

  it('stops at the next heading of the same or higher level', () => {
    const section = readKnowledgeResource(`${MARKS}#best-practices`)!;
    const headings = section.split('\n').filter((line) => /^#{1,2}\s+/.test(line));

    expect(headings).toHaveLength(1);
  });

  it('matches a section by its heading text as well as its slug', () => {
    const bySlug = readKnowledgeResource(`${MARKS}#common-mistakes`);
    const byText = readKnowledgeResource(`${MARKS}#Common Mistakes`);

    expect(bySlug).toBeTypeOf('string');
    expect(byText).toBe(bySlug);
  });

  it('returns null for a fragment that names no section', () => {
    expect(readKnowledgeResource(`${MARKS}#no-such-section`)).toBeNull();
  });

  it('lists a document’s section slugs so an agent can pick one without reading it', () => {
    const whole = readKnowledgeResource(MARKS)!;
    const sections = readKnowledgeSections('tactics/viz/marks-and-encodings');

    expect(sections).toContain('best-practices');
    expect(sections).toContain('common-mistakes');
    // The menu has to be a rounding error against the document it replaces reading.
    expect(sections.join(',').length).toBeLessThan(whole.length * 0.05);
  });
});
