/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */

declare function acquireVsCodeApi(): VSCodeAPI;

interface VSCodeAPI {
  postMessage(message: any): void;
}

export type OpenInfo = {
  typeName: string;
  text: string;
};

export function hostService(): HostService {
  return VSCodeService.instance();
}

export interface HostService {
  openPath(path: string): void;
  openType(info: OpenInfo): void;
  openHelp(): void;
  getConfig(): void;
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
      console.log("acquireVsCodeApi() exception: " + e);
    }
  }

  openPath(path: string) {
    if (this.vscodeAPIInstance) {
      this.vscodeAPIInstance.postMessage({
        cmd: "openPath",
        path: path,
      });
    } else {
      console.log(`VSCodeService.openPath(${path}) with no VSCode instance.`);
    }
  }

  openType(info: OpenInfo) {
    if (this.vscodeAPIInstance) {
      this.vscodeAPIInstance.postMessage({
        cmd: "openType",
        typeName: info.typeName,
        text: info.text,
      });
    } else {
      console.log(`VSCodeService.openType(${info}) with no VSCode instance.`);
    }
  }

  openHelp() {
    if (this.vscodeAPIInstance) {
      this.vscodeAPIInstance.postMessage({ cmd: "openHelp" });
    } else {
      console.log(`VSCodeService.open() with no VSCode instance.`);
    }
  }

  getConfig() {
    if (this.vscodeAPIInstance) {
      this.vscodeAPIInstance.postMessage({ cmd: "getConfig" });
    } else {
      console.log(`VSCodeService.getConfig() with no VSCode instance.`);
    }
  }
}
