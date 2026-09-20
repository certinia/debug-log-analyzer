/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LitElement } from 'lit';

/** Props to assign, or a callback for a suite that needs more than assignment. */
type Configure<T> = Partial<T> | ((element: T) => void);

/**
 * Create a custom element, configure it, put it in the document and wait for its first
 * render. A suite needing more settling than one render awaits it itself, so the extra
 * wait stays where a reader can see what it is for.
 *
 * The tag is a string, not a `HTMLElementTagNameMap` key: 44 of the 65 components declare
 * no map entry, so the element type is named at the call site.
 */
export async function mountElement<T extends LitElement>(
  tag: string,
  configure?: Configure<T>,
): Promise<T> {
  const element = document.createElement(tag) as unknown as T;
  if (!('updateComplete' in element)) {
    // Without this, a tag that is unregistered or registered to a non-Lit element awaits its
    // undefined `updateComplete` happily and the suite fails later on a null shadowRoot. The
    // usual cause is a missing side-effect `import '../Thing.js'`: a type-only import of the
    // class is elided, so the module never runs and never registers.
    throw new Error(`<${tag}> is not a rendered Lit element — is its module imported?`);
  }
  if (typeof configure === 'function') {
    configure(element);
  } else if (configure) {
    Object.assign(element, configure);
  }
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}
