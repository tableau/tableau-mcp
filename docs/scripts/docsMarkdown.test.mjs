import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  derivePageProseFromSource,
  docPathForRel,
  isPublishablePageName,
  normalizeForAgents,
  resolveExtUrl,
  rewriteExtLinks,
  substituteVars,
} from './lib/docsMarkdown.mjs';

describe('docPathForRel', () => {
  it('maps a tool page to /docs/<path without extension>', () => {
    assert.equal(
      docPathForRel('web-tools/data-qna/list-datasources.md'),
      '/docs/web-tools/data-qna/list-datasources',
    );
  });

  it('maps README.md and index.md to the folder URL', () => {
    assert.equal(docPathForRel('getting-started/README.md'), '/docs/getting-started');
    assert.equal(docPathForRel('tableau-authoring/index.md'), '/docs/tableau-authoring');
  });
});

describe('isPublishablePageName', () => {
  it('rejects pin archives, drafts, and OLD copies', () => {
    assert.equal(isPublishablePageName('list-projects_abdd5aa26851.md'), false);
    assert.equal(isPublishablePageName('tool.DRAFT.md'), false);
    assert.equal(isPublishablePageName('tool_OLD.md'), false);
    assert.equal(isPublishablePageName('list-projects.md'), true);
  });
});

describe('derivePageProseFromSource', () => {
  it('takes the first overview sentence and skips the availability span', () => {
    const raw = `---
sidebar_position: 1
---

# List Dashboards

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Lists the dashboards in the workbook open in the connected %product_name% instance. Extra sentence.
`;
    const { title, summary } = derivePageProseFromSource(raw, 'fallback');
    assert.equal(title, 'List Dashboards');
    assert.match(summary, /^Lists the dashboards/);
    assert.doesNotMatch(summary, /Available/);
    assert.doesNotMatch(summary, /%product_name%/);
    assert.match(summary, /Tableau Studio/);
  });
});

describe('normalizeForAgents', () => {
  it('strips frontmatter, availability, imports, and resolves ext:// links', () => {
    const raw = `---
sidebar_position: 1
---

import X from './x';

# Activate

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Calls the [%ecapi_name%](ext://eca) on %product_name%.

<svg width="16" height="16"></svg>
`;
    const out = normalizeForAgents(raw, { GITHUB_ORIGIN: 'https://tableau.github.io' });
    assert.doesNotMatch(out, /sidebar_position/);
    assert.doesNotMatch(out, /import X/);
    assert.doesNotMatch(out, /toolAvailability/);
    assert.doesNotMatch(out, /ext:\/\//);
    assert.doesNotMatch(out, /%product_name%/);
    assert.doesNotMatch(out, /<svg/);
    assert.match(out, /External Client API/);
    assert.match(out, /Tableau Studio/);
    assert.match(out, /help\.tableau\.com/);
  });
});

describe('rewriteExtLinks', () => {
  it('rewrites an eca link to the stage base when GITHUB_ORIGIN is unset', () => {
    const out = rewriteExtLinks('[API](ext://eca/reference/index.html)', {});
    assert.match(out, /^\[API\]\(https:\/\/help\.tableau\.com\/v0\.0\//);
  });

  it('rewrites an eca link to the prod base for the official origin', () => {
    const href = resolveExtUrl('ext://eca/reference/index.html', {
      GITHUB_ORIGIN: 'https://tableau.github.io',
    });
    assert.match(href, /^https:\/\/help\.tableau\.com\/current\//);
  });
});

describe('substituteVars', () => {
  it('leaves unknown tokens unchanged', () => {
    assert.equal(substituteVars('%not_a_real_var%'), '%not_a_real_var%');
  });
});
