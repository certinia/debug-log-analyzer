/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import codiconCss from 'virtual:lana-codicon-css';
import codiconFont from 'virtual:lana-codicon-font';
import logViewerHtml from 'virtual:lana-log-viewer-html';
import logViewerScript from 'virtual:lana-log-viewer-script';

import { setEmbeddedLogViewerAssets } from './display/LogViewerAssets.js';

setEmbeddedLogViewerAssets({
  html: logViewerHtml,
  script: logViewerScript,
  codiconCss,
  codiconFont,
});

export { activate, context, deactivate } from './Main.js';
