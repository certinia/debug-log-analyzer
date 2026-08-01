/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Watches the host's appearance and notifies subscribers when it changes.
 *
 * Inside a VS Code webview the preload re-applies the whole `--vscode-*` block on
 * `documentElement.style` and rewrites the `body` theme classes on every theme
 * change, so anything expressed in CSS re-themes by itself. Values *read into JS*
 * (canvas/WebGL colors, anything through `getComputedStyle`) do not — this is how
 * they learn to refresh.
 *
 * Standalone hosts get the same contract: any change to those attributes, or to the
 * OS colour-scheme preference, fires a notification.
 */

class ThemeObserverImpl {
  private listeners = new Set<() => void>();
  private mutationObserver: MutationObserver | null = null;
  private colorScheme: MediaQueryList | null = null;
  private pendingFrame: number | null = null;
  private readonly notify = () => {
    this.pendingFrame = null;
    this.listeners.forEach((listener) => {
      listener();
    });
  };

  /**
   * Subscribe to appearance changes. Returns the unsubscribe function; the
   * underlying observers exist only while there is at least one subscriber.
   */
  on(listener: () => void): () => void {
    this.listeners.add(listener);
    this.connect();

    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.disconnect();
      }
    };
  }

  private connect(): void {
    if (this.mutationObserver) {
      return;
    }

    this.mutationObserver = new MutationObserver(() => {
      this.schedule();
    });
    // `documentElement.style` is where the preload re-sets the `--vscode-*` block;
    // the body attributes carry the kind, id and name.
    this.mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    this.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-vscode-theme-kind', 'data-vscode-theme-id'],
    });

    this.colorScheme = globalThis.matchMedia?.('(prefers-color-scheme: light)') ?? null;
    this.colorScheme?.addEventListener('change', this.schedule);
  }

  private disconnect(): void {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.colorScheme?.removeEventListener('change', this.schedule);
    this.colorScheme = null;
    if (this.pendingFrame !== null) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
  }

  /**
   * A single theme change produces a burst of mutations (one per attribute, and the
   * style block is cleared before it is re-set), so coalesce to one frame —
   * subscribers re-read resolved values, which is only valid after the burst ends.
   */
  private readonly schedule = () => {
    if (this.pendingFrame === null) {
      this.pendingFrame = requestAnimationFrame(this.notify);
    }
  };
}

export const themeObserver = new ThemeObserverImpl();
