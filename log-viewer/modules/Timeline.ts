/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { showTreeNode } from "./TreeView";
import formatDuration from "./Util";
import { truncated } from "./parsers/LineParser";
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

let tooltip: HTMLDivElement;
let realHeight = 0;
let horizontalOffset = 0;
let verticalOffset = 0;
let initialZoom = 0;
let container: HTMLDivElement;
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

  const textHeight = -displayHeight + 2;
  // 1ms = 0.001s
  const nanoSeconds = 1000000000; // 1/10th second (0.1ms
  const nsWidth = nanoSeconds * scaleX;

  // Find the start time based on the LHS of visible area
  const startTimeInNs = horizontalOffset / scaleX;
  // Find the end time based on the start + width of visible area.
  const endTimeInNs = startTimeInNs + displayWidth / scaleX;

  const endTimeInS = Math.ceil(endTimeInNs / 1000000000);
  const startTimeInS = Math.floor(startTimeInNs / 1000000000);
  ctx.strokeStyle = "#F88962";
  ctx.fillStyle = "#F88962";
  ctx.beginPath();
  for (let i = startTimeInS; i <= endTimeInS; i++) {
    const xPos = nsWidth * i - horizontalOffset;
    ctx.moveTo(xPos, -displayHeight);
    ctx.lineTo(xPos, 0);

    ctx.fillText(`${i.toFixed(1)}s`, xPos + 2, textHeight);
  }
  ctx.stroke();

  // 1 microsecond = 0.001 milliseconds
  // only show those where the gap is going to be more than 150 pixels
  const microSecPixelGap = 150 / (1000 * scaleX);
  // TODO: This is a bit brute force, but it works. maybe rework it?
  // from 1 micro second to 1 second
  const microSecsToShow = [
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
    100000, 200000, 500000, 1000000,
  ];
  const closestIncrement = microSecsToShow.reduce(function (prev, curr) {
    return Math.abs(curr - microSecPixelGap) < Math.abs(prev - microSecPixelGap)
      ? curr
      : prev;
  });

  ctx.strokeStyle = "#E0E0E0";
  ctx.fillStyle = "#808080";
  ctx.beginPath();

  const microSecWidth = 1000 * scaleX;
  const endTimeInMicroSecs = endTimeInNs / 1000;
  const startTimeInMicroSecs = startTimeInNs / 1000;
  let i = Math.floor(startTimeInMicroSecs / 1000000) * 1000000;
  while (i < endTimeInMicroSecs) {
    i = i + closestIncrement;
    const wholeNumber = i % 1000000 === 0;
    if (!wholeNumber && i >= startTimeInMicroSecs) {
      const xPos = microSecWidth * i - horizontalOffset;
      ctx.moveTo(xPos, -displayHeight);
      ctx.lineTo(xPos, 0);
      ctx.fillText(`${i / 1000} ms`, xPos + 2, textHeight);
    }
  }
  ctx.stroke();
}

function drawFlameNodes(
  ctx: CanvasRenderingContext2D,
  nodes: LogLine[],
  depth: number
) {
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  drawNodes(ctx, nodes, depth);
  renderRectangles(ctx);
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: LogLine[],
  depth: number
) {
  const children: LogLine[] = [];
  const len = nodes.length;
  const y = depth * scaleY - verticalOffset;
  for (let c = 0; c < len; c++) {
    const node = nodes[c];
    const tlKey = node.timelineKey;
    if (tlKey && node.duration) {
      // nanoseconds
      const width = node.duration * scaleX;
      if (width >= 0.05) {
        const tl = keyMap[tlKey],
          x = node.timestamp * scaleX - horizontalOffset;
        addToRectQueue(tl.fillColor, x, y, width);
      }
    }

    // The spread operator caused Maximum call stack size exceeded when there are lots of child nodes.
    node.children?.forEach((child) => {
      children.push(child);
    });
  }

  if (!children.length) {
    return;
  }

  drawNodes(ctx, children, depth + 1);
}

interface Rect {
  x: number;
  y: number;
  w: number;
}

