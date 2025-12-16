/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
export class VSCodeExtensionMessenger {
  private static vscode: VSCodeAPI<unknown>;
  private static instance: VSCodeExtensionMessenger;
  private static listeners = new Map<string, ListenerType>();

  private constructor() {
    VSCodeExtensionMessenger.listen((message: MessageEvent<VSCodeMessage<ListenerType>>) => {
      const { requestId, payload, error } = message.data;

      if (requestId && VSCodeExtensionMessenger.listeners.has(requestId)) {
        VSCodeExtensionMessenger.listeners.get(requestId)?.(payload, error);
      }
    });
  }

  public static getInstance() {
    if (!VSCodeExtensionMessenger.instance) {
      VSCodeExtensionMessenger.instance = new VSCodeExtensionMessenger();
    }

    return VSCodeExtensionMessenger.instance;
  }

  public getVsCodeAPI<T>(): VSCodeAPI<T> | null {
    if (!VSCodeExtensionMessenger.vscode) {
      VSCodeExtensionMessenger.vscode = acquireVsCodeApi();
    }
    return VSCodeExtensionMessenger.vscode;
  }

  public send<T>(message: string, payload?: T): void {
    const vscode = this.getVsCodeAPI();
    if (!vscode) {
      return;
    }

    if (payload) {
      vscode.postMessage({ cmd: message, payload });
    } else {
      vscode.postMessage({ cmd: message });
    }
  }

  public request<T>(message: string, payload?: T): Promise<T> {
    const reqId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const listener = (incomingPayload: any, error: unknown) => {
        if (error) {
          reject(error);
        } else {
          resolve(incomingPayload);
        }
        VSCodeExtensionMessenger.listeners.delete(reqId);
      };

      VSCodeExtensionMessenger.listeners.set(reqId, listener);

      const vscode = this.getVsCodeAPI();
      if (!vscode) {
        return;
      }

      if (payload) {
        vscode.postMessage({ cmd: message, requestId: reqId, payload });
      } else {
        vscode.postMessage({ cmd: message, requestId: reqId });
      }
    });
  }

  public static listen<T>(callback: (event: MessageEvent<VSCodeMessage<T>>) => void): void {
    window.addEventListener('message', callback);
  }
}

declare function acquireVsCodeApi(): VSCodeAPI<unknown>;

interface VSCodeAPI<T> {
  postMessage: (msg: T) => void;
}

interface VSCodeMessage<T> extends MessageEvent<T> {
  cmd: string;
  payload: T;
  requestId?: string;
  error?: unknown;
}

type ListenerType = <T, K>(payload: T, error: K) => void;

export const vscodeMessenger = VSCodeExtensionMessenger.getInstance();
