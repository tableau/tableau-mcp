/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTableauVizElement, embedTableauViz } from './embedTableauViz.js';

describe('createTableauVizElement', () => {
  it('should create a tableau-viz element with correct attributes', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    const element = createTableauVizElement(vizUrl, token);

    expect(element.tagName.toLowerCase()).toBe('tableau-viz');
    expect(element.getAttribute('src')).toBe(vizUrl);
    expect(element.getAttribute('token')).toBe(token);
    expect(element.getAttribute('toolbar')).toBe('hidden');
  });
});

describe('embedTableauViz', () => {
  beforeEach(() => {
    // Set up DOM with tableauVizContainer
    const container = document.createElement('div');
    container.id = 'tableauVizContainer';
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up
    const container = document.getElementById('tableauVizContainer');
    container?.remove();
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

    expect(() => {
      embedTableauViz(vizUrl, token);
    }).toThrow('Container element with id "tableauVizContainer" not found');
  });

  it('should be idempotent - calling twice results in exactly one viz element', () => {
    const vizUrl1 = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook1/view1';
    const token1 = 'token-first';

    const vizUrl2 = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook2/view2';
    const token2 = 'token-second';

    // Call embedTableauViz twice (simulating double-mount)
    embedTableauViz(vizUrl1, token1);
    embedTableauViz(vizUrl2, token2);

    const container = document.getElementById('tableauVizContainer');
    const vizElements = container?.querySelectorAll('tableau-viz');

    // Should have exactly ONE viz element, not two
    expect(vizElements?.length).toBe(1);
  });

  it('should replace previous viz with most recent one', () => {
    const vizUrl1 = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook1/view1';
    const token1 = 'token-first';

    const vizUrl2 = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook2/view2';
    const token2 = 'token-second';

    // Call embedTableauViz twice
    embedTableauViz(vizUrl1, token1);
    embedTableauViz(vizUrl2, token2);

    const container = document.getElementById('tableauVizContainer');
    const vizElement = container?.querySelector('tableau-viz');

    // The remaining viz should reflect the SECOND call (most recent wins)
    expect(vizElement?.getAttribute('src')).toBe(vizUrl2);
    expect(vizElement?.getAttribute('token')).toBe(token2);
  });

  it('should set viz height from firstvizsizeknown event', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    embedTableauViz(vizUrl, token);

    const container = document.getElementById('tableauVizContainer');
    const vizElement = container?.querySelector('tableau-viz') as HTMLElement;

    expect(vizElement).toBeTruthy();

    // Simulate firstvizsizeknown event with viz dimensions
    const event = new CustomEvent('firstvizsizeknown', {
      detail: {
        vizSize: {
          sheetSize: {
            maxSize: {
              width: 1200,
              height: 800,
            },
          },
        },
      },
    });

    vizElement.dispatchEvent(event);

    // Should set height attribute and style for the Embedding API iframe sizing
    expect(vizElement.getAttribute('height')).toBe('800');
    expect(vizElement.style.height).toBe('800px');
  });

  it('should set width to 100% string to preserve responsive behavior', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    embedTableauViz(vizUrl, token);

    const container = document.getElementById('tableauVizContainer');
    const vizElement = container?.querySelector('tableau-viz') as HTMLElement;

    expect(vizElement).toBeTruthy();

    // Simulate firstvizsizeknown event with viz dimensions
    const event = new CustomEvent('firstvizsizeknown', {
      detail: {
        vizSize: {
          sheetSize: {
            maxSize: {
              width: 1200,
              height: 800,
            },
          },
        },
      },
    });

    vizElement.dispatchEvent(event);

    // Width should be set to "100%" to maintain responsive behavior
    expect(vizElement.getAttribute('width')).toBe('100%');
  });

  it('should leave height unset when firstvizsizeknown has no numeric height', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    embedTableauViz(vizUrl, token);

    const container = document.getElementById('tableauVizContainer');
    const vizElement = container?.querySelector('tableau-viz') as HTMLElement;

    expect(vizElement).toBeTruthy();

    // Simulate firstvizsizeknown event with empty detail
    const event = new CustomEvent('firstvizsizeknown', {
      detail: {},
    });

    vizElement.dispatchEvent(event);

    // Height should remain unset
    expect(vizElement.style.height).toBe('');
  });
});
