import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import remarkExtLinks, { parseExtProtocol } from './extLinks.mjs';

function apply(tree) {
  remarkExtLinks()(tree);
  return tree;
}

describe('parseExtProtocol', () => {
  it('parses home and path forms', () => {
    assert.deepEqual(parseExtProtocol('ext://eca'), { site: 'eca', path: '' });
    assert.deepEqual(parseExtProtocol('ext://studio/foo.html'), {
      site: 'studio',
      path: 'foo.html',
    });
  });
});

describe('remarkExtLinks', () => {
  it('rewrites ext://studio/foo.html to ExtSiteLink JSX with site and path', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'ext://studio/foo.html',
              children: [{ type: 'text', value: 'Tableau Studio' }],
            },
          ],
        },
      ],
    };
    apply(tree);
    const jsx = tree.children[0].children[0];
    assert.equal(jsx.type, 'mdxJsxTextElement');
    assert.equal(jsx.name, 'ExtSiteLink');
    assert.deepEqual(jsx.attributes, [
      { type: 'mdxJsxAttribute', name: 'site', value: 'studio' },
      { type: 'mdxJsxAttribute', name: 'path', value: 'foo.html' },
    ]);
    assert.deepEqual(jsx.children, [{ type: 'text', value: 'Tableau Studio' }]);
  });

  it('omits path on a home link', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'link',
          url: 'ext://eca',
          children: [{ type: 'text', value: 'API' }],
        },
      ],
    };
    apply(tree);
    const jsx = tree.children[0];
    assert.equal(jsx.name, 'ExtSiteLink');
    assert.deepEqual(jsx.attributes, [
      { type: 'mdxJsxAttribute', name: 'site', value: 'eca' },
    ]);
  });

  it('leaves ordinary https links alone', () => {
    const link = {
      type: 'link',
      url: 'https://help.tableau.com/current/',
      children: [{ type: 'text', value: 'Help' }],
    };
    const tree = { type: 'root', children: [link] };
    apply(tree);
    assert.equal(tree.children[0], link);
  });

  it('rejects ext:// used as a reference definition', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'definition', identifier: 'studio', url: 'ext://studio' }],
    };
    assert.throws(() => apply(tree), /reference definitions/);
  });
});
