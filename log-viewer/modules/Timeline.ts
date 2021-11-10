/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { showTreeNode } from "./TreeView";
import formatDuration from "./Util";
import { truncated } from "./parsers/LineParser.js";
import { RootNode } from "./parsers/TreeParser";
import { LogLine } from "./parsers/LineParser";

const scaleY = -15,
  strokeColor = "#B0B0B0",
  textColor = "#FFFFFF",
  keyMap: Record<string, Record<string, string>> = {
    codeUnit: {
      label: "Code Unit",
      fillColor: "#6BAD68",
    },
    soql: {
      label: "SOQL",
      fillColor: "#4B9D6E",
    },
    method: {
      label: "Method",
      fillColor: "#328C72",
    },
    flow: {
      label: "Flow",
      fillColor: "#237A72",
    },
    dml: {
      label: "DML",
      fillColor: "#22686D",
    },
    workflow: {
      label: "Workflow",
      fillColor: "#285663",
    },
    systemMethod: {
      label: "System Method",
      fillColor: "#2D4455",
    },
  };

let centerOffset = 0;
let initialZoom = 0;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D | null;

let scaleX: number,
  scaleFont: string,
  maxX: number,
  maxY: number,
  displayHeight: number,
  displayWidth: number,
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
  const len = node.children.length - 1;
  for (let c = len; c >= 0; --c) {
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
  const len = node.children.length - 1;
  for (let c = len; c >= 0; --c) {
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

  // 1ms = 0.001s
  const xStep = 1000000000, // 1/10th second (0.1ms)
    detailed = scaleX > 0.000002, // threshHold for 1/10 ths (100 ms)and text
    labeled = scaleX > 0.0000002; // threshHold for labels

  const textHeight = -displayHeight + 2;
  const scaledXPosition = xStep * scaleX;

  const wholeSeconds = ~~(0.5 + maxX / 1000000000);
  ctx.strokeStyle = "#F88962";
  ctx.fillStyle = "#F88962";
  ctx.beginPath();
  for (let i = 0; i <= wholeSeconds; i++) {
    const xPos = ~~(0.5 + scaledXPosition * i - centerOffset);
    ctx.moveTo(xPos, -displayHeight);
    ctx.lineTo(xPos, 0);

    if (labeled) {
      ctx.fillText(i.toFixed(1) + "s", xPos + 2, textHeight);
    }
  }
  ctx.stroke();

  if (detailed) {
    ctx.strokeStyle = "#E0E0E0";
    ctx.fillStyle = "#808080";
    ctx.beginPath();
    // each 100 ms marker
    const tenthsOfSeconds = maxX / 100000000; // convert nano to tenths e.g 11 which would represent 1.1
    for (let i = 1; i <= tenthsOfSeconds; i++) {
      const wholeNumber = i % 10 === 0;
      if (!wholeNumber) {
        const xPos = ~~(0.5 + 100000000 * scaleX * i - centerOffset);
        ctx.moveTo(xPos, -displayHeight);
        ctx.lineTo(xPos, 0);

        if (labeled) {
          ctx.fillText((i / 10).toFixed(1) + "s", xPos + 2, textHeight);
        }
      }
    }
    ctx.stroke();
  }
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: LogLine[],
  depth: number
) {
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;

  const children = [];
  const len = nodes.length;
  for (let c = 0; c < len; c++) {
    const node = nodes[c];
    const tlKey = node.timelineKey;
    if (tlKey && node.duration) {
      const tl = keyMap[tlKey],
        x = node.timestamp * scaleX,
        y = depth * scaleY;

      // nanoseconds
      const width = node.duration * scaleX;

      if (width >= 0.25) {
        ctx.fillStyle = tl.fillColor;
        ctx.fillRect(x - centerOffset, y, width, scaleY);
        ctx.strokeRect(x - centerOffset, y, width, scaleY);
      }
    }

    if (node.children) {
      children.push(...node.children);
    }
  }

  if (!children.length) {
    return;
  }

  drawNodes(ctx, children, depth + 1);
}

function drawTruncation(ctx: CanvasRenderingContext2D) {
  const len = truncated.length;
  if (!len) {
    return;
  }
  let i = 0;

  while (i < len) {
    const thisEntry = truncated[i++],
      nextEntry = truncated[i] ?? [],
      startTime = thisEntry[1],
      endTime = nextEntry[1] ?? maxX;

    if (thisEntry[2]) {
      ctx.fillStyle = thisEntry[2];
    }
    ctx.fillRect(
      startTime * scaleX - centerOffset,
      -displayHeight,
      endTime - startTime * scaleX,
      displayHeight
    );
  }
}

function calculateSizes(canvas: HTMLCanvasElement) {
  maxX = getMaxWidth(timelineRoot); // maximum display value in nano-seconds
  maxY = getMaxDepth(timelineRoot); // maximum nested call depth

  // todo: the default should be based on width of current log
  const viewWidth = (
    document.getElementById("timelineScroll") as HTMLDivElement
  ).offsetWidth;
  displayWidth = canvas.width = viewWidth;
  displayHeight = canvas.height = -scaleY * maxY; // maximum scaled value to draw
  initialZoom = viewWidth / maxX;

  resetView();
  recalculateSizes();
}

function resetView() {
  scaleX = displayWidth / maxX;
  centerOffset = 0;
}

function recalculateSizes() {
  scaleFont = scaleX > 0.0000004 ? "normal 16px serif" : "normal 8px serif";
}

export default async function renderTimeline(rootMethod: RootNode) {
  canvas = document.getElementById("timeline") as HTMLCanvasElement;
  ctx = canvas.getContext("2d", { alpha: false });
  timelineRoot = rootMethod;
  calculateSizes(canvas);
  if (ctx) {
    requestAnimationFrame(drawTimeLine);
  }
}

function drawTimeLine() {
  if (ctx) {
    recalculateSizes();
    ctx.setTransform(1, 0, 0, 1, 0, displayHeight); // shift y-axis down so that 0,0 is bottom-left
    ctx.clearRect(0, -canvas.height, canvas.width, canvas.height);
    drawTruncation(ctx);
    drawScale(ctx);
    drawNodes(ctx, [timelineRoot], -1);
    requestAnimationFrame(drawTimeLine);
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
    keyEntry.style.color = textColor;
    keyEntry.appendChild(title);
    if (keyHolder) {
      keyHolder.appendChild(keyEntry);
    }
  }
}

function onShrinkToFit(evt: any) {
  resetView();
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
    const starttime = node.timestamp * scaleX - centerOffset;
    const width = node.duration * scaleX;
    const endtime = starttime + width;

    if (width < 0.25 || starttime > x || endtime < x) {
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
    const depth = ~~(((displayHeight - offsetY) / displayHeight) * maxY);
    let tooltipText =
      findTimelineTooltip(offsetX, depth) || findTruncatedTooltip(offsetX);

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

function findTimelineTooltip(x: number, depth: number): HTMLDivElement | null {
  const target = findByPosition(timelineRoot, 0, x, depth);
  if (target) {
    const toolTip = document.createElement("div");
    const brElem = document.createElement("br");

    toolTip.appendChild(document.createTextNode(target.type));
    toolTip.appendChild(brElem.cloneNode());
    toolTip.appendChild(document.createTextNode(target.text));
    if (target.timestamp && target.duration && target.netDuration) {
      toolTip.appendChild(brElem.cloneNode());
      toolTip.appendChild(
        document.createTextNode("timestamp: " + target.timestamp)
      );
      if (target.exitStamp) {
        toolTip.appendChild(document.createTextNode(" => " + target.exitStamp));
        toolTip.appendChild(brElem.cloneNode());
        toolTip.appendChild(
          document.createTextNode(
            `duration: ${formatDuration(target.duration)}`
          )
        );
        if (target.cpuType === "free") {
          toolTip.appendChild(document.createTextNode(" (free)"));
        } else {
          toolTip.appendChild(
            document.createTextNode(
              ` (self ${formatDuration(target.netDuration)})`
            )
          );
        }
      }
    }

    return toolTip;
  }
  return null;
}

function findTruncatedTooltip(x: number): HTMLDivElement | null {
  const len = truncated?.length;
  let i = 0;

  while (i < len) {
    const thisEntry = truncated[i++],
      nextEntry = truncated[i] ?? [],
      startTime = thisEntry[1],
      endTime = nextEntry[1] ?? maxX;

    if (
      x >= startTime * scaleX - centerOffset &&
      x <= endTime * scaleX - centerOffset
    ) {
      const toolTip = document.createElement("div");
      toolTip.textContent = thisEntry[0];
      return toolTip;
    }
  }
  return null; // target not found!
}

function showTooltipWithText(
  offsetX: number,
  offsetY: number,
  tooltipText: HTMLDivElement,
  tooltip: HTMLElement,
  timelineScroll: HTMLElement
) {
  if (tooltipText && tooltip && timelineScroll) {
    let posLeft = offsetX + 10,
      posTop = offsetY + 2;

    if (posLeft + tooltip.offsetWidth > timelineScroll.offsetWidth) {
      posLeft = timelineScroll.offsetWidth - tooltip.offsetWidth;
    }
    if (posTop + tooltip.offsetHeight > timelineScroll.offsetHeight) {
      posTop -= tooltip.offsetHeight + 4;
      if (posTop < -100) {
        posTop = -100;
      }
    }
    const tooltipX = posLeft + timelineScroll.offsetLeft;
    const tooltipY = posTop + timelineScroll.offsetTop;
    tooltip.innerHTML = "";
    tooltip.appendChild(tooltipText);
    tooltip.style.cssText = `left:${tooltipX}px; top:${tooltipY}px; display: block;`;
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
    const clRect = canvas.getBoundingClientRect();
    if (clRect) {
      lastMouseX = evt.clientX - clRect.left;
      lastMouseY = evt.clientY - clRect.top;
      showTooltip(lastMouseX, lastMouseY);
    }
  }
}

function onClickCanvas(evt: any) {
  const depth = ~~(((displayHeight - lastMouseY) / displayHeight) * maxY);
  const target = findByPosition(timelineRoot, 0, lastMouseX, depth);
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

function handleScroll(evt: WheelEvent) {
  evt.stopPropagation();
  const { deltaY, deltaX } = evt;

  const oldZoom = scaleX;
  let zoomDelta = (deltaY / 1000) * scaleX;
  const updatedZoom = scaleX - zoomDelta;
  zoomDelta = updatedZoom >= initialZoom ? zoomDelta : scaleX - initialZoom;
  //TODO: work out a proper max zoom
  // stop zooming at 0.0001 ms
  zoomDelta = updatedZoom <= 0.3 ? zoomDelta : scaleX - 0.3;
  if (zoomDelta !== 0) {
    scaleX = scaleX - zoomDelta;
    if (scaleX !== oldZoom) {
      const timePosBefore = (lastMouseX + centerOffset) / oldZoom;
      const newOffset = timePosBefore * scaleX - lastMouseX;
      const maxWidth = scaleX * maxX - displayWidth;
      centerOffset = Math.max(0, Math.min(maxWidth, newOffset));
    }
  } else {
    const maxWidth = scaleX * maxX - displayWidth;
    centerOffset = Math.max(0, Math.min(maxWidth, centerOffset + deltaX));
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
  canvas?.addEventListener("wheel", handleScroll, { passive: true });
  timelineScroll?.addEventListener("scroll", onTimelineScroll);

  // document seem to get all the events (regardless of which element we're over)
  document.addEventListener("mousemove", onMouseMove);

  renderTimelineKey();
}

window.addEventListener("DOMContentLoaded", onInitTimeline);

export { maxX };
