/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { showTreeNode } from "./TreeView";
import formatDuration from "./Util";
import { LogLine, truncated } from "./parsers/LineParser";
import { RootNode } from "./parsers/TreeParser";

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

class State {
  public shouldRedraw = true;
  public defaultZoom = 0;

  private _zoom: number = 0;
  private _offsetY: number = 0;
  private _offsetX: number = 0;

  public set zoom(zoom: number) {
    this._zoom = zoom;
    this.queueRedraw();
  }

  public get zoom() {
    return this._zoom;
  }

  public set offsetY(offsetY: number) {
    if (this._offsetY !== offsetY) {
      this._offsetY = offsetY;
      this.queueRedraw();
    }
  }

  public get offsetY() {
    return this._offsetY;
  }

  public set offsetX(offsetX: number) {
    if (this._offsetX !== offsetX) {
      this._offsetX = offsetX;
      this.queueRedraw();
    }
  }

  public get offsetX() {
    return this._offsetX;
  }

  private queueRedraw() {
    if (!this.shouldRedraw) {
      this.shouldRedraw = true;
      requestAnimationFrame(drawTimeLine);
    }
  }
}

const state = new State();

let tooltip: HTMLDivElement;
let container: HTMLDivElement;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

let realHeight = 0;
let scaleFont: string,
  totalDuration: number,
  maxY: number,
  displayHeight: number,
  displayWidth: number,
  timelineRoot: RootNode,
  lastMouseX: number,
  lastMouseY: number;

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
  const nsWidth = nanoSeconds * state.zoom;

  // Find the start time based on the LHS of visible area
  const startTimeInNs = state.offsetX / state.zoom;
  // Find the end time based on the start + width of visible area.
  const endTimeInNs = startTimeInNs + displayWidth / state.zoom;

  const endTimeInS = Math.ceil(endTimeInNs / 1000000000);
  const startTimeInS = Math.floor(startTimeInNs / 1000000000);
  ctx.strokeStyle = "#F88962";
  ctx.fillStyle = "#F88962";
  ctx.beginPath();
  for (let i = startTimeInS; i <= endTimeInS; i++) {
    const xPos = nsWidth * i - state.offsetX;
    ctx.moveTo(xPos, -displayHeight);
    ctx.lineTo(xPos, 0);

    ctx.fillText(`${i.toFixed(1)}s`, xPos + 2, textHeight);
  }
  ctx.stroke();

  // 1 microsecond = 0.001 milliseconds
  // only show those where the gap is going to be more than 150 pixels
  const microSecPixelGap = 150 / (1000 * state.zoom);
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

  const microSecWidth = 1000 * state.zoom;
  const endTimeInMicroSecs = endTimeInNs / 1000;
  const startTimeInMicroSecs = startTimeInNs / 1000;
  let i = Math.floor(startTimeInMicroSecs / 1000000) * 1000000;
  while (i < endTimeInMicroSecs) {
    i = i + closestIncrement;
    const wholeNumber = i % 1000000 === 0;
    if (!wholeNumber && i >= startTimeInMicroSecs) {
      const xPos = microSecWidth * i - state.offsetX;
      ctx.moveTo(xPos, -displayHeight);
      ctx.lineTo(xPos, 0);
      ctx.fillText(`${i / 1000} ms`, xPos + 2, textHeight);
    }
  }
  ctx.stroke();
}

function nodesToRectangles(nodes: LogLine[], depth: number) {
  const children: LogLine[] = [];
  const len = nodes.length;
  for (let c = 0; c < len; c++) {
    const node = nodes[c];
    const tlKey = node.timelineKey;
    if (tlKey && node.duration) {
      const tl = keyMap[tlKey];
      addToRectQueue(tl.fillColor, node.timestamp, depth, node.duration);
    }

    // The spread operator caused Maximum call stack size exceeded when there are lots of child nodes.
    node.children?.forEach((child) => {
      children.push(child);
    });
  }

  if (!children.length) {
    return;
  }

  nodesToRectangles(children, depth + 1);
}

interface Rect {
  x: number;
  y: number;
  w: number;
}

const rectRenderQueue = new Map<string, Rect[]>();

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
    items.forEach(drawRect);
    ctx.fill();
    ctx.stroke();
  }
}

const drawRect = (rect: Rect) => {
  // nanoseconds
  const w = rect.w * state.zoom;
  if (w >= 0.05) {
    const x = rect.x * state.zoom - state.offsetX;
    const y = rect.y * scaleY - state.offsetY;
    if (x < displayWidth && x + w > 0 && y > -displayHeight && y + scaleY < 0) {
      ctx.rect(x, y, w, scaleY);
    }
  }
};

function drawTruncation(ctx: CanvasRenderingContext2D) {
  // TODO: Fix global event overlap / wobble when scolling left + right when zoomed in
  const len = truncated.length;
  if (!len) {
    return;
  }
  let i = 0;

  while (i < len) {
    const thisEntry = truncated[i++],
      nextEntry = truncated[i] ?? [],
      startTime = thisEntry[1],
      endTime = nextEntry[1] ?? totalDuration;

    if (thisEntry[2]) {
      ctx.fillStyle = thisEntry[2];
    }
    const x = startTime * state.zoom - state.offsetX;
    const w = (endTime - startTime) * state.zoom;
    ctx.fillRect(x, -displayHeight, w, displayHeight);
  }
}

