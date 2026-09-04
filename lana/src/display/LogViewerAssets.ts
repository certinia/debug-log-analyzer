/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export interface EmbeddedLogViewerAssets {
  html: string;
  script: string;
  codiconCss: string;
  codiconFont: string;
}

let embeddedAssets: EmbeddedLogViewerAssets | undefined;

export function setEmbeddedLogViewerAssets(assets: EmbeddedLogViewerAssets | undefined): void {
  embeddedAssets = assets;
}

export function getEmbeddedLogViewerAssets(): EmbeddedLogViewerAssets | undefined {
  return embeddedAssets;
}
