/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
export class VSCodeExtensionMessenger {
  private static vscode: VSCodeAPI<unknown>;
  private static instance: VSCodeExtensionMessenger;
  private static listeners = new Map<string, ListenerType>();

  private constructor() {
    VSCodeExtensionMessenger.listen((event) => {
      const { requestId, payload, error } = event.data;

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
      // Only the extension host injects this. Outside a webview (standalone browser
      // host) every caller already handles a null API, so degrade to no-op
      // messaging instead of throwing.
      if (typeof acquireVsCodeApi !== 'function') {
        return null;
      }
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
      const listener = (incomingPayload: unknown, error: unknown) => {
        if (error) {
          reject(error);
        } else {
          resolve(incomingPayload as T);
        }
        VSCodeExtensionMessenger.listeners.delete(reqId);
      };

      VSCodeExtensionMessenger.listeners.set(reqId, listener);

      const vscode = this.getVsCodeAPI();
      if (!vscode) {
        // Nothing will ever answer, so fail the caller instead of leaving the
        // promise pending forever.
        VSCodeExtensionMessenger.listeners.delete(reqId);
        reject(new Error(`No extension host to answer "${message}"`));
        return;
      }

      if (payload) {
        vscode.postMessage({ cmd: message, requestId: reqId, payload });
      } else {
        vscode.postMessage({ cmd: message, requestId: reqId });
      }
    });
  }

  /** Listens for extension messages; returns the function that removes the listener. */
  public static listen<T>(callback: (event: MessageEvent<VSCodeMessage<T>>) => void): () => void {
    const listener = (event: MessageEvent<unknown>) => {
      if (!isVSCodeMessage(event.data)) {
        return;
      }

      callback(event as MessageEvent<VSCodeMessage<T>>);
    };

    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
    };
  }
}

declare function acquireVsCodeApi(): VSCodeAPI<unknown>;

interface VSCodeAPI<T> {
  postMessage: (msg: T) => void;
}

interface VSCodeMessage<T> {
  cmd: string;
  payload: T;
  requestId?: string;
  error?: unknown;
}

type ListenerType = <T, K>(payload: T, error: K) => void;

function isVSCodeMessage(value: unknown): value is VSCodeMessage<unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const message = value as Record<string, unknown>;
  return (
    typeof message.cmd === 'string' &&
    (message.requestId === undefined || typeof message.requestId === 'string')
  );
}

export const vscodeMessenger = VSCodeExtensionMessenger.getInstance();