function calculateSizes() {
  totalDuration = timelineRoot.exitStamp || 0; // maximum display value in nano-seconds
  maxY = getMaxDepth(timelineRoot); // maximum nested call depth
  resetView();
}

function resetView() {
  resize();
  realHeight = -scaleY * maxY;
  state.offsetX = 0;
  state.offsetY = 0;
}

function resize() {
  const { clientWidth: newWidth, clientHeight: newHeight } = container;
  if (
    newWidth &&
    newHeight &&
    (newWidth !== displayWidth || newHeight !== displayHeight)
  ) {
    canvas.width = displayWidth = newWidth;
    canvas.height = displayHeight = newHeight;
    ctx.setTransform(1, 0, 0, 1, 0, displayHeight); // shift y-axis down so that 0,0 is bottom-lefts

    const newDefaultZoom = newWidth / totalDuration;
    // defaults if not set yet
    state.defaultZoom ||= state.zoom ||= newDefaultZoom;

    const newScaleX = state.zoom - (state.defaultZoom - newDefaultZoom);
    state.zoom = Math.min(newScaleX, 0.3);
    state.defaultZoom = newDefaultZoom;
  }
  resizeFont();
}

function resizeFont() {
  scaleFont = state.zoom > 0.0000004 ? "normal 16px serif" : "normal 8px serif";
}

export default async function renderTimeline(rootMethod: RootNode) {
  renderTimelineKey();
  container = document.getElementById("timelineWrapper") as HTMLDivElement;
  canvas = document.getElementById("timeline") as HTMLCanvasElement;
  ctx = canvas.getContext("2d", { alpha: false })!; // can never be null since context (2d) is a supported type.
  timelineRoot = rootMethod;
  calculateSizes();
  nodesToRectangles([timelineRoot], -1);
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
    resize();
    ctx.clearRect(0, -displayHeight, displayWidth, displayHeight);
    drawTruncation(ctx);
    drawScale(ctx);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    renderRectangles(ctx);
  }
  state.shouldRedraw = false;
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
    const starttime = node.timestamp * state.zoom - state.offsetX;
    const width = node.duration * state.zoom;
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
  if (!dragging && container && tooltip) {
    const depth = ~~(
      ((displayHeight - offsetY - state.offsetY) / realHeight) *
      maxY
    );
    let tooltipText =
      findTimelineTooltip(offsetX, depth) || findTruncatedTooltip(offsetX);

    if (tooltipText) {
      showTooltipWithText(offsetX, offsetY, tooltipText, tooltip, container);
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
    if (target.timestamp && target.duration && target.selfTime) {
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
              ` (self ${formatDuration(target.selfTime)})`
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
      endTime = nextEntry[1] ?? totalDuration;

    if (
      x >= startTime * state.zoom - state.offsetX &&
      x <= endTime * state.zoom - state.offsetX
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

    tooltip.innerHTML = "";
    tooltip.appendChild(tooltipText);
    tooltip.style.cssText = `left:${posLeft}px; top:${posTop}px; display: block;`;

    const xDelta = tooltip.offsetWidth - timelineWrapper.offsetWidth + posLeft;
    if (xDelta > 0) {
      posLeft -= xDelta - 4;
    }

    const yDelta = tooltip.offsetHeight - timelineWrapper.offsetHeight + posTop;
    if (yDelta > 0) {
      posTop -= tooltip.offsetHeight + 4;
    }

    if (xDelta > 0 || yDelta > 0) {
      tooltip.style.cssText = `left:${posLeft}px; top:${posTop}px; display: block;`;
    }
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
      ((displayHeight - lastMouseY - state.offsetY) / realHeight) *
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
    tooltip.style.display = "none";
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
    const maxWidth = state.zoom * totalDuration - displayWidth;
    state.offsetX = Math.max(0, Math.min(maxWidth, state.offsetX - movementX));

    const maxVertOffset = ~~(realHeight - displayHeight + displayHeight / 4);
    state.offsetY = Math.min(
      0,
      Math.max(-maxVertOffset, state.offsetY - movementY)
    );
  }
}

let shouldRedraw = true;
function handleScroll(evt: WheelEvent) {
  if (!dragging) {
    tooltip.style.display = "none";
    evt.stopPropagation();
    const { deltaY, deltaX } = evt;

    const oldZoom = state.zoom;
    let zoomDelta = (deltaY / 1000) * state.zoom;
    const updatedZoom = state.zoom - zoomDelta;
    zoomDelta =
      updatedZoom >= state.defaultZoom
        ? zoomDelta
        : state.zoom - state.defaultZoom;
    //TODO: work out a proper max zoom
    // stop zooming at 0.0001 ms
    zoomDelta = updatedZoom <= 0.3 ? zoomDelta : state.zoom - 0.3;
    // movement when zooming
    if (zoomDelta !== 0) {
      state.zoom = state.zoom - zoomDelta;
      if (state.zoom !== oldZoom) {
        const timePosBefore = (lastMouseX + state.offsetX) / oldZoom;
        const newOffset = timePosBefore * state.zoom - lastMouseX;
        const maxWidth = state.zoom * totalDuration - displayWidth;
        state.offsetX = Math.max(0, Math.min(maxWidth, newOffset));
      }
    }
    // movement when zooming
    else {
      const maxWidth = state.zoom * totalDuration - displayWidth;
      state.offsetX = Math.max(0, Math.min(maxWidth, state.offsetX + deltaX));
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
export { totalDuration };
