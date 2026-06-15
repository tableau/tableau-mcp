/**
 * @file Tests for embedTableauViz
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTableauVizElement,
  embedTableauViz,
  extractViewUrlFromResult,
} from './embedTableauViz.js';

describe('createTableauVizElement', () => {
  it('should create a tableau-viz element with correct attributes', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    const element = createTableauVizElement(vizUrl, token);

    expect(element.tagName.toLowerCase()).toBe('tableau-viz');
    expect(element.getAttribute('src')).toBe(vizUrl);
    expect(element.getAttribute('token')).toBe(token);
    expect(element.getAttribute('toolbar')).toBe('bottom');
    expect(element.getAttribute('hide-tabs')).toBe('false');
    expect(element.style.width).toBe('100%');
    expect(element.style.height).toBe('100%');
  });
});

describe('embedTableauViz', () => {
  beforeEach(() => {
    // Set up DOM
    const container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  it('should embed viz into container', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    embedTableauViz('test-container', vizUrl, token);

    const container = document.getElementById('test-container');
    const vizElement = container?.querySelector('tableau-viz');

    expect(vizElement).toBeTruthy();
    expect(vizElement?.getAttribute('src')).toBe(vizUrl);
    expect(vizElement?.getAttribute('token')).toBe(token);
  });

  it('should clear existing content before embedding', () => {
    const container = document.getElementById('test-container');
    const existingPara = document.createElement('p');
    existingPara.textContent = 'Existing content';
    container?.appendChild(existingPara);

    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    embedTableauViz('test-container', vizUrl, token);

    expect(container?.querySelector('p')).toBeNull();
    expect(container?.querySelector('tableau-viz')).toBeTruthy();
  });

  it('should throw error if container not found', () => {
    const vizUrl = 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view';
    const token = 'test-token-123';

    expect(() => embedTableauViz('nonexistent-container', vizUrl, token)).toThrow(
      'Container element with id "nonexistent-container" not found',
    );
  });
});

describe('extractViewUrlFromResult', () => {
  it('should extract viewUrl from result', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            viewUrl: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    const url = extractViewUrlFromResult(result);
    expect(url).toBe('https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view');
  });

  it('should extract contentUrl as fallback', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            contentUrl: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    const url = extractViewUrlFromResult(result);
    expect(url).toBe('https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view');
  });

  it('should extract webpageUrl as fallback', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            webpageUrl: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    const url = extractViewUrlFromResult(result);
    expect(url).toBe('https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view');
  });

  it('should extract url as final fallback', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            url: 'https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view',
          }),
        },
      ],
    };

    const url = extractViewUrlFromResult(result);
    expect(url).toBe('https://prod-uswest-c.online.tableau.com/site/mysite/views/workbook/view');
  });

  it('should return null if no URL found', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: 'Some View',
          }),
        },
      ],
    };

    const url = extractViewUrlFromResult(result);
    expect(url).toBeNull();
  });

  it('should return null if content is not text', () => {
    const result = {
      content: [
        {
          type: 'image',
          data: 'base64-data',
        },
      ],
    };

    const url = extractViewUrlFromResult(result);
    expect(url).toBeNull();
  });

  it('should return null if JSON parsing fails', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: 'invalid-json',
        },
      ],
    };

    const url = extractViewUrlFromResult(result);
    expect(url).toBeNull();
  });

  it('should return null if result has no content', () => {
    const result = {};

    const url = extractViewUrlFromResult(result);
    expect(url).toBeNull();
  });
});
