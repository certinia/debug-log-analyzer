/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import '../resources/css/AnalysisView.css';
import '../resources/css/Settings.css';
import '../resources/css/Status.css';
import '../resources/css/Tabber.css';
import '../resources/css/TimelineView.css';
import '../resources/css/TreeView.css';
import { DatabaseAccess } from './Database';
import { setNamespaces } from './NamespaceExtrator';
import renderTimeline, { renderTimelineKey, setColors } from './Timeline';
import { showTab } from './Util';
import { initAnalysisRender } from './analysis-view/AnalysisView';
import { initCalltree } from './calltree-view/CalltreeView';
import { initDBRender } from './database-view/DatabaseView';
import parseLog, {
  LogSetting,
  RootNode,
  TimedNode,
  getLogSettings,
  getRootMethod,
  totalDuration,
  truncateLog,
  truncated,
} from './parsers/TreeParser';
import { hostService } from './services/VSCodeService';

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
      reasonSpan.className = 'reason';
      reasonSpan.style.backgroundColor = entry.color;

      const tooltipSpan = document.createElement('span');
      tooltipSpan.className = 'tooltip';
      tooltipSpan.innerText = entry.reason;

      statusHolder.appendChild(reasonSpan);
      statusHolder.appendChild(tooltipSpan);
    });
  }
  await waitForRender();
}

async function aggregateTotals(node: TimedNode) {
  const children = node.children,
    len = children.length;

  for (let i = 0; i < len; ++i) {
    const child = children[i];
    if (child instanceof TimedNode) {
      await aggregateTotals(child);
    }
    node.totalDmlCount += child.totalDmlCount;
    node.totalSoqlCount += child.totalSoqlCount;
    node.totalThrownCount += child.totalThrownCount;
    node.rowCount += child.rowCount;
  }
}

let timerText: string, startTime: number;

function timer(text: string) {
  const time = Date.now();
  if (timerText) {
    console.debug(timerText + ' = ' + (time - startTime) + 'ms');
  }
  timerText = text;
  startTime = time;
}

async function renderLogSettings(logSettings: LogSetting[]) {
  const holder = document.getElementById('logSettings') as HTMLDivElement;

  holder.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const { key, level } of logSettings) {
    if (level !== 'NONE') {
      const setting = document.createElement('div'),
        title = document.createElement('span'),
        value = document.createElement('span');

      title.innerText = key + ':';
      title.className = 'settingTitle';
      value.innerText = level;
      value.className = 'settingValue';
      setting.className = 'setting';
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

  timer('parseLog');
  await Promise.all([renderLogSettings(getLogSettings(log)), parseLog(log)]);

  timer('getRootMethod');
  rootMethod = getRootMethod();

  timer('analyse');
  await Promise.all([setNamespaces(rootMethod), aggregateTotals(rootMethod)]);
  await Promise.all([DatabaseAccess.create(rootMethod)]);

  await setStatus(name, path, 'Rendering...');

  timer('renderViews');
  await renderTimeline(rootMethod);

  initDBRender();
  initAnalysisRender(rootMethod);
  initCalltree(rootMethod);

  timer('');
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
  const tabHolder = document.querySelector('.tabHolder');
  tabHolder?.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', onTabSelect));

  const helpButton = document.querySelector('.helpLink');
  if (helpButton) {
    helpButton.addEventListener('click', () => hostService().openHelp());
  }

  hostService().getConfig();
  readLog();
}

window.addEventListener('DOMContentLoaded', onInit);
window.addEventListener('message', handleMessage);
