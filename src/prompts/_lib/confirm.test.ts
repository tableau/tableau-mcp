import { renderConfirmInstructions, renderHitlGate } from './confirm.js';

describe('renderHitlGate', () => {
  it('emits a stop instruction and forbids acting without approval', () => {
    const text = renderHitlGate({
      actionVerb: 'delete',
      actionGerund: 'deletion',
      itemNounSingular: 'stale item',
      itemNounPlural: 'stale items',
    });
    expect(text).toContain('STOP');
    expect(text).toContain('REQUIRED HUMAN CONFIRMATION');
    expect(text).toContain('explicitly approve');
    expect(text).toContain("Do NOT delete anything without the user's explicit approval");
  });

  it('uses the gerund form in the "queued for" slot', () => {
    const text = renderHitlGate({
      actionVerb: 'tag or delete',
      actionGerund: 'tagging or deletion',
      itemNounSingular: 'stale item',
      itemNounPlural: 'stale items',
    });
    expect(text).toContain('before any tagging or deletion');
    expect(text).toContain('stale items queued for tagging or deletion');
    // The verb form drives the do-NOT line.
    expect(text).toContain('Do NOT tag or delete anything');
  });

  it('lists the columns to present per item when provided', () => {
    const text = renderHitlGate({
      actionVerb: 'delete',
      actionGerund: 'deletion',
      itemNounSingular: 'stale item',
      itemNounPlural: 'stale items',
      presentColumns: ['Item Name', 'Owner Email'],
    });
    expect(text).toContain('Item Name, Owner Email');
  });

  it('is content-type agnostic — uses the provided action and nouns', () => {
    const text = renderHitlGate({
      actionVerb: 'archive',
      actionGerund: 'archival',
      itemNounSingular: 'license',
      itemNounPlural: 'licenses',
    });
    expect(text).toContain('before any archival');
    expect(text).toContain('licenses queued for archival');
  });
});

describe('renderConfirmInstructions', () => {
  it('inserts the tool reference and requires confirm: true with the preview token', () => {
    const text = renderConfirmInstructions({
      toolRef: '`delete-workbook`',
      itemNoun: 'stale item',
    });
    expect(text).toContain('`delete-workbook`');
    expect(text).toContain('`confirm: true`');
    expect(text).toContain('`confirmationToken`');
  });

  it('forbids auto-confirming or fabricating the token', () => {
    const text = renderConfirmInstructions({ toolRef: '`delete-datasource`' });
    expect(text).toContain('Do NOT auto-confirm');
    expect(text).toContain('Do NOT compute, guess, or reuse');
  });

  it('accepts a routing-table phrase as the tool reference', () => {
    const text = renderConfirmInstructions({
      toolRef: "the `deleteTool` the routing table maps the item's `itemType` to",
      itemNoun: 'stale item',
    });
    expect(text).toContain('the routing table maps');
  });
});
