/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { showTab, recalculateDurations } from "./Util.js";
import parseLog, { LogLine, truncated } from "./parsers/LineParser.js";
import { getRootMethod } from "./parsers/TreeParser.js";
import renderTreeView from "./TreeView.js";
import renderTimeline, { maxX } from "./Timeline.js";
import analyseMethods, { renderAnalysis } from "./Analysis.js";
import analyseDb, { renderDb } from "./Database.js";
import { setNamespaces } from "./NamespaceExtrator.js";

import "../resources/css/Status.css";
import "../resources/css/Header.css";
import "../resources/css/Settings.css";
import "../resources/css/Tabber.css";
import "../resources/css/TreeView.css";
import "../resources/css/TimelineView.css";
import "../resources/css/AnalysisView.css";
import "../resources/css/DatabaseView.css";

interface VSCodeAPI {
  postMessage(message: any): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

declare global {
  interface Window {
    // TODO: Type these
    vscodeAPIInstance: VSCodeAPI;
    activeNamespaces: string[];
  }
}

const settingsPattern = /\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+/;

let logSize: number;

async function setStatus(
  name: string,
  path: string,
  status: string,
  color: string
) {
  const statusHolder = document.getElementById("status"),
    nameSpan = document.createElement("span"),
    nameLink = document.createElement("a"),
    statusSpan = document.createElement("span"),
    sizeText = logSize ? (logSize / 1000000).toFixed(2) + " MB" : "",
    elapsedText = maxX ? (maxX / 1000000000).toFixed(3) + " Sec" : "",
    infoSep = sizeText && elapsedText ? ", " : "",
    infoText =
      sizeText || elapsedText
        ? "\xA0(" + sizeText + infoSep + elapsedText + ")"
        : "";

  nameLink.setAttribute("href", "#");
  nameLink.appendChild(document.createTextNode(name));
  nameLink.addEventListener("click", () => {
    window.vscodeAPIInstance.postMessage({ path: path });
  });
  nameSpan.appendChild(nameLink);
  nameSpan.appendChild(document.createTextNode(infoText + "\xA0-\xA0"));

  statusSpan.innerText = status;
  statusSpan.style.color = color;

  if (statusHolder) {
    statusHolder.innerHTML = "";
    statusHolder.appendChild(nameSpan);
    statusHolder.appendChild(statusSpan);
  }

  if (Array.isArray(truncated)) {
    truncated.forEach((entry) => {
      const reasonSpan = document.createElement("span");

      reasonSpan.innerText = entry[0];
      reasonSpan.className = "reason";
      if (entry[2]) reasonSpan.style.backgroundColor = entry[2];
      if (statusHolder) statusHolder.appendChild(reasonSpan);
    });
  }
  await timeout(10);
}

function getLogSettings(log: string): [string, string][] {
  const match = log.match(settingsPattern);
  if (!match) {
    return [];
  }

  const settings = match[0],
    settingStr = settings.substring(settings.indexOf(" ") + 1),
    settingList = settingStr.split(";");

  return settingList.map((entry) => {
    const parts = entry.split(",");
    return [parts[0], parts[1]];
  });
}

async function markContainers(node: LogLine) {
  const children = node.children;

  if (children) {
    for (let i = 0; i < children.length; ++i) {
      const child = children[i];
      if (child.type === "DML_BEGIN") {
        node.containsDml = true;
      } else if (child.type === "SOQL_EXECUTE_BEGIN") {
        node.containsSoql = true;
      }
      if (child.displayType === "method") {
        await markContainers(child);
        node.containsDml ||= child.containsDml;
        node.containsSoql ||= child.containsSoql;
      }
    }
  }
}

async function insertPackageWrappers(node: LogLine) {
  const children = node.children,
    isParentDml = node.type === "DML_BEGIN";

  let lastPkg,
    i = 0;
  if (children) {
    while (i < children.length) {
      const child = children[i],
        childType = child.type;

      if (lastPkg) {
        if (
          childType === "ENTERING_MANAGED_PKG" &&
          child.namespace === lastPkg.namespace
        ) {
          // combine adjacent (like) packages
          children.splice(i, 1); // remove redundant child from parent

          lastPkg.exitStamp = child.exitStamp;
          recalculateDurations(lastPkg);
          continue; // skip any more child processing (it's gone)
        } else if (
          lastPkg &&
          isParentDml &&
          (childType === "DML_BEGIN" || childType === "SOQL_EXECUTE_BEGIN")
        ) {
          // move child DML / SOQL into the last package
          children.splice(i, 1); // remove moving child from parent
          if (lastPkg.children) lastPkg.children.push(child); // move child into the pkg

          lastPkg.containsDml = child.containsDml || childType === "DML_BEGIN";
          lastPkg.containsSoql =
            child.containsSoql || childType === "SOQL_EXECUTE_BEGIN";
          lastPkg.exitStamp = child.exitStamp; // move the end
          recalculateDurations(lastPkg);
          if (child.displayType === "method") {
            await insertPackageWrappers(child);
          }
          continue; // skip any more child processing (it's moved)
        } else {
          ++i;
        }
      } else {
        ++i;
      }
      if (child.displayType === "method") {
        await insertPackageWrappers(child);
      }
      lastPkg = childType === "ENTERING_MANAGED_PKG" ? child : null;
    }
  }
}

let timerText: string, startTime: number;

function timer(text: string) {
  const time = Date.now();
  if (timerText) {
    console.debug(timerText + " = " + (time - startTime) + "ms");
  }
  timerText = text;
  startTime = time;
}

async function renderLogSettings(logSettings: [string, string][]) {
  const holder = document.getElementById("logSettings");

  if (holder) {
    holder.innerHTML = "";
  }

  for (const logSetting of logSettings) {
    const [name, level] = logSetting;

    if (level !== "NONE") {
      const setting = document.createElement("div"),
        title = document.createElement("span"),
        value = document.createElement("span");

      title.innerText = name + ":";
      title.className = "settingTitle";
      value.innerText = level;
      value.className = "settingValue";
      setting.className = "setting";
      setting.appendChild(title);
      setting.appendChild(value);
      holder?.appendChild(setting);
    }
  }
}

async function displayLog(log: string, name: string, path: string) {
  logSize = log.length;
  await setStatus(name, path, "Processing...", "black");

  timer("parseLog");
  await Promise.all([renderLogSettings(getLogSettings(log)), parseLog(log)]);

  timer("getRootMethod");
  const rootMethod = getRootMethod();

  timer("analyse");
  await Promise.all([setNamespaces(rootMethod), markContainers(rootMethod)]);
  await insertPackageWrappers(rootMethod);
  await Promise.all([analyseMethods(rootMethod), analyseDb(rootMethod)]);

  await setStatus(name, path, "Rendering...", "black");

  timer("renderViews");
  await Promise.all([
    renderTreeView(rootMethod),
    renderTimeline(rootMethod),
    renderAnalysis(),
    renderDb(),
  ]);
  timer("");
  setStatus(name, path, "Ready", truncated.length > 0 ? "red" : "green");
}

function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLog() {
  const name = document.getElementById("LOG_FILE_NAME")?.innerHTML;
  const path = document.getElementById("LOG_FILE_PATH")?.innerHTML;
  const src = document.getElementById("LOG_FILE_TXT")?.innerHTML;
  const ns = document.getElementById("LOG_FILE_NS")?.innerHTML;

  // hacky I know
  window.activeNamespaces = ns?.split(",") ?? [];
  window.vscodeAPIInstance = acquireVsCodeApi();
  displayLog(src ?? "", name ?? "", path ?? "");
}

function onTabSelect(evt: Event) {
  const input = evt.target as HTMLElement;
  showTab(input.id);
}

function onInit(evt: Event) {
  const tabHolder = document.querySelector(".tabHolder");

  tabHolder
    ?.querySelectorAll(".tab")
    .forEach((t) => t.addEventListener("click", onTabSelect));

  readLog();
}

window.addEventListener("DOMContentLoaded", onInit);
