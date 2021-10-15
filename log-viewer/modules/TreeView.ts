/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { RootNode } from "./parsers/TreeParser.js";
import { LogLine } from "./parsers/LineParser.js";
import formatDuration from "./Util.js";

let treeRoot: RootNode;

function onExpandCollapse(evt: Event) {
  const input = evt.target as HTMLElement,
    pe = input.parentElement,
    toggle = pe?.querySelector(".toggle"),
    childContainer = pe?.querySelector(".childContainer");

  if (toggle && childContainer) {
    switch (toggle.textContent) {
      case "+":
        // expand
        childContainer.setAttribute("style", "display:block");
        toggle.textContent = "-";
        break;
      case "-":
        // collapse
        childContainer.setAttribute("style", "display:none");
        toggle.textContent = "+";
        break;
    }
  }
}

function describeMethod(node: LogLine) {
  const methodPrefix = node.prefix || "",
    methodSuffix = node.suffix || "";

  const dbPrefix =
    (node.containsDml ? "D" : "") + (node.containsSoql ? "S" : "");
  const linePrefix = (dbPrefix ? "(" + dbPrefix + ") " : "") + methodPrefix;

  const text = node.text;
  let logLineBody;
  if (hasCodeText(node)) {
    logLineBody = document.createElement("a");
    logLineBody.href = "#";
    logLineBody.textContent = text;
  } else {
    logLineBody = document.createTextNode(text);
  }

  let lineSuffix = "";
  if (node.displayType === "method") {
    lineSuffix += node.value ? " = " + node.value : "";
    lineSuffix += methodSuffix + " - ";
    if (node.truncated) {
      lineSuffix += "TRUNCATED";
    } else {
      lineSuffix +=
        formatDuration(node.duration || 0) +
        " (" +
        formatDuration(node.netDuration || 0) +
        ")";
    }

    lineSuffix += node.lineNumber ? ", line: " + node.lineNumber : "";
  }

  return [
    document.createTextNode(linePrefix),
    logLineBody,
    document.createTextNode(lineSuffix),
  ];
}

function renderBlock(childContainer: HTMLDivElement, block: LogLine) {
  const lines = block.children || [],
    len = lines.length;

  for (let i = 0; i < len; ++i) {
    const line = lines[i],
      txt = line.text,
      lineNode = document.createElement("div");

    lineNode.className = line.hideable !== false ? "block detail" : "block";
    let text = line.type + (txt && txt !== line.type ? " - " + txt : "");
    text = text.replace(/ \| /g, "\n");
    if (text.endsWith("\\")) {
      text = text.substring(0, text.length - 1);
    }
    const textNode = document.createTextNode(text);
    lineNode.appendChild(textNode);
    childContainer.appendChild(lineNode);
  }
}

type OpenInfo = {
  typeName: string;
  text: string;
};

function openMethodSource(info: OpenInfo | null) {
  if (info && window.vscodeAPIInstance) {
    window.vscodeAPIInstance.postMessage(info);
  }
}

function hasCodeText(node: LogLine): boolean {
  return node.type === "METHOD_ENTRY" || node.type === "CONSTRUCTOR_ENTRY";
}

function deriveOpenInfo(node: LogLine): OpenInfo | null {
  if (!hasCodeText(node)) {
    return null;
  }

  const text = node.text;
  let lineNumber = "";
  if (node.lineNumber) {
    lineNumber = "-" + node.lineNumber;
  }

  let qname = text.substr(0, text.indexOf("("));
  if (node.type === "METHOD_ENTRY") {
    const lastDot = qname.lastIndexOf(".");
    return {
      typeName: text.substr(0, lastDot) + lineNumber,
      text: text,
    };
  } else {
    return {
      typeName: qname + lineNumber,
      text: text,
    };
  }
}

function renderTreeNode(node: LogLine) {
  const mainNode = document.createElement("div"),
    toggle = document.createElement("span"),
    children = node.children || [];

  const titleElement = document.createElement("span");
  const titleElements = describeMethod(node);
  for (let i = 0; i < titleElements.length; i++) {
    titleElement.appendChild(titleElements[i]);
  }
  titleElement.className = "name";

  const childContainer = document.createElement("div");
  childContainer.className = "childContainer";
  childContainer.style.display = "none";

  const len = children.length;
  for (let i = 0; i < len; ++i) {
    const child = children[i];
    switch (child.displayType) {
      case "method":
        childContainer.appendChild(renderTreeNode(child));
        break;
      case "block":
        renderBlock(childContainer, child);
        break;
    }
  }

  if (len) {
    const toggleNode = document.createTextNode("+");
    toggle.appendChild(toggleNode);

    toggle.className = "toggle";
    toggle.addEventListener("click", onExpandCollapse);
  } else {
    toggle.className = "indent";
  }

  if (node.timestamp) {
    mainNode.dataset.enterstamp = "" + node.timestamp;
  }
  mainNode.className = node.classes || "";
  mainNode.appendChild(toggle);
  mainNode.appendChild(titleElement);
  mainNode.appendChild(childContainer);

  return mainNode;
}

