/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, { showTab, showTreeNode } from "./Util.js";
import { truncated } from "./parsers/LineParser.js";
import { RootNode } from "./parsers/TreeParser";
import { LogLine } from "./parsers/LineParser";

const defaultScaleX = 0.000001,
  maxCanvasWidth = 32000,
  scaleY = -15,
  keyMap: Record<string, Record<string, string>> = {
    codeUnit: {
      label: "Code Unit",
      strokeColor: "#B0B0B0",
      fillColor: "#6BAD68",
      textColor: "#FFFFFF",
    },
    soql: {
      label: "SOQL",
      strokeColor: "#B0B0B0",
      fillColor: "#4B9D6E",
      textColor: "#FFFFFF",
    },
    method: {
      label: "Method",
      strokeColor: "#B0B0B0",
      fillColor: "#328C72",
      textColor: "#FFFFFF",
    },
    flow: {
      label: "Flow",
      strokeColor: "#B0B0B0",
      fillColor: "#237A72",
      textColor: "#FFFFFF",
    },
    dml: {
      label: "DML",
      strokeColor: "#B0B0B0",
      fillColor: "#22686D",
      textColor: "#FFFFFF",
    },
    workflow: {
      label: "Workflow",
      strokeColor: "#B0B0B0",
      fillColor: "#285663",
      textColor: "#FFFFFF",
    },
    systemMethod: {
      label: "System Method",
      strokeColor: "#B0B0B0",
      fillColor: "#2D4455",
      textColor: "#FFFFFF",
    },
  };

let scaleX: number,
  scaleFont: string,
  maxX: number,
  maxY: number,
  logicalWidth: number,
  logicalHeight: number,
  displayWidth: number,
  displayHeight: number,
  timelineRoot: RootNode,
  lastMouseX: number,
  lastMouseY: number;

function getMaxWidth(node: LogLine) {
  if (node.exitStamp) {
    return node.exitStamp;
  }
  if (!node.children) {
    return 0;
  }

  let maxX = node.timestamp || 0;
  for (let c = node.children.length - 1; c >= 0; --c) {
    const max = getMaxWidth(node.children[c]);
    if (max && max > maxX) {
      maxX = max;
    }
  }

  return maxX;
}

function getMaxDepth(node: LogLine, depth = 0) {
  if (!node.children) {
    return depth;
  }

  const childDepth = node.duration ? depth + 1 : depth;

  let maxDepth = depth;
  for (let c = node.children.length - 1; c >= 0; --c) {
    const d = getMaxDepth(node.children[c], childDepth);
    if (d > maxDepth) {
      maxDepth = d;
    }
  }
  return maxDepth;
}

function drawScale(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 1;
  ctx.font = scaleFont;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  const xStep = 100000000, // 1/10th second
    detailed = scaleX > 0.0000002, // threshHold for 1/10ths and text
    labeled = scaleX > 0.00000002; // threshHold for labels
  for (let x = xStep, i = 1; x < maxX; x += xStep, ++i) {
    const major = i % 10 === 0, // whole seconds
      xPos = x * scaleX;

    if (detailed || major) {
      ctx.strokeStyle = major ? "#F88962" : "#E0E0E0";
      ctx.beginPath();
      ctx.moveTo(xPos, -logicalHeight);
      ctx.lineTo(xPos, 0);
      ctx.stroke();

      if (labeled) {
        const seconds = x / 1000000000;
        ctx.fillStyle = major ? "#F88962" : "#808080";
        ctx.fillText(seconds.toFixed(1) + "s", xPos + 2, -logicalHeight + 2);
      }
    }
  }
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  node: LogLine,
  depth: number
) {
  const tlKey = node.timelineKey;

  if (tlKey && node.duration) {
    const tl = keyMap[tlKey],
      x = node.timestamp * scaleX,
      y = depth * scaleY,
      w = node.duration * scaleX;

    ctx.fillStyle = tl.fillColor;
    ctx.fillRect(x, y, w, scaleY);
    ctx.lineWidth = 1;
    ctx.strokeStyle = tl.strokeColor;
    ctx.strokeRect(x, y, w, scaleY);
  }

  if (!node.children) {
    return;
  }

  const childDepth = node.duration ? depth + 1 : depth;
  const len = node.children.length;
  for (let c = 0; c < len; ++c) {
    drawNodes(ctx, node.children[c], childDepth);
  }
}

function drawTruncation(ctx: CanvasRenderingContext2D) {
  const len = truncated.length;
  let i = 0;

  while (i < len) {
    const thisEntry = truncated[i++],
      nextEntry = i < len ? truncated[i] : null,
      startTime = thisEntry[1],
      endTime = nextEntry ? nextEntry[1] : maxX;

    if (thisEntry[2]) {
      ctx.fillStyle = thisEntry[2];
    }
    ctx.fillRect(
      startTime * scaleX,
      -logicalHeight,
      (endTime - startTime) * scaleX,
      logicalHeight
    );
  }
}