let rectRenderQueue = new Map<string, Rect[]>();

function addToRectQueue(color: string, x: number, y: number, w: number) {
  if (!rectRenderQueue.has(color)) {
    rectRenderQueue.set(color, []);
  }

  const rect: Rect = {
    x: x,
    y: y,
    w: w,
  };
  rectRenderQueue.get(color)?.push(rect);
}

function renderRectangles(ctx: CanvasRenderingContext2D) {
  for (let [color, items] of rectRenderQueue) {
    ctx.beginPath();
    ctx.fillStyle = color;
    items.forEach((item) => {
      ctx.rect(item.x, item.y, item.w, scaleY);
    });
    ctx.fill();
    ctx.stroke();
  }

  rectRenderQueue = new Map<string, Rect[]>();
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
    const startX = startTime * scaleX;
    ctx.fillRect(
      startTime * scaleX - horizontalOffset,
      -displayHeight,
      endTime - startX,
      displayHeight
    );
  }
}

function calculateSizes(canvas: HTMLCanvasElement) {
  maxX = getMaxWidth(timelineRoot); // maximum display value in nano-seconds
  maxY = getMaxDepth(timelineRoot); // maximum nested call depth
  resetView();
}

function resetView() {
  resize();
  realHeight = -scaleY * maxY;
  horizontalOffset = 0;
  verticalOffset = 0;
}

function resize() {
  displayWidth = container.clientWidth;
  displayHeight = container.clientHeight;
  canvas.width = displayWidth;
  canvas.height = displayHeight;
  initialZoom = displayWidth / maxX;
  scaleX = displayWidth / maxX;
  resizeFont();
}
function resizeFont() {
  scaleFont = scaleX > 0.0000004 ? "normal 16px serif" : "normal 8px serif";
}

export default async function renderTimeline(rootMethod: RootNode) {
  renderTimelineKey();
  container = document.getElementById("timelineWrapper") as HTMLDivElement;
  canvas = document.getElementById("timeline") as HTMLCanvasElement;
  ctx = canvas.getContext("2d", { alpha: false });
  timelineRoot = rootMethod;
  calculateSizes(canvas);
  if (ctx) {
    requestAnimationFrame(drawTimeLine);
  }
}

// todo: chnage to map? or use interface for timelineColors?
export function setColors(timelineColors: any) {
  for (const keyName in keyMap) {
    const keyMeta = keyMap[keyName];
    const newColor = timelineColors[keyMeta.label];
    if (newColor) {
      keyMeta.fillColor = newColor;
    }
  }
}

function drawTimeLine() {
  if (ctx) {
    resizeFont();
    ctx.setTransform(1, 0, 0, 1, 0, displayHeight); // shift y-axis down so that 0,0 is bottom-left
    ctx.clearRect(0, -canvas.height, canvas.width, canvas.height);
    drawTruncation(ctx);
    drawScale(ctx);
    drawFlameNodes(ctx, [timelineRoot], -1);
    requestAnimationFrame(drawTimeLine);
  }
}

