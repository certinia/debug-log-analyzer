/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { encodeEntities } from "./Browser.js";
import { LogLine } from "./parsers/LineParser.js";

export function highlightText(unsafeText: string, isBold: boolean) {
  const text = encodeEntities(unsafeText);
  return isBold ? "<b>" + text + "</b>" : text;
}

export default function formatDuration(duration: number) {
  const microSecs = ~~(duration / 1000), // convert from nano-seconds
    text = String(microSecs),
    textPadded = text.length < 4 ? "0000".substr(text.length) + text : text, // length min = 4
    millis = textPadded.substring(0, textPadded.length - 3),
    micros = textPadded.substr(textPadded.length - 3);

  return millis + "." + micros + "ms";
}

export function showTab(tabId: string) {
  const tabHolder = document.querySelector(".tabHolder"),
    tab = document.getElementById(tabId),
    tabber = document.querySelector(".tabber"),
    show = tab?.dataset.show,
    tabItem = show ? document.getElementById(show) : null;

  tabHolder
    ?.querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("selected"));
  tab?.classList.add("selected");
  tabber
    ?.querySelectorAll(".tabItem")
    .forEach((t) => t.classList.remove("selected"));
  if (tabItem) {
    tabItem.classList.add("selected");
  }
}

export function showTreeNode(timestamp: number) {
  const methodElm = document.querySelector(
      `div[data-enterstamp="${timestamp}"]`
    ) as HTMLElement,
    methodName = methodElm?.querySelector("span.name") || methodElm;

  if (methodElm) {
    showTab("treeTab");
    expandTreeNode(methodElm, false);
    methodElm?.scrollIntoView();
    if (methodName) {
      window.getSelection()?.selectAllChildren(methodName);
    }
  }
}

function expandTreeNode(elm: HTMLElement, expand: boolean) {
  if (expand) {
    const toggle = elm.querySelector(".toggle"),
      childContainer = elm.querySelector(".childContainer") as HTMLElement;

    if (childContainer && toggle) {
      childContainer.style.display = "block";
      toggle.textContent = "-";
    }
  }

  const parent = elm.parentElement;
  if (parent && parent.id !== "tree") {
    // stop at the root of the tree
    expandTreeNode(parent, true);
  }
}

export function recalculateDurations(node: LogLine) {
  if (node.exitStamp) {
    node.netDuration = node.duration = node.exitStamp - node.timestamp;
    if (node.children) {
      for (let i = 0; i < node.children.length; ++i) {
        const duration = node.children[i].duration;

        if (duration) {
          node.netDuration -= duration;
        }
      }
    }
  }
}