function calculateSizes(canvas: HTMLCanvasElement) {
  maxX = getMaxWidth(timelineRoot); // maximum display value in nano-seconds
  maxY = getMaxDepth(timelineRoot); // maximum nested call depth

  const shrinkToFit = (
    document.getElementById("shrinkToFit") as HTMLInputElement
  ).checked;
  if (shrinkToFit) {
    const viewWidth = (
      document.getElementById("timelineScroll") as HTMLDivElement
    ).offsetWidth;
    scaleX = viewWidth / maxX; // ok to use the default scale
  } else if (defaultScaleX * maxX < maxCanvasWidth) {
    // does the default scale fit our canvas?
    scaleX = defaultScaleX; // ok to use the default scale
  } else {
    scaleX = maxCanvasWidth / maxX; // adjust the scale to avoid overflow
  }

  scaleFont = scaleX > 0.0000004 ? "normal 16px serif" : "normal 8px serif";
  logicalWidth = canvas.width = scaleX * maxX; // maximum scaled value to draw
  displayWidth = logicalWidth; // canvas display width (1-to-1 with logical width)
  canvas.style.width = displayWidth + "px";
  logicalHeight = canvas.height = -scaleY * maxY; // maximum scaled value to draw
  displayHeight = logicalHeight; // canvas display height (1-to-1 with logical height)
  canvas.style.height = displayHeight + "px";
}

export default async function renderTimeline(rootMethod: RootNode) {
  const canvas = document.getElementById("timeline") as HTMLCanvasElement,
    ctx = canvas?.getContext("2d");

  timelineRoot = rootMethod;
  calculateSizes(canvas);

  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, logicalHeight); // shift y-axis down so that 0,0 is bottom-left

    if (truncated.length > 0) {
      drawTruncation(ctx);
    }
    drawScale(ctx);
    drawNodes(ctx, timelineRoot, 0);
  }
}

function renderTimelineKey() {
  const keyHolder = document.getElementById("timelineKey"),
    title = document.createElement("span");

  title.innerText = "";
  if (keyHolder) {
    keyHolder.innerHTML = "";
    keyHolder.appendChild(title);
  }

  for (const keyName in keyMap) {
    const keyMeta = keyMap[keyName],
      keyEntry = document.createElement("div"),
      title = document.createElement("span");

    title.innerText = keyMeta.label;
    keyEntry.className = "keyEntry";
    keyEntry.style.backgroundColor = keyMeta.fillColor;
    keyEntry.style.color = keyMeta.textColor;
    keyEntry.appendChild(title);
    if (keyHolder) {
      keyHolder.appendChild(keyEntry);
    }
  }
}

function onShrinkToFit(evt: any) {
  renderTimeline(timelineRoot);
}

function findByPosition(
  node: LogLine,
  depth: number,
  x: number,
  targetDepth: number
): LogLine | null {
  if (!node) {
    return null;
  }

  if (node.duration) {
    // we can only test nodes with a duration
    if (node.exitStamp && (node.timestamp > x || node.exitStamp < x)) {
      return null; // x-axis miss (can't include us or children)
    }

    if (depth === targetDepth) {
      return node; // target found!
    }
  }

  if (node.children) {
    // search children
    const childDepth = node.duration ? depth + 1 : depth;
    if (targetDepth >= childDepth) {
      const len = node.children.length;
      for (let c = 0; c < len; ++c) {
        const target = findByPosition(
          node.children[c],
          childDepth,
          x,
          targetDepth
        );
        if (target) {
          return target;
        }
      }
    }
  }

  return null; // target not found!
}

function showTooltip(offsetX: number, offsetY: number) {
  const timelineScroll = document.getElementById("timelineScroll");
  const tooltip = document.getElementById("tooltip");

  if (timelineScroll && tooltip) {
    const x =
      ((offsetX + (timelineScroll.scrollLeft || 0)) / displayWidth) * maxX;
    const depth = ~~(((displayHeight - offsetY) / displayHeight) * maxY);
    let tooltipText = findTimelineTooltip(x, depth);

    if (!tooltipText) {
      const truncatedArray = findTruncatedTooltip(x) || [];
      tooltipText = truncatedArray[0] || "";
    }

    if (tooltipText) {
      showTooltipWithText(
        offsetX,
        offsetY,
        tooltipText,
        tooltip,
        timelineScroll
      );
    }
  }
}

