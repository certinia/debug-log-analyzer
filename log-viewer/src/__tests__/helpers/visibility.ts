/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** jsdom has no IntersectionObserver: this one reports every element in view at once. */
export class AlwaysVisible {
  private _callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this._callback = callback;
  }

  observe(element: Element): void {
    this._callback(
      [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect(): void {}
}

/** An IntersectionObserver that never reports an element in view. */
export class NeverVisible {
  observe(): void {}
  disconnect(): void {}
}

/** Lets a build's promise chain run out: more turns than it takes. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
