/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { showTab } from './Util';
import parseLog, {
  getLogSettings,
  TimedNode,
  Method,
  LogSetting,
  truncated,
  totalDuration,
  getRootMethod,
} from './parsers/TreeParser';
import renderTreeView from './TreeView';
import renderTimeline, { setColors, renderTimelineKey } from './Timeline';
import analyseMethods, { renderAnalysis } from './Analysis';
import { DatabaseAccess } from './Database';
import { setNamespaces } from './NamespaceExtrator';
import { hostService } from './services/VSCodeService';
import { renderDb } from './components/Database';

import '../resources/css/Status.css';
import '../resources/css/Settings.css';
import '../resources/css/Tabber.css';
import '../resources/css/TreeView.css';
import '../resources/css/TimelineView.css';
import '../resources/css/AnalysisView.css';
import '../resources/css/DatabaseView.css';

declare global {
  interface Window {
    activeNamespaces: string[];
  }
}

let logSize: number;

async function setStatus(name: string, path: string, status: string, color: string) {
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
  statusSpan.style.color = color;

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

async function markContainers(node: TimedNode) {
  const children = node.children,
    len = children.length;

  node.totalDmlCount = 0;
  node.totalSoqlCount = 0;
  node.totalThrownCount = 0;

  for (let i = 0; i < len; ++i) {
    const child = children[i];

    if (child instanceof TimedNode) {
      if (child.type === 'DML_BEGIN') {
        ++node.totalDmlCount;
      }
      if (child.type === 'SOQL_EXECUTE_BEGIN') {
        ++node.totalSoqlCount;
      }
      if (child.type === 'EXCEPTION_THROWN') {
        ++node.totalThrownCount;
      }
      markContainers(child);
      node.totalDmlCount += child.totalDmlCount;
      node.totalSoqlCount += child.totalSoqlCount;
      node.totalThrownCount += child.totalThrownCount;
    }
  }
}

async function insertPackageWrappers(node: Method) {
  const children = node.children,
    isParentDml = node.type === 'DML_BEGIN';

  let lastPkg: TimedNode | null = null,
    i = 0;
  while (i < children.length) {
    const child = children[i],
      childType = child.type;

    if (lastPkg && child instanceof TimedNode) {
      if (childType === 'ENTERING_MANAGED_PKG' && child.namespace === lastPkg.namespace) {
        // combine adjacent (like) packages
        children.splice(i, 1); // remove redundant child from parent

        lastPkg.exitStamp = child.exitStamp;
        lastPkg.recalculateDurations();
        continue; // skip any more child processing (it's gone)
      } else if (
        (isParentDml && (childType === 'DML_BEGIN' || childType === 'SOQL_EXECUTE_BEGIN')) ||
        childType === 'EXCEPTION_THROWN'
      ) {
        // move child DML / SOQL into the last package
        children.splice(i, 1); // remove moving child from parent
        if (lastPkg.children) {
          lastPkg.children.push(child); // move child into the pkg
        }

        lastPkg.totalDmlCount = child.totalDmlCount + (childType === 'DML_BEGIN' ? 1 : 0);
        lastPkg.totalSoqlCount =
          child.totalSoqlCount + (childType === 'SOQL_EXECUTE_BEGIN' ? 1 : 0);
        lastPkg.totalThrownCount =
          child.totalThrownCount + (childType === 'EXCEPTION_THROWN' ? 1 : 0);
        lastPkg.exitStamp = child.exitStamp; // move the end
        lastPkg.recalculateDurations();
        if (child instanceof Method) {
          await insertPackageWrappers(child);
        }
        continue; // skip any more child processing (it's moved)
      } else {
        ++i;
      }
    } else {
      ++i;
    }
    if (child instanceof Method) {
      await insertPackageWrappers(child);
    }
    lastPkg = childType === 'ENTERING_MANAGED_PKG' ? (child as TimedNode) : null;
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
  logSize = log.length;
  await setStatus(name, path, 'Processing...', 'black');

  timer('parseLog');
  await Promise.all([renderLogSettings(getLogSettings(log)), parseLog(log)]);

  timer('getRootMethod');
  const rootMethod = getRootMethod();

  timer('analyse');
  await Promise.all([setNamespaces(rootMethod), markContainers(rootMethod)]);
  await insertPackageWrappers(rootMethod);
  await Promise.all([analyseMethods(rootMethod), DatabaseAccess.create(rootMethod)]);

  await setStatus(name, path, 'Rendering...', 'black');

  timer('renderViews');
  await Promise.all([
    renderTreeView(rootMethod),
    renderTimeline(rootMethod),
    renderAnalysis(),
    renderDb(),
  ]);
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
  const ns = document.getElementById('LOG_FILE_NS')?.innerHTML;
  const logUri = document.getElementById('LOG_FILE_URI')?.innerHTML;

  // hacky I know
  window.activeNamespaces = ns?.split(',') ?? [];

  if (logUri) {
    fetch(logUri)
      .then((response) => {
        return response.text();
      })
      .then((data) => {
        displayLog(data ?? '', name ?? '', path ?? '');
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