function renderTree() {
  const treeContainer = document.getElementById("tree");
  if (treeContainer) {
    treeContainer.addEventListener("click", goToFile);

    const callTreeNode = renderTreeNode(treeRoot);
    treeContainer.innerHTML = "";
    treeContainer.appendChild(callTreeNode);
  }
}

function goToFile(evt: Event) {
  const elem = evt.target as HTMLElement;
  const target = elem.matches("a") ? elem.parentElement?.parentElement : null;
  const timeStamp = target?.dataset.enterstamp;
  if (timeStamp) {
    const node = findByTimeStamp(treeRoot, timeStamp);
    if (node) {
      const fileOpenInfo = deriveOpenInfo(node);
      openMethodSource(fileOpenInfo);
    }
  }
}

function findByTimeStamp(node: LogLine, timeStamp: string): LogLine | null {
  if (node) {
    if (node.timestamp === parseInt(timeStamp)) {
      return node;
    }

    if (node.children) {
      const len = node.children.length;
      for (let i = 0; i < len; ++i) {
        const target = findByTimeStamp(node.children[i], timeStamp);
        if (target) {
          return target;
        }
      }
    }
  }
  return null;
}

export default async function renderTreeView(rootMethod: RootNode) {
  treeRoot = rootMethod;
  renderTree();
}

function expand(elm: Element | null | undefined) {
  const toggle = elm?.querySelector(".toggle");

  if (elm && toggle && toggle.textContent !== " ") {
    // can we toggle this block?
    const childContainer = elm.querySelector(".childContainer");
    if (childContainer) {
      childContainer.setAttribute("style", "display:block");
      toggle.textContent = "-";

      let child = childContainer.firstElementChild;
      while (child) {
        if (!child.classList.contains("block")) {
          expand(child);
        }
        child = child.nextElementSibling;
      }
    }
  }
}

function collapse(elm: Element | null | undefined) {
  const toggle = elm?.querySelector(".toggle");

  if (elm && toggle && toggle.textContent !== " ") {
    // can we toggle this block?
    const childContainer = elm.querySelector(".childContainer");
    if (childContainer) {
      childContainer.setAttribute("style", "display:none");
      toggle.textContent = "+";

      let child = childContainer.firstElementChild;
      while (child) {
        if (!child.classList.contains("block")) {
          collapse(child);
        }
        child = child.nextElementSibling;
      }
    }
  }
}

function onExpandAll(evt: Event) {
  const treeContainer = document.getElementById("tree");
  expand(treeContainer?.firstElementChild);
}

function onCollapseAll(evt: Event) {
  const treeContainer = document.getElementById("tree");
  collapse(treeContainer?.firstElementChild);
}

function hideBySelector(selector: string, hide: boolean) {
  const elements = document.querySelectorAll<HTMLElement>(selector);
  const value = hide ? "none" : "block";
  elements.forEach((elem) => {
    if (elem.style.display !== value) {
      elem.style.display = value;
    }
  });
}

function onHideDetails(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector("#tree .detail", input.checked);
}

function onHideSystem(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector("#tree .node.system", input.checked);
}

function onHideFormula(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector("#tree .node.formula", input.checked);
}

function onInitTree(evt: Event) {
  const expandAll = document.getElementById("expandAll"),
    collapseAll = document.getElementById("collapseAll"),
    hideDetails = document.getElementById("hideDetails"),
    hideSystem = document.getElementById("hideSystem"),
    hideFormula = document.getElementById("hideFormula");

  expandAll?.addEventListener("click", onExpandAll);
  collapseAll?.addEventListener("click", onCollapseAll);
  hideDetails?.addEventListener("change", onHideDetails);
  hideSystem?.addEventListener("change", onHideSystem);
  hideFormula?.addEventListener("change", onHideFormula);
}

window.addEventListener("DOMContentLoaded", onInitTree);
