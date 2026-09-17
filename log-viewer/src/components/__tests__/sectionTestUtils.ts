/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * A section's own sentence for a log that arrived with nothing to show.
 *
 * A section that waits on the log renders `<section-skeleton>`, which shimmers
 * until the status says the log is in. Nothing provides that status in a test,
 * so it is set here rather than each suite standing up a provider.
 */
export async function settledNote(element: Element): Promise<string> {
  const skeleton = element.shadowRoot?.querySelector('section-skeleton');
  if (!skeleton) {
    return element.shadowRoot?.querySelector('.note')?.textContent ?? '';
  }
  skeleton.logStatus = 'ready';
  await skeleton.updateComplete;
  return skeleton.shadowRoot?.querySelector('.note')?.textContent ?? '';
}
