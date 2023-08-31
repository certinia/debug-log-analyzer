/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';

import '../resources/css/Settings.css';
import '../resources/css/Status.css';
import '../resources/css/Tabber.css';
import { showTab } from './Util';
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

provideVSCodeDesignSystem().register(vsCodeButton());

let logSize: number;
export let rootMethod: RootNode;

async function setStatus(name: string, path: string, status: string, color?: string) {
  const statusHolder = document.getElementById('status') as HTMLDivElement,
    nameSpan = document.createElement('span'),
    nameLink = document.createElement('a'),
    statusSpan = document.createElement('span'),
    sizeText = logSize ? (logSize / 1000000).toFixed(2) + ' MB' : '',
    elapsedText = totalDuration ? (totalDuration / 1000000000).toFixed(3) + ' Sec' : '',
    infoSep = sizeText && elapsedText ? ', ' : '',
    infoText = sizeText || elapsedText ? '\xA0(' + sizeText + infoSep + elapsedText + ')' : '';

  nameLink.setAttribute('href', '#');
  nameLink.appendChild(document.createTextNode(name));
  nameLink.addEventListener('click', () => hostService().openPath(path));
  nameSpan.appendChild(nameLink);
  nameSpan.appendChild(document.createTextNode(infoText + '\xA0-\xA0'));

  statusSpan.innerText = status;
  if (color) {
    statusSpan.style.color = color;
  }

  statusHolder.innerHTML = '';
  statusHolder.appendChild(nameSpan);
  statusHolder.appendChild(statusSpan);

  if (Array.isArray(truncated)) {
    truncated.forEach((entry) => {
      const reasonSpan = document.createElement('span');

      reasonSpan.innerText = entry.reason;
      reasonSpan.className = 'status__reason';
      reasonSpan.style.backgroundColor = entry.color;

      const tooltipSpan = document.createElement('span');
      tooltipSpan.className = 'status__tooltip';
      tooltipSpan.innerText = entry.reason;

      statusHolder.appendChild(reasonSpan);
      statusHolder.appendChild(tooltipSpan);
    });
  }
  await waitForRender();
}

async function renderLogSettings(logSettings: LogSetting[]) {
  const holder = document.getElementById('log-settings') as HTMLDivElement;

  holder.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const { key, level } of logSettings) {
    if (level !== 'NONE') {
      const setting = document.createElement('div'),
        title = document.createElement('span'),
        value = document.createElement('span');

      setting.className = 'setting';
      title.innerText = key + ':';
      title.className = 'setting__title';
      value.innerText = level;
      value.className = 'setting__level';

      setting.appendChild(title);
      setting.appendChild(value);
      fragment.appendChild(setting);
    }
  }

  holder.appendChild(fragment);
}

async function displayLog(log: string, name: string, path: string) {
  name = name.trim();
  path = path.trim();
  logSize = log.length;
  await setStatus(name, path, 'Processing...');
  await Promise.all([renderLogSettings(getLogSettings(log)), parseLog(log)]);
  rootMethod = getRootMethod();

  await Promise.all([setStatus(name, path, 'Rendering...'), renderTimeline(rootMethod)]);
  initDBRender(rootMethod);
  initAnalysisRender(rootMethod);
  initCalltree(rootMethod);

  setStatus(name, path, 'Ready', truncated.length > 0 ? 'red' : 'green');
}

async function waitForRender() {
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve));
}

function readLog() {
  const name = document.getElementById('LOG_FILE_NAME')?.innerHTML;
  const path = document.getElementById('LOG_FILE_PATH')?.innerHTML;
  const logUri = document.getElementById('LOG_FILE_URI')?.innerHTML;

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
        setStatus(name || '', path || '', 'Ready', 'red');
      });
  }
}

function onTabSelect(evt: Event) {
  const input = evt.target as HTMLElement;
  showTab(input.id);
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
  const tabHolder = document.querySelector('.tab-holder');
  tabHolder?.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', onTabSelect));

  const rightNavBar = document.querySelector('.navbar--right');
  if (rightNavBar) {
    // TODO: refactor to a component + refactor app header bar too
    // TODO: Ensure we have vscode Outgoing link protection for this link
    // TODO: use @vscode/codicons instead of the svg
    const helpButtonWrapper = document.createElement('div');
    helpButtonWrapper.addEventListener('click', () => hostService().openHelp());
    helpButtonWrapper.innerHTML = `<vscode-button appearance="icon" aria-label="Help" title="Help" class="help__icon">
    <svg width="24" height="24" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.07505 4.10001C5.07505 2.91103 6.25727 1.92502 7.50005 1.92502C8.74283 1.92502 9.92505 2.91103 9.92505 4.10001C9.92505 5.19861 9.36782 5.71436 8.61854 6.37884L8.58757 6.4063C7.84481 7.06467 6.92505 7.87995 6.92505 9.5C6.92505 9.81757 7.18248 10.075 7.50005 10.075C7.81761 10.075 8.07505 9.81757 8.07505 9.5C8.07505 8.41517 8.62945 7.90623 9.38156 7.23925L9.40238 7.22079C10.1496 6.55829 11.075 5.73775 11.075 4.10001C11.075 2.12757 9.21869 0.775024 7.50005 0.775024C5.7814 0.775024 3.92505 2.12757 3.92505 4.10001C3.92505 4.41758 4.18249 4.67501 4.50005 4.67501C4.81761 4.67501 5.07505 4.41758 5.07505 4.10001ZM7.50005 13.3575C7.9833 13.3575 8.37505 12.9657 8.37505 12.4825C8.37505 11.9992 7.9833 11.6075 7.50005 11.6075C7.0168 11.6075 6.62505 11.9992 6.62505 12.4825C6.62505 12.9657 7.0168 13.3575 7.50005 13.3575Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
    </vscode-button>`;
    rightNavBar.appendChild(helpButtonWrapper);
  }

  hostService().getConfig();
  readLog();
}

window.addEventListener('DOMContentLoaded', onInit);
window.addEventListener('message', handleMessage);