export function renderTimelineKey() {
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
    const starttime = node.timestamp * scaleX - horizontalOffset;
    const width = node.duration * scaleX;
    const endtime = starttime + width;

    if (width < 0.05 || starttime > x || endtime < x) {
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
  if (!dragging) {
    const timelineWrapper = document.getElementById("timelineWrapper");
    const tooltip = document.getElementById("tooltip");

    if (timelineWrapper && tooltip) {
      const depth = ~~(
        ((displayHeight - offsetY - verticalOffset) / realHeight) *
        maxY
      );
      let tooltipText =
        findTimelineTooltip(offsetX, depth) || findTruncatedTooltip(offsetX);

      if (tooltipText) {
        showTooltipWithText(
          offsetX,
          offsetY,
          tooltipText,
          tooltip,
          timelineWrapper
        );
      }
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
      x >= startTime * scaleX - horizontalOffset &&
      x <= endTime * scaleX - horizontalOffset
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
  timelineWrapper: HTMLElement
) {
  if (tooltipText && tooltip && timelineWrapper) {
    let posLeft = offsetX + 10,
      posTop = offsetY + 2;

    if (posLeft + tooltip.offsetWidth > timelineWrapper.offsetWidth) {
      posLeft = timelineWrapper.offsetWidth - tooltip.offsetWidth;
    }
    if (posTop + tooltip.offsetHeight > timelineWrapper.offsetHeight) {
      posTop -= tooltip.offsetHeight + 4;
      if (posTop < -100) {
        posTop = -100;
      }
    }
    const tooltipX = posLeft + timelineWrapper.offsetLeft;
    const tooltipY = posTop + timelineWrapper.offsetTop;
    tooltip.innerHTML = "";
    tooltip.style.cssText = `left:${tooltipX}px; top:${tooltipY}px; display: block;`;
    tooltip.appendChild(tooltipText);
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
 * | +-timelineWrapper--+  |		The timelineWrapperer is staticly positioned
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
  if (!dragging && tooltip.style.display === "block") {
    const depth = ~~(
      ((displayHeight - lastMouseY - verticalOffset) / realHeight) *
      maxY
    );
    const target = findByPosition(timelineRoot, 0, lastMouseX, depth);
    if (target && target.timestamp) {
      showTreeNode(target.timestamp);
    }
  }
}

function onLeaveCanvas(evt: any) {
  dragging = false;
  if (!evt.relatedTarget || evt.relatedTarget.id !== "tooltip") {
    const tooltip = document.getElementById("tooltip");
    if (tooltip) {
      tooltip.style.display = "none";
    }
  }
}

let dragging = false;
function handleMouseDown(evt: MouseEvent) {
  dragging = true;
}

function handleMouseUp(evt: MouseEvent) {
  dragging = false;
}

function handleMouseMove(evt: MouseEvent) {
  if (dragging) {
    tooltip.style.display = "none";
    const { movementY, movementX } = evt;
    const maxWidth = scaleX * maxX - displayWidth;
    horizontalOffset = Math.max(
      0,
      Math.min(maxWidth, horizontalOffset - movementX)
    );

    const realHeight = maxY * -scaleY;
    const maxVertOffset = ~~(realHeight - displayHeight + displayHeight / 4);
    verticalOffset = Math.min(
      0,
      Math.max(-maxVertOffset, verticalOffset - movementY)
    );
  }
}

function handleScroll(evt: WheelEvent) {
  if (!dragging) {
    tooltip.style.display = "none";
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
        const timePosBefore = (lastMouseX + horizontalOffset) / oldZoom;
        const newOffset = timePosBefore * scaleX - lastMouseX;
        const maxWidth = scaleX * maxX - displayWidth;
        horizontalOffset = Math.max(0, Math.min(maxWidth, newOffset));
      }
    } else {
      const maxWidth = scaleX * maxX - displayWidth;
      horizontalOffset = Math.max(
        0,
        Math.min(maxWidth, horizontalOffset + deltaX)
      );
    }
  }
}

function onTimelineWrapper() {
  showTooltip(lastMouseX, lastMouseY);
}

function onInitTimeline(evt: Event) {
  const canvas = document.getElementById("timeline") as HTMLCanvasElement,
    timelineWrapper = document.getElementById("timelineWrapper");
  tooltip = document.getElementById("tooltip") as HTMLDivElement;

  canvas?.addEventListener("mouseout", onLeaveCanvas);
  canvas?.addEventListener("wheel", handleScroll, { passive: true });
  canvas?.addEventListener("mousedown", handleMouseDown);
  canvas?.addEventListener("mouseup", handleMouseUp);
  canvas?.addEventListener("mousemove", handleMouseMove, { passive: true });
  canvas?.addEventListener("click", onClickCanvas);
  timelineWrapper?.addEventListener("scroll", onTimelineWrapper);

  // document seem to get all the events (regardless of which element we're over)
  document.addEventListener("mousemove", onMouseMove);
}

window.addEventListener("DOMContentLoaded", onInitTimeline);
window.addEventListener("resize", resize);
export { maxX };
