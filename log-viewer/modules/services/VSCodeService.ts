/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */

declare function acquireVsCodeApi(): VSCodeAPI;

interface VSCodeAPI {
  postMessage(message: unknown): void;
}

export type OpenInfo = {
  typeName: string;
  text: string;
};

export function hostService(): HostService {
  return VSCodeService.instance();
}

export interface HostService {
  fetchLog(): void;
  openPath(path: string): void;
  saveFile(request: { fileContent: string; defaultFilename: string }): void;
  openType(info: OpenInfo): void;
  openHelp(): void;
  getConfig(): void;
  showError(text: string): void;
}

export class VSCodeService implements HostService {
  private static _instance: VSCodeService | null = null;
  private vscodeAPIInstance: VSCodeAPI | null = null;

  static instance(): VSCodeService {
    if (!this._instance) {
      this._instance = new VSCodeService();
    }
    return this._instance;
  }

  private constructor() {
    try {
      this.vscodeAPIInstance = acquireVsCodeApi();
    } catch (e) {
      throw new Error(`acquireVsCodeApi() exception: ${e}`);
    }
  }

  getVsCodeAPIInstance() {
    if (VSCodeService._instance && !this.vscodeAPIInstance) {
      throw new Error(`VsCodeApi not found`);
    }
    return this.vscodeAPIInstance;
  }

  fetchLog() {
    this.getVsCodeAPIInstance()?.postMessage({
      cmd: 'fetchLog',
    });
  }

  openPath(path: string) {
    this.getVsCodeAPIInstance()?.postMessage({
      cmd: 'openPath',
      path: path,
    });
  }

  openType(info: OpenInfo) {
    this.getVsCodeAPIInstance()?.postMessage({
      cmd: 'openType',
      typeName: info.typeName,
      text: info.text,
    });
  }

  openHelp() {
    this.getVsCodeAPIInstance()?.postMessage({ cmd: 'openHelp' });
  }

  getConfig() {
    this.getVsCodeAPIInstance()?.postMessage({ cmd: 'getConfig' });
  }

  saveFile(request: { fileContent: string; defaultFilename: string }) {
    this.getVsCodeAPIInstance()?.postMessage({
      cmd: 'saveFile',
      text: request.fileContent,
      options: { defaultUri: request.defaultFilename },
    });
  }

  showError(text: string) {
    this.getVsCodeAPIInstance()?.postMessage({
      cmd: 'showError',
      text: text,
    });
  }
}
