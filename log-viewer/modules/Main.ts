/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

import '../modules/app-header/AppHeader';
import '../resources/css/Settings.css';
import '../resources/css/Status.css';
import '../resources/css/Tabber.css';
import { initAnalysisRender } from './analysis-view/AnalysisView';
import { initCalltree } from './calltree-view/CalltreeView';
import { initDBRender } from './database-view/DatabaseView';
import parseLog, {
  LogSetting,
  RootNode,
  getLogSettings,
  getRootMethod,
  totalDuration,
  truncateLog,
  truncated,
} from './parsers/TreeParser';
import { hostService } from './services/VSCodeService';
import renderTimeline, { renderTimelineKey, setColors } from './timeline/Timeline';

export let rootMethod: RootNode;
let name = '',
  path: string,
  logSize: number,
  logUri: string;

// todo: move to a lit component + remove need for event dispatching
async function displayLog(log: string, name: string, path: string) {
  name = name.trim();
  path = path.trim();
  logSize = log.length;

  document.dispatchEvent(
    new CustomEvent('logsettings', {
      detail: { logSettings: getLogSettings(log) },
    })
  );

  dispatchLogContextUpdate('Processing...');

  // await waitForRender();
  await Promise.all([waitForRender(), parseLog(log)]);
  rootMethod = getRootMethod();

  dispatchLogContextUpdate('Processing...');

  // await waitForRender();
  await Promise.all([waitForRender(), renderTimeline(rootMethod)]);
  // await renderTimeline(rootMethod);
  initDBRender(rootMethod);
  initAnalysisRender(rootMethod);
  initCalltree(rootMethod);

  dispatchLogContextUpdate('Ready');
}

async function waitForRender() {
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve));
}

function readLog() {
  name = document.getElementById('LOG_FILE_NAME')?.innerHTML || '';
  path = document.getElementById('LOG_FILE_PATH')?.innerHTML || '';
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
        displayLog(data ?? '', name ?? '', path ?? '');
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
      renderTimelineKey();
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
        name: name,
        path: path,
        uri: logUri,
        size: logSize,
        duration: totalDuration,
        status: status,
        truncated: truncated,
      },
    })
  );
}

window.addEventListener('DOMContentLoaded', onInit);
window.addEventListener('message', handleMessage);
