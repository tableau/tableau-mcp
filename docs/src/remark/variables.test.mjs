import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import remarkVariables, { substituteVariables, VARIABLES } from './variables.mjs';

/**
 * @param {object} tree
 * @returns {object}
 */
function apply(tree) {
  remarkVariables()(tree);
  return tree;
}

describe('substituteVariables', () => {
  it('expands known tokens', () => {
    assert.equal(
      substituteVariables('as of the %coming_release% release'),
      `as of the ${VARIABLES.coming_release} release`,
    );
  });

  it('leaves unknown tokens and bare percents alone', () => {
    assert.equal(substituteVariables('50% done %not_a_var%'), '50% done %not_a_var%');
  });
});

describe('remarkVariables', () => {
  it('rewrites prose text', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'open %product_name% workbook' }],
        },
      ],
    };
    apply(tree);
    assert.equal(tree.children[0].children[0].value, 'open Tableau Studio workbook');
  });

  it('rewrites inline code so backticks cannot leak a slug', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'inlineCode', value: '%product_name%' }],
    };
    apply(tree);
    assert.equal(tree.children[0].value, 'Tableau Studio');
  });

  it('rewrites fenced code', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'code', lang: 'text', value: 'Rebuild in %product_name% instead.' }],
    };
    apply(tree);
    assert.equal(tree.children[0].value, 'Rebuild in Tableau Studio instead.');
  });

  it('rewrites link URLs', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'link',
          url: 'https://example.com/%product_name%',
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    };
    apply(tree);
    assert.equal(tree.children[0].url, 'https://example.com/Tableau Studio');
  });
});