function findTimelineTooltip(x: number, depth: number): string | null {
  const target = findByPosition(timelineRoot, 0, x, depth);
  if (target) {
    let text = target.type + "<br>" + target.text;
    if (target.timestamp && target.duration && target.netDuration) {
      text += "<br>timestamp: " + target.timestamp;
      if (target.exitStamp) {
        text += " => " + target.exitStamp;
        text += "<br>duration: " + formatDuration(target.duration);
        if (target.cpuType && target.cpuType === "free") {
          text += " (free)";
        } else {
          text += " (netDuration: " + formatDuration(target.netDuration) + ")";
        }
      }
    }
    return text;
  }
  return null;
}

function findTruncatedTooltip(
  x: number
): [string, number, string | undefined] | null {
  const len = truncated.length;
  let i = 0;

  while (i < len) {
    const thisEntry = truncated[i++],
      nextEntry = i < len ? truncated[i] : null,
      startTime = thisEntry[1],
      endTime = nextEntry ? nextEntry[1] : maxX;

    if (x >= startTime && x <= endTime) {
      return thisEntry;
    }
  }
  return null; // target not found!
}

function showTooltipWithText(
  offsetX: number,
  offsetY: number,
  tooltipText: string,
  tooltip: HTMLElement,
  timelineScroll: HTMLElement
) {
  if (tooltipText && tooltip && timelineScroll) {
    let posLeft = offsetX + 10,
      posTop = offsetY + 2;
    tooltip.innerHTML = tooltipText;
    tooltip.style.display = "block";

    if (posLeft + tooltip.offsetWidth > timelineScroll.offsetWidth) {
      posLeft = timelineScroll.offsetWidth - tooltip.offsetWidth;
    }
    tooltip.style.left = posLeft + timelineScroll.offsetLeft + "px";
    if (posTop + tooltip.offsetHeight > timelineScroll.offsetHeight) {
      posTop -= tooltip.offsetHeight + 4;
      if (posTop < -100) {
        posTop = -100;
      }
    }
    tooltip.style.top = posTop + timelineScroll.offsetTop + "px";
    // console.debug('Mouse at ' + offsetX + 'x' + offsetY + ' Tooltip at ' + posLeft + 'x' + posTop + ' to ' + (posLeft + w) + 'x' + (posTop + h));
  } else {
    tooltip.style.display = "none";
  }
}

/**
 * Convert target position to timeline position.
 *
 * +-TimelineView---------+		The timelineView is the positioning parent
 * | +-Tooltip-+          |		The tooltip is absolutely positioned
 * | +---------+          |
 * | +-TimelineScroll--+  |		The timelineScroller is staticly positioned
 * | | +-Timeline-+    |  |		The timeline is statisly positioned
 * | | +----------+    |  |
 * | +-----------------+  |
 * +----------------------+
 */
function onMouseMove(evt: any) {
  const target = evt.target as HTMLElement;

  if (target && (target.id === "timeline" || target.id === "tooltip")) {
    const timelineScroll = document.getElementById("timelineScroll"),
      clRect = timelineScroll?.getClientRects()[0],
      style = timelineScroll ? window.getComputedStyle(timelineScroll) : null,
      borderLeft = style ? parseInt(style.borderLeftWidth, 10) : 0,
      borderTop = style ? parseInt(style.borderTopWidth, 10) : 0;

    if (clRect) {
      lastMouseX = evt.clientX - clRect.left - borderLeft;
      lastMouseY = evt.clientY - clRect.top - borderTop;
      showTooltip(lastMouseX, lastMouseY);
    }
  }
}

function onClickCanvas(evt: any) {
  const x = (evt.offsetX / displayWidth) * maxX,
    depth = ~~(((displayHeight - evt.offsetY) / displayHeight) * maxY);

  const target = findByPosition(timelineRoot, 0, x, depth);
  if (target && target.timestamp) {
    showTreeNode(target.timestamp);
  }
}

function onLeaveCanvas(evt: any) {
  if (!evt.relatedTarget || evt.relatedTarget.id !== "tooltip") {
    const tooltip = document.getElementById("tooltip");
    if (tooltip) {
      tooltip.style.display = "none";
    }
  }
}

function onTimelineScroll() {
  showTooltip(lastMouseX, lastMouseY);
}

function onInitTimeline(evt: Event) {
  const canvas = document.getElementById("timeline") as HTMLCanvasElement,
    timelineScroll = document.getElementById("timelineScroll"),
    shrinkToFit = document.getElementById("shrinkToFit");

  shrinkToFit?.addEventListener("click", onShrinkToFit);
  canvas?.addEventListener("click", onClickCanvas);
  canvas?.addEventListener("mouseout", onLeaveCanvas);
  timelineScroll?.addEventListener("scroll", onTimelineScroll);

  document.addEventListener("mousemove", onMouseMove); // document seem to get all the events (regardless of which element we're over)

  renderTimelineKey();
}

window.addEventListener("DOMContentLoaded", onInitTimeline);

export { maxX };
