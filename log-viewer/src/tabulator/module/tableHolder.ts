/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** A table's scrolling body: what holds focus while the key bindings are live. */
export function tableHolder(host: HTMLElement | null | undefined): HTMLElement | null {
  return host?.querySelector<HTMLElement>('.tabulator-tableholder') ?? null;
}
