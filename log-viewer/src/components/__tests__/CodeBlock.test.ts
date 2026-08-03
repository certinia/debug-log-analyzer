/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeAll, describe, expect, it } from '@jest/globals';

jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

import type { CodeBlock } from '../CodeBlock.js';
import '../CodeBlock.js';

async function mount(configure: (el: CodeBlock) => void): Promise<CodeBlock> {
  const el = document.createElement('code-block') as CodeBlock;
  configure(el);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('CodeBlock', () => {
  beforeAll(() => {
    expect(customElements.get('code-block')).toBeDefined();
  });

  it('renders plain code verbatim', async () => {
    const el = await mount((e) => {
      e.language = 'plain';
      e.code = 'DML Op:Insert Type:Account';
    });
    expect(el.shadowRoot?.querySelector('pre')?.textContent).toContain(
      'DML Op:Insert Type:Account',
    );
    expect(el.shadowRoot?.querySelector('.soql-block')).toBeNull();
  });

  it('syntax-highlights SOQL', async () => {
    const el = await mount((e) => {
      e.language = 'soql';
      e.code = 'SELECT Id FROM Account';
    });
    const block = el.shadowRoot?.querySelector('.soql-block');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain('SELECT');
    expect(block?.querySelector('.soql-tok-keyword')).not.toBeNull();
  });

  it('copies the code to the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const el = await mount((e) => {
      e.language = 'soql';
      e.code = 'SELECT Id FROM Account';
    });
    (el.shadowRoot?.querySelector('.copy') as HTMLElement | null)?.click();

    expect(writeText).toHaveBeenCalledWith('SELECT Id FROM Account');
  });
});
