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

function describeMethod(node: LogLine, linkInfo: OpenInfo | null) {
  const methodPrefix = node.prefix || "",
    methodSuffix = node.suffix || "";

  let text = node.text;
  let link = null;

  if (linkInfo) {
    link = document.createElement("a");
    link.setAttribute("href", "#");
    link.appendChild(document.createTextNode(text));
    link.addEventListener("click", () => {
      openMethodSource(linkInfo);
    });
    text = "";
  }

  let desc = methodPrefix;
  let desc2 = "";
  if (node.summaryCount) {
    if (node.group) {
      desc += node.group;
      link = null;
    } else {
      desc2 += text;
    }
  } else {
    desc2 += text;
  }
  if (node.displayType === "method") {
    if (node.value) {
      desc2 += " = " + node.value;
    }
    desc2 += methodSuffix + " - ";
    desc2 += node.truncated
      ? "TRUNCATED"
      : formatDuration(node.duration || 0) +
        " (" +
        formatDuration(node.netDuration || 0) +
        ")";
    if (node.lineNumber) {
      desc2 += ", line: " + node.lineNumber;
    }
  }
  if (node.containsDml || node.containsSoql) {
    let prefix = "";
    if (node.containsDml) {
      prefix = prefix + "D";
    }
    if (node.containsSoql) {
      prefix = prefix + "S";
    }
    desc = "(" + prefix + ") " + desc;
  }
  if (link) {
    return [
      document.createTextNode(desc),
      link,
      document.createTextNode(desc2),
    ];
  } else {
    return [document.createTextNode(desc), document.createTextNode(desc2)];
  }
}

function renderBlock(childContainer: HTMLDivElement, block: LogLine) {
  const lines = block.children || [],
    len = lines.length;

  for (let i = 0; i < len; ++i) {
    const line = lines[i],
      txt = line.summaryCount ? line.group || line.text : line.text,
      lineNode = document.createElement("div");

    lineNode.className = line.hideable !== false ? "block detail" : "block";
    if (line.summaryCount) {
      const countElement = document.createElement("span");

      countElement.innerText = "x" + line.summaryCount;
      countElement.className = "count";
      lineNode.appendChild(countElement);
    }
    let text = txt && txt !== line.type ? line.type + " - " + txt : line.type;
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

function openMethodSource(info: OpenInfo) {
  if (info) {
    window.vscodeAPIInstance.postMessage(info);
  }
}

function deriveOpenInfo(node: LogLine): OpenInfo | null {
  const text = node.text,
    isMethod =
      node.type === "METHOD_ENTRY" || node.type === "CONSTRUCTOR_ENTRY",
    re = /^[0-9a-zA-Z_]+(\.[0-9a-zA-Z_]+)*\(.*\)$/;

  if (!isMethod || !re.test(text)) return null;

  let lineNumber = "";
  if (node.lineNumber) lineNumber = "-" + node.lineNumber;

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

function renderTreeNode(node: LogLine, calledFrom: string | null) {
  const mainNode = document.createElement("div"),
    toggle = document.createElement("span"),
    children = node.children || [],
    toggleNode = document.createTextNode(children.length > 0 ? "+" : " "),
    childContainer = document.createElement("div"),
    titleElement = document.createElement("span"),
    fileOpenInfo = deriveOpenInfo(node),
    titleElements = describeMethod(node, fileOpenInfo);
  for (let i = 0; i < titleElements.length; i++) {
    titleElement.appendChild(titleElements[i]);
  }
  titleElement.className = "name";
  if (children.length > 0) {
    toggle.className = "toggle";
    toggle.addEventListener("click", onExpandCollapse);
  } else {
    toggle.className = "indent";
  }
  toggle.appendChild(toggleNode);

  childContainer.className = "childContainer";
  childContainer.style.display = "none";
  const len = children.length;
  for (let i = 0; i < len; ++i) {
    const child = children[i];
    switch (child.displayType) {
      case "method":
        childContainer.appendChild(
          renderTreeNode(child, getClassName(node.text))
        );
        break;
      case "block":
        renderBlock(childContainer, child);
        break;
    }
  }

  if (node.timestamp) {
    mainNode.dataset.enterstamp = "" + node.timestamp;
  }
  mainNode.className = node.classes || "";
  mainNode.appendChild(toggle);
  if (node.summaryCount) {
    const countElement = document.createElement("span");

    countElement.innerText = "x" + node.summaryCount;
    countElement.className = "count";
    mainNode.appendChild(countElement);
  }
  mainNode.appendChild(titleElement);
  mainNode.appendChild(childContainer);

  return mainNode;
}

function getClassName(methodName: string) {
  const index = methodName.indexOf(".");

  if (index >= 0) {
    return methodName.substr(0, index) + ".cls";
  }
  return methodName.indexOf(" trigger ") >= 0
    ? methodName.split(" ")[2] + ".trigger"
    : null;
}

function renderTree() {
  const treeContainer = document.getElementById("tree");
  if (treeContainer) {
    treeContainer.innerHTML = "";
    treeContainer.appendChild(renderTreeNode(treeRoot, null));
  }
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
  const sheet = document.styleSheets[0],
    rules = sheet.rules;

  for (let i = 0; i < rules.length; ++i) {
    const rule = rules[i];
    if (!(rule instanceof CSSStyleRule)) {
      continue;
    }
    if (rule.selectorText === selector) {
      rule.style.display = hide ? "none" : "block";
      break;
    }
  }
}

function onHideDetails(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector(".detail", input.checked);
}

function onHideSystem(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector(".node.system", input.checked);
}

function onHideFormula(evt: Event) {
  const input = evt.target as HTMLInputElement;
  hideBySelector(".node.formula", input.checked);
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
