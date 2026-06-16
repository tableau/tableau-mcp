/**
 * @file Tests for embedTableauViz
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { createTableauVizElement, embedTableauViz } from './embedTableauViz.js';

describe('createTableauVizElement', () => {
  it('should create a tableau-viz element with correct attributes', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    const element = createTableauVizElement(vizUrl, token);

    expect(element.tagName.toLowerCase()).toBe('tableau-viz');
    expect(element.getAttribute('src')).toBe(vizUrl);
    expect(element.getAttribute('token')).toBe(token);
    // expect(element.getAttribute('toolbar')).toBe('bottom');
    // expect(element.getAttribute('hide-tabs')).toBe('false');
  });
});

describe('embedTableauViz', () => {
  beforeEach(() => {
    // Set up DOM with tableauVizContainer
    const container = document.createElement('div');
    container.id = 'tableauVizContainer';
    document.body.appendChild(container);
  });

  it('should embed viz into tableauVizContainer', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    embedTableauViz(vizUrl, token);

    const container = document.getElementById('tableauVizContainer');
    const vizElement = container?.querySelector('tableau-viz');

    expect(vizElement).toBeTruthy();
    expect(vizElement?.getAttribute('src')).toBe(vizUrl);
    expect(vizElement?.getAttribute('token')).toBe(token);
  });

  it('should throw error if tableauVizContainer not found', () => {
    // Remove the container
    const container = document.getElementById('tableauVizContainer');
    container?.remove();

    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    expect(() => embedTableauViz(vizUrl, token)).toThrow(
      'Container element with id "tableauVizContainer" not found',
    );
  });
});
