/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Uri, WebviewPanel, WebviewPanelOptions, window } from "vscode";

export class WebViewOptions implements WebviewPanelOptions {
  enableCommandUris: boolean = true;
  enableScripts: boolean = true;
  retainContextWhenHidden: boolean = true;
  localResourceRoots: Uri[];
  enableFindWidget: boolean = true;

  constructor(resourceRoots: Uri[]) {
    this.localResourceRoots = resourceRoots;
  }
}

export class WebView {
  static apply(
    name: string,
    title: string,
    resourceRoots: Uri[]
  ): WebviewPanel {
    return window.createWebviewPanel(
      name,
      title,
      -1,
      new WebViewOptions(resourceRoots)
    );
  }
}
