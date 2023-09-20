/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

import '../modules/app-header/AppHeader';
import parseLog, {
  RootNode,
  getLogSettings,
  getRootMethod,
  totalDuration,
  truncateLog,
  truncated,
} from './parsers/TreeParser';
import { hostService } from './services/VSCodeService';
import { setColors } from './timeline/Timeline';

export let rootMethod: RootNode;

let logName: string, logPath: string, logSize: number, logUri: string;

// todo: move to a lit component + remove need for event dispatching
async function displayLog(log: string, name: string, path: string) {
  logName = name.trim();
  logPath = path.trim();
  logSize = log.length;

  document.dispatchEvent(
    new CustomEvent('logsettings', {
      detail: { logSettings: getLogSettings(log) },
    })
  );
  dispatchLogContextUpdate('Processing...');

  await Promise.all([waitForRender(), parseLog(log)]);
  rootMethod = getRootMethod();
  dispatchLogContextUpdate('Processing...');
  dispatchLogContextUpdate('Ready');
}

async function waitForRender() {
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve));
}

function readLog() {
  logName = document.getElementById('LOG_FILE_NAME')?.innerHTML || '';
  logPath = document.getElementById('LOG_FILE_PATH')?.innerHTML || '';
  logUri = document.getElementById('LOG_FILE_URI')?.innerHTML || '';

  dispatchLogContextUpdate('Processing...');

  if (logUri) {
    fetch(logUri)
      .then((response) => {
        if (response.ok) {
          return response.text();
        } else {
          throw Error(response.statusText);
        }
      })
      .then((data) => {
        displayLog(data ?? '', logName ?? '', logPath ?? '');
      })
      .catch((err: unknown) => {
        let msg;
        if (err instanceof Error) {
          msg = err.name === 'TypeError' ? name : err.message;
        } else {
          msg = String(err);
        }
        msg = `Could not read log: ${msg}`;

        truncateLog(0, msg, 'error');
      });
  }
}

function handleMessage(evt: MessageEvent) {
  const message = evt.data;
  switch (message.command) {
    case 'getConfig':
      setColors(message.data.timeline.colors);
      break;
    case 'streamLog':
      displayLog(message.data, message.name, '');
  }
}

function onInit(): void {
  const headerWrapper = document.getElementById('header-wrapper');
  headerWrapper && render(html`<app-header></app-header>`, headerWrapper);

  hostService().getConfig();
  readLog();
}

function dispatchLogContextUpdate(status: string): void {
  document.dispatchEvent(
    new CustomEvent('logcontext', {
      detail: {
        name: logName,
        path: logPath,
        uri: logUri,
        size: logSize,
        duration: totalDuration,
        status: status,
        truncated: truncated,
        timelineRoot: rootMethod,
      },
    })
  );
}

window.addEventListener('DOMContentLoaded', onInit);
window.addEventListener('message', handleMessage);
