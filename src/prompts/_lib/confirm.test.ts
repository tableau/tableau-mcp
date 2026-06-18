import { renderConfirmInstructions, renderHitlGate } from './confirm.js';

describe('renderHitlGate', () => {
  it('emits a stop instruction and forbids acting without approval', () => {
    const text = renderHitlGate({ action: 'delete', itemNoun: 'stale item' });
    expect(text).toContain('STOP');
    expect(text).toContain('REQUIRED HUMAN CONFIRMATION');
    expect(text).toContain('explicit approval');
    expect(text).toContain("Do NOT delete anything without the user's explicit approval");
  });

  it('includes the item count when provided', () => {
    const text = renderHitlGate({ action: 'delete', itemNoun: 'stale item', itemCount: 7 });
    expect(text).toContain('the 7 stale item(s)');
  });

  it('lists the columns to present per item when provided', () => {
    const text = renderHitlGate({
      action: 'delete',
      itemNoun: 'stale item',
      presentColumns: ['Item Name', 'Owner Email'],
    });
    expect(text).toContain('Item Name, Owner Email');
  });

  it('is content-type agnostic — uses the provided action verb and noun', () => {
    const text = renderHitlGate({ action: 'archive', itemNoun: 'license' });
    expect(text).toContain('before any archive');
    expect(text).toContain('license(s) queued for archive');
  });
});

describe('renderConfirmInstructions', () => {
  it('names the tool and requires confirm: true with the preview token', () => {
    const text = renderConfirmInstructions({ toolName: 'delete-workbook', itemNoun: 'stale item' });
    expect(text).toContain('`delete-workbook`');
    expect(text).toContain('`confirm: true`');
    expect(text).toContain('`confirmationToken`');
  });

  it('forbids auto-confirming or fabricating the token', () => {
    const text = renderConfirmInstructions({ toolName: 'delete-datasource' });
    expect(text).toContain('Do NOT auto-confirm');
    expect(text).toContain('Do NOT compute, guess, or reuse');
  });
});
