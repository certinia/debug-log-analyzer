/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Uri, window, type WebviewPanel, type WebviewPanelOptions } from 'vscode';

export class WebView {
  static apply(name: string, title: string, resourceRoots: Uri[]): WebviewPanel {
    return window.createWebviewPanel(name, title, -1, new WebViewOptions(resourceRoots));
  }
}

class WebViewOptions implements WebviewPanelOptions {
  enableCommandUris = true;
  enableScripts = true;
  retainContextWhenHidden = true;
  localResourceRoots: Uri[];
  enableFindWidget = true;

  constructor(resourceRoots: Uri[]) {
    this.localResourceRoots = resourceRoots;
  }
}
