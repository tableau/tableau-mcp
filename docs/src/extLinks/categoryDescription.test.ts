import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitCategoryDescription } from './categoryDescription';

describe('splitCategoryDescription', () => {
  it('returns a single html part when there is no ext:// anchor', () => {
    const html =
      'Tools that call the <a href="https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api.htm">REST API</a>.';
    assert.deepEqual(splitCategoryDescription(html), [{ kind: 'html', html }]);
  });

  it('splits an ext://eca home link out of surrounding prose', () => {
    const html = 'Drive Studio via Tableau\'s <a href="ext://eca">External Client API</a>.';
    assert.deepEqual(splitCategoryDescription(html), [
      { kind: 'html', html: "Drive Studio via Tableau's " },
      { kind: 'ext', site: 'eca', path: '', text: 'External Client API' },
      { kind: 'html', html: '.' },
    ]);
  });

  it('keeps a path on ext://eca/… and ignores other attributes on the tag', () => {
    const html = '<a href="ext://eca/docs/intro.html" target="_blank" rel="noreferrer">Intro</a>';
    assert.deepEqual(splitCategoryDescription(html), [
      { kind: 'ext', site: 'eca', path: 'docs/intro.html', text: 'Intro' },
    ]);
  });

  it('throws on an unknown ext:// site, same as markdown ext:// links', () => {
    assert.throws(
      () => splitCategoryDescription('<a href="ext://unknown">x</a>'),
      /Unknown ext:\/\/ site/,
    );
  });
});
