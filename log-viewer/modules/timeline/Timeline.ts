/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
//TODO:Refactor - usage should look more like `new TimeLine(timelineContainer, {tooltip:true}:Config)`;
import formatDuration, { debounce } from '../Util.js';
import { goToRow } from '../components/calltree-view/CalltreeView.js';
import type { ApexLog, LogEvent } from '../parsers/LogEvents.js';
import type { LogIssue, LogSubCategory } from '../parsers/types.js';

export interface TimelineGroup {
  label: string;
  fillColor: string;
}

/* eslint-disable @typescript-eslint/naming-convention */
interface TimelineColors {
  'Code Unit': '#88AE58';
  Workflow: '#51A16E';
  Method: '#2B8F81';
  Flow: '#337986';
  DML: '#285663';
  SOQL: '#5D4963';
  'System Method': '#5C3444';
}
/* eslint-enable @typescript-eslint/naming-convention */

const truncationColors: Map<string, string> = new Map([
  ['error', 'rgba(255, 128, 128, 0.2)'],
  ['skip', 'rgb(30, 128, 255, 0.2)'],
  ['unexpected', 'rgba(128, 128, 255, 0.2)'],
]);

interface Rect {
  x: number;
  y: number;
  w: number;
  borderColor: string;
}

const scaleY = -15;
const strokeColor = '#D3D3D3';
export const keyMap: Map<LogSubCategory, TimelineGroup> = new Map([
  [
    'Code Unit',
    {
      label: 'Code Unit',
      fillColor: '#88AE58',
    },
  ],
  [
    'Workflow',
    {
      label: 'Workflow',
      fillColor: '#51A16E',
    },
  ],
  [
    'Method',
    {
      label: 'Method',
      fillColor: '#2B8F81',
    },
  ],
  [
    'Flow',
    {
      label: 'Flow',
      fillColor: '#337986',
    },
  ],
  [
    'DML',
    {
      label: 'DML',
      fillColor: '#285663',
    },
  ],
  [
    'SOQL',
    {
      label: 'SOQL',
      fillColor: '#5D4963',
    },
  ],
  [
    'System Method',
    {
      label: 'System Method',
      fillColor: '#5C3444',
    },
  ],
]);

class State {
  public isRedrawQueued = true;
  public defaultZoom = 0;

  private _zoom = 0;
  private _offsetY = 0;
  private _offsetX = 0;

  public set zoom(zoom: number) {
    this._zoom = zoom;
    this.requestRedraw();
  }

  public get zoom() {
    return this._zoom;
  }

  public set offsetY(offsetY: number) {
    if (this._offsetY !== offsetY) {
      this._offsetY = offsetY;
      this.requestRedraw();
    }
  }

  public get offsetY() {
    return this._offsetY;
  }

  public set offsetX(offsetX: number) {
    if (this._offsetX !== offsetX) {
      this._offsetX = offsetX;
      this.requestRedraw();
    }
  }

  public get offsetX() {
    return this._offsetX;
  }

  public requestRedraw() {
    if (!this.isRedrawQueued) {
      this.isRedrawQueued = true;
      requestAnimationFrame(drawTimeLine);
    }
  }
}

const state = new State();

let tooltip: HTMLDivElement;
let container: HTMLDivElement;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D | null;

let isVisible = false;
let realHeight = 0;
let scaleFont: string,
  maxY: number,
  displayHeight: number,
  displayWidth: number,
  timelineRoot: ApexLog,
  lastMouseX: number,
  lastMouseY: number,
  dpr = window.devicePixelRatio || 1;

let searchString: string = '';
let matchIndex: number | null = null;
let findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
  text: '',
  count: 1,
  options: { matchCase: false },
};
let totalMatches = 0;

function getMaxDepth(nodes: LogEvent[]): number {
  let maxDepth = 0;
  let currentLevel = nodes.filter((n) => n.exitTypes.length);

  while (currentLevel.length) {
    maxDepth++;
    const nextLevel: LogEvent[] = [];
    for (const node of currentLevel) {
      for (const child of node.children) {
        if (child.exitTypes.length) {
          nextLevel.push(child);
        }
      }
    }
    currentLevel = nextLevel;
  }

  return maxDepth;
}

function drawScale(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 1;
  ctx.font = scaleFont;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

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
  ctx.strokeStyle = '#F88962';
  ctx.fillStyle = '#F88962';
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
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000,
    500000, 1000000,
  ];
  const closestIncrement = microSecsToShow.reduce(function (prev, curr) {
    return Math.abs(curr - microSecPixelGap) < Math.abs(prev - microSecPixelGap) ? curr : prev;
  });

  ctx.strokeStyle = '#E0E0E0';
  ctx.fillStyle = '#808080';
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

function nodesToRectangles(rootNodes: LogEvent[]) {
  // seed depth 0
  let depth = 0;
  let currentLevel = rootNodes.filter((n) => n.exitTypes.length);

  while (currentLevel.length) {
    const nextLevel: LogEvent[] = [];

    for (const node of currentLevel) {
      if (node.subCategory && node.duration) {
        addToRectQueue(node, depth);
      }

      for (const child of node.children) {
        if (!child.isDetail) {
          nextLevel.push(child);
        }
      }
    }

    depth++;
    currentLevel = nextLevel;
  }

  // sort all borders once
  const borders = borderRenderQueue.get(findMatchColor);
  if (borders) {
    borders.sort((a, b) => a.x - b.x);
  }
}
const rectRenderQueue = new Map<LogSubCategory, Rect[]>();
const borderRenderQueue = new Map<string, Rect[]>();
let borderSettings = new Map<string, number>();
let findMatchColor = '#ea5c0054';
let currentFindMatchColor = '#9e6a03';

/**
 * Create a rectangle for the node and add it to the correct render list for it's type.
 * @param node The node to be rendered
 * @param y The call depth of the node
 */
function addToRectQueue(node: LogEvent, y: number) {
  const {
    subCategory: subCategory,
    timestamp: x,
    duration: { total: w },
  } = node;

  let borderColor = '';
  if (hasFindMatch(node)) {
    borderColor = findMatchColor;
  }

  const rect: Rect = { x, y, w, borderColor };
  let list = rectRenderQueue.get(subCategory);
  if (!list) {
    rectRenderQueue.set(subCategory, (list = []));
  }
  list.push(rect);

  let borders = borderRenderQueue.get(borderColor);
  if (!borders) {
    borderRenderQueue.set(borderColor, (borders = []));
  }
  borders.push(rect);
}

function hasFindMatch(node: LogEvent) {
  if (!searchString || !node) {
    return false;
  }

  const nodeType = node.type;
  const matchType = findArgs.options.matchCase
    ? nodeType?.includes(searchString)
    : nodeType?.toLowerCase().includes(searchString);
  if (matchType) {
    return matchType;
  }

  return findArgs.options.matchCase
    ? node.text.includes(searchString)
    : node.text.toLowerCase().includes(searchString);
}

function renderRectangles(ctx: CanvasRenderingContext2D) {
  // rectRenderQueue is grouped by Timeline Key (rectangle color), draw rectangles based on fill color .
  ctx.lineWidth = 1;
  ctx.strokeStyle = strokeColor;
  ctx.globalAlpha = 1;
  for (const [tlKey, items] of rectRenderQueue) {
    const tl = keyMap.get(tlKey);
    if (!tl) {
      continue;
    }
    ctx.beginPath();
    ctx.fillStyle = tl.fillColor;
    items.forEach((item) => {
      drawRect(item);
    });
    ctx.fill();
    ctx.closePath();
  }

  // Draw borders around the rectangles
  const currentFindMatchIndex = (matchIndex ?? 0) - 1;
  for (const [borderColor, items] of borderRenderQueue) {
    ctx.lineWidth = borderSettings.get(borderColor) || 1;
    ctx.strokeStyle = borderColor;

    ctx.beginPath();
    items.forEach((item, index) => {
      if (currentFindMatchIndex !== index) {
        drawBorder(item);
      }
    });
    ctx.stroke();
    ctx.closePath();
  }

  const findResults = borderRenderQueue.get(findMatchColor);
  if (findResults?.length) {
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = findMatchColor;

    ctx.beginPath();
    findResults.forEach((item, index) => {
      if (currentFindMatchIndex !== index) {
        drawBorder(item);
      }
    });
    ctx.fill();
    ctx.closePath();

    const currentFindMatch = findResults[currentFindMatchIndex];
    if (currentFindMatch) {
      ctx.strokeStyle = currentFindMatchColor;
      ctx.fillStyle = currentFindMatchColor;
      ctx.beginPath();

      drawBorder(currentFindMatch, true);
      ctx.stroke();
      ctx.fill();
      ctx.closePath();
    }
    ctx.globalAlpha = 1;
  }
}

const drawBorder = (rect: Rect, ignoreWidth: boolean = false) => {
  if (!ctx) {
    return;
  }
  // nanoseconds
  let w = rect.w * state.zoom;
  if (w >= 0.05 || ignoreWidth) {
    let x = rect.x * state.zoom - state.offsetX;
    const y = rect.y * scaleY - state.offsetY;
    if (x < displayWidth && x + w > 0 && y > -displayHeight && y + scaleY < 0) {
      // start of shape is outside the screen (remove from start and the end to compensate)
      if (x < 0) {
        w = w + x;
        x = 0;
      }
      // end of shape is outside the screen (remove from end so we are not showing anything that is offscreen)
      const widthOffScreen = x + w - displayWidth;
      if (widthOffScreen > 0) {
        w = w - widthOffScreen;
      }

      ctx.rect(x, y, w, scaleY);
    }
  }
};

const drawRect = (rect: Rect, ignoreWidth: boolean = false) => {
  if (!ctx) {
    return;
  }
  // nanoseconds
  let w = rect.w * state.zoom;
  if (w >= 0.05 || ignoreWidth) {
    let x = rect.x * state.zoom - state.offsetX;
    const y = rect.y * scaleY - state.offsetY;
    if (x < displayWidth && x + w > 0 && y > -displayHeight && y + scaleY < 0) {
      // start of shape is outside the screen (remove from start and the end to compensate)
      if (x < 0) {
        w = w + x;
        x = 0;
      }
      // end of shape is outside the screen (remove from end so we are not showing anything that is offscreen)
      const widthOffScreen = x + w - displayWidth;
      if (widthOffScreen > 0) {
        w = w - widthOffScreen;
      }

      ctx?.rect(x, y, w, scaleY);
    }
  }
};

function drawTruncation(ctx: CanvasRenderingContext2D) {
  const issues = timelineRoot.logIssues;
  const len = issues.length;
  if (!len) {
    return;
  }
  let i = 0;

  ctx.strokeStyle = '#808080';
  ctx.beginPath();

  while (i < len) {
    const thisEntry = issues[i++],
      nextEntry = issues[i];

    if (thisEntry?.startTime) {
      const startTime = thisEntry.startTime,
        endTime = nextEntry?.startTime ?? timelineRoot.exitStamp;

      let x = startTime * state.zoom - state.offsetX;
      let w = (endTime - startTime) * state.zoom;

      // start of shape is outside the screen (remove from start and the end to compensate)
      if (x < 0) {
        w = w + x;
        x = 0;
      }
      // end of shape is outside the screen (remove from end so we are not showing anything that is offscreen)
      const widthOffScreen = x + w - displayWidth;
      if (widthOffScreen > 0) {
        w = w - widthOffScreen;
      }

      ctx.moveTo(x, -displayHeight);
      ctx.lineTo(x, 0);

      ctx.moveTo(x + w, -displayHeight);
      ctx.lineTo(x + w, 0);

      ctx.fillStyle = truncationColors.get(thisEntry.type) || '';
      ctx.fillRect(x, -displayHeight, w, displayHeight);
    }
  }
  ctx.stroke();
}

function calculateSizes() {
  maxY = getMaxDepth(timelineRoot.children); // maximum nested call depth
  resetView();
}

function resetView() {
  resize();
  realHeight = -scaleY * maxY;
  state.offsetX = 0;
  state.offsetY = 0;
}

function resize() {
  if (!container || !ctx) {
    return;
  }

  dpr ??= window.devicePixelRatio || 1;
  const { width: newWidth, height: newHeight } = container.getBoundingClientRect();
  isVisible = !!newWidth;

  if (newWidth && newHeight && (newWidth !== displayWidth || newHeight !== displayHeight)) {
    canvas.width = newWidth * dpr;
    canvas.height = newHeight * dpr;
    displayWidth = newWidth;
    displayHeight = newHeight;

    // shift y-axis down so that 0,0 is bottom-lefts
    ctx.setTransform(1, 0, 0, 1, 0, canvas.height);
    // Scale all drawing operations by the dpr, so you
    // don't have to worry about the difference.
    ctx.scale(dpr, dpr);

    const newDefaultZoom = displayWidth / timelineRoot.exitStamp;
    // defaults if not set yet
    state.defaultZoom ||= state.zoom ||= newDefaultZoom;

    const newScaleX = state.zoom - (state.defaultZoom - newDefaultZoom);
    state.zoom = Math.min(newScaleX, 0.3);
    state.defaultZoom = newDefaultZoom;
  }
  resizeFont();
}

function resizeFont() {
  scaleFont = state.zoom > 0.0000004 ? 'normal 16px serif' : 'normal 8px serif';
}

export function init(timelineContainer: HTMLDivElement, rootMethod: ApexLog) {
  container = timelineContainer;
  canvas = timelineContainer.querySelector('#timeline')!;
  ctx = canvas.getContext('2d'); // can never be null since context (2d) is a supported type.
  timelineRoot = rootMethod;
  onInitTimeline();

  calculateSizes();
  nodesToRectangles(timelineRoot.children);
  if (ctx) {
    requestAnimationFrame(drawTimeLine);
  }
}

export function setColors(timelineColors: TimelineColors) {
  for (const keyMeta of keyMap.values()) {
    const newColor = timelineColors[keyMeta.label as keyof TimelineColors];
    if (newColor) {
      keyMeta.fillColor = newColor;
    }
  }
  state.requestRedraw();
}

// todo: this is slugish on zoom. Can be improve without swith from 2dgl? (need to use integer for x and y on .rect())
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
  state.isRedrawQueued = false;
}

function findByPosition(
  nodes: LogEvent[],
  depth: number,
  x: number,
  targetDepth: number,
  shouldIgnoreWidth: boolean,
): LogEvent | null {
  if (!nodes) {
    return null;
  }

  let start = 0,
    end = nodes.length - 1;

  // Iterate as long as the beginning does not encounter the end.
  while (start <= end) {
    // find out the middle index
    const mid = Math.floor((start + end) / 2);

    const node = nodes[mid];
    if (!node) {
      break;
    }
    const starttime = node.timestamp * state.zoom - state.offsetX;
    const width = node.duration.total * state.zoom;
    const endtime = starttime + width;

    // Return True if the element is present in the middle.
    const isInRange = (shouldIgnoreWidth || width >= 0.05) && starttime <= x && endtime >= x;
    const isMatchingDepth = depth === targetDepth;
    if (isInRange && isMatchingDepth && node.duration.total) {
      return node;
    } else if (isInRange && !isMatchingDepth && node.duration.total) {
      return findByPosition(node.children, depth + 1, x, targetDepth, shouldIgnoreWidth);
    }
    // Otherwise, look in the left or right half
    else if (x > endtime) {
      start = mid + 1;
    } else if (x < starttime) {
      end = mid - 1;
    } else {
      return null;
    }
  }

  return null;
}

function showTooltip(offsetX: number, offsetY: number, shouldIgnoreWidth: boolean) {
  if (!dragging && container && tooltip) {
    const depth = getDepth(offsetY);
    const tooltipText =
      findTimelineTooltip(offsetX, depth, shouldIgnoreWidth) ?? findTruncatedTooltip(offsetX);
    showTooltipWithText(offsetX, offsetY, tooltipText, tooltip);
  }
}
function findTimelineTooltip(
  x: number,
  depth: number,
  shouldIgnoreWidth: boolean,
): HTMLDivElement | null {
  const target = findByPosition(timelineRoot.children, 0, x, depth, shouldIgnoreWidth);

  if (target && !target.isDetail) {
    canvas.classList.remove('timeline-hover', 'timeline-dragging');
    canvas.classList.add('timeline-event--hover');

    const rows = [];
    if (target.type) {
      rows.push({ label: 'type:', value: target.type.toString() });
    }

    if (target.exitStamp) {
      if (target.duration.total) {
        let val = formatDuration(target.duration.total, timelineRoot.duration.total);
        if (target.cpuType === 'free') {
          val += ' (free)';
        } else if (target.duration.self) {
          val += ` (self ${formatDuration(target.duration.self)})`;
        }

        rows.push({ label: 'total:', value: val });
      }

      const govLimits = timelineRoot.governorLimits;
      if (target.dmlCount.total) {
        rows.push({
          label: 'DML:',
          value: formatLimit(
            target.dmlCount.total,
            target.dmlCount.self,
            govLimits.dmlStatements.limit,
          ),
        });
      }

      if (target.dmlRowCount.total) {
        rows.push({
          label: 'DML rows:',
          value: formatLimit(
            target.dmlRowCount.total,
            target.dmlRowCount.self,
            govLimits.dmlRows.limit,
          ),
        });
      }

      if (target.soqlCount.total) {
        rows.push({
          label: 'SOQL:',
          value: formatLimit(
            target.soqlCount.total,
            target.soqlCount.self,
            govLimits.soqlQueries.limit,
          ),
        });
      }

      if (target.soqlRowCount.total) {
        rows.push({
          label: 'SOQL rows:',
          value: formatLimit(
            target.soqlRowCount.total,
            target.soqlRowCount.self,
            govLimits.queryRows.limit,
          ),
        });
      }

      if (target.soslCount.total) {
        rows.push({
          label: 'SOSL:',
          value: formatLimit(
            target.soslCount.total,
            target.soslCount.self,
            govLimits.soslQueries.limit,
          ),
        });
      }

      if (target.soslRowCount.total) {
        rows.push({
          label: 'SOSL rows:',
          value: formatLimit(
            target.soslRowCount.total,
            target.soslRowCount.self,
            govLimits.soslQueries.limit,
          ),
        });
      }
    }

    return createTooltip(
      target.text + (target.suffix ?? ''),
      rows,
      keyMap.get(target.subCategory)?.fillColor || '',
    );
  }
  canvas.classList.add('timeline-hover');
  canvas.classList.remove('timeline-event--hover');

  return null;
}

function formatLimit(val: number, self: number, total = 0) {
  const outOf = total > 0 ? `/${total}` : '';
  return `${val}${outOf} (self ${self})`;
}

function createTooltip(title: string, rows: { label: string; value: string }[], color: string) {
  const tooltipBody = document.createElement('div');
  tooltipBody.className = 'timeline-tooltip';

  if (color) {
    tooltipBody.style.borderColor = color;
  }

  const header = document.createElement('div');
  header.className = 'tooltip-header';
  header.textContent = title;
  tooltipBody.appendChild(header);

  rows.forEach(({ label, value }) => {
    const row = document.createElement('div');
    row.className = 'tooltip-row';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'tooltip-label';
    labelDiv.textContent = label;

    const valueDiv = document.createElement('div');
    valueDiv.className = 'tooltip-value';
    valueDiv.textContent = value;

    row.appendChild(labelDiv);
    row.appendChild(valueDiv);
    tooltipBody.appendChild(row);
  });

  return tooltipBody;
}

function findTruncatedTooltip(x: number): HTMLDivElement | null {
  const logIssue = findLogIssue(x);
  if (logIssue) {
    canvas.classList.remove('timeline-hover', 'timeline-dragging');
    canvas.classList.add('timeline-event--hover');

    return createTooltip(logIssue.summary, [], truncationColors.get(logIssue.type) || '');
  }
  canvas.classList.add('timeline-hover');
  canvas.classList.remove('timeline-event--hover');
  return null; // target not found!
}

function findLogIssue(x: number): LogIssue | null {
  const issues = timelineRoot.logIssues;
  const len = issues?.length;
  let i = 0;

  while (i < len) {
    const thisEntry = issues[i++],
      nextEntry = issues[i];
    if (thisEntry?.startTime) {
      const startTime = thisEntry.startTime,
        endTime = nextEntry?.startTime ?? timelineRoot.exitStamp,
        startX = startTime * state.zoom - state.offsetX,
        endX = endTime * state.zoom - state.offsetX;

      if (x >= startX && x <= endX) {
        return thisEntry;
      }
    }
  }
  return null; // target not found!
}

function showTooltipWithText(
  offsetX: number,
  offsetY: number,
  tooltipText: HTMLDivElement | null,
  tooltip: HTMLElement,
) {
  if (tooltipText && tooltip && container) {
    let posLeft = offsetX + 10,
      posTop = offsetY + 2;

    tooltip.innerHTML = '';
    tooltip.appendChild(tooltipText);
    tooltip.style.cssText = `left:${posLeft}px; top:${posTop}px; display: block;`;

    const { offsetWidth: width, offsetHeight: height } = container;
    const xDelta = tooltip.offsetWidth - width + posLeft;
    if (xDelta > 0) {
      posLeft -= xDelta - 4;
    }

    const yDelta = tooltip.offsetHeight - height + posTop;
    if (yDelta > 0) {
      posTop -= tooltip.offsetHeight + 4;
    }

    if (posTop < 0) {
      posTop = 4;
    }

    if (xDelta > 0 || yDelta > 0) {
      tooltip.style.cssText = `left:${posLeft}px; top:${posTop}px; display: block;`;
    }
  } else {
    tooltip.style.display = 'none';
  }
}

function _hideTooltip() {
  tooltip.style.display = 'none';
}

/**
 * Convert target position to timeline position.
 *
 * +-TimelineView---------+		The timelineView is the positioning parent
 * | +-Tooltip-+          |		The tooltip is absolutely positioned
 * | +---------+          |
 * | +-timelineWrapper--+ |		The timelineWrapperer is staticly positioned
 * | | +-Timeline-+    |  |		The timeline is statisly positioned
 * | | +----------+    |  |
 * | +-----------------+  |
 * +----------------------+
 */
function onMouseMove(evt: MouseEvent) {
  const target = evt.target as HTMLElement;

  if (target && canvas && (target.id === 'timeline' || target.id === 'tooltip')) {
    const { left, top } = canvas.getBoundingClientRect();
    lastMouseX = evt.clientX - left;
    lastMouseY = evt.clientY - top;
    debounce(showTooltip)(lastMouseX, lastMouseY, false);
  }
}

function onClickCanvas(): void {
  const isClick = mouseDownPosition.x === lastMouseX && mouseDownPosition.y === lastMouseY;
  if (!dragging && isClick) {
    const depth = getDepth(lastMouseY);
    let timeStamp = findByPosition(timelineRoot.children, 0, lastMouseX, depth, false)?.timestamp;

    if (!timeStamp) {
      timeStamp = findLogIssue(lastMouseX)?.startTime;
    }

    if (timeStamp) {
      goToRow(timeStamp);
    }
  }
}

function getDepth(y: number) {
  return ~~(((displayHeight - y - state.offsetY) / realHeight) * maxY);
}

function depthToMouseY(depth: number) {
  const b2 = (depth / maxY) * realHeight;
  return displayHeight - state.offsetY - b2;
}

function onLeaveCanvas() {
  stopDragging();
  tooltip.style.display = 'none';
}

let dragging = false;
let mouseDownPosition: { x: number; y: number };

function handleMouseDown(): void {
  dragging = true;

  canvas.classList.remove('timeline-hover');
  canvas.classList.add('timeline-dragging');
  tooltip.style.display = 'none';
  mouseDownPosition = {
    x: lastMouseX,
    y: lastMouseY,
  };
}

function handleMouseUp(): void {
  stopDragging();
  debounce(showTooltip)(lastMouseX, lastMouseY, false);
}

function stopDragging() {
  dragging = false;
  canvas.classList.remove('timeline-dragging');
  canvas.classList.add('timeline-hover');
}

function handleMouseMove(evt: MouseEvent) {
  if (dragging) {
    const { movementY, movementX } = evt;
    const maxWidth = state.zoom * timelineRoot.exitStamp - displayWidth;
    state.offsetX = Math.max(0, Math.min(maxWidth, state.offsetX - movementX));

    const maxVertOffset = realHeight - displayHeight + displayHeight / 4;
    state.offsetY = Math.min(0, Math.max(-maxVertOffset, state.offsetY - movementY));
  }
}

function handleScroll(evt: WheelEvent) {
  if (!dragging) {
    evt.stopPropagation();
    const { deltaY, deltaX } = evt;

    const oldZoom = state.zoom;
    let zoomDelta = (deltaY / 1000) * state.zoom;
    const updatedZoom = state.zoom - zoomDelta;
    zoomDelta = updatedZoom >= state.defaultZoom ? zoomDelta : state.zoom - state.defaultZoom;
    //TODO: work out a proper max zoom
    // stop zooming at 0.0001 ms
    zoomDelta = updatedZoom <= 0.3 ? zoomDelta : state.zoom - 0.3;
    // movement when zooming
    if (zoomDelta !== 0) {
      state.zoom = state.zoom - zoomDelta;
      if (state.zoom !== oldZoom) {
        const timePosBefore = (lastMouseX + state.offsetX) / oldZoom;
        const newOffset = timePosBefore * state.zoom - lastMouseX;
        const maxWidth = state.zoom * timelineRoot.exitStamp - displayWidth;
        state.offsetX = Math.max(0, Math.min(maxWidth, newOffset));
      }
    }
    // movement when zooming
    else {
      const maxWidth = state.zoom * timelineRoot.exitStamp - displayWidth;
      state.offsetX = Math.max(0, Math.min(maxWidth, state.offsetX + deltaX));
    }

    debounce(showTooltip)(lastMouseX, lastMouseY, false);
  }
}

function _findOnTimeline(
  e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>,
) {
  if (!isVisible && !totalMatches) {
    return;
  }
  _hideTooltip();

  const newFindArgs = JSON.parse(JSON.stringify(e.detail));
  const newSearch =
    newFindArgs.text !== findArgs.text ||
    newFindArgs.options.matchCase !== findArgs.options?.matchCase;
  findArgs = newFindArgs;

  const clearHighlights = e.type === 'lv-find-close' || (!isVisible && newFindArgs.count === 0);
  if (clearHighlights) {
    newFindArgs.text = '';
  }

  searchString = findArgs.options.matchCase ? findArgs.text : findArgs.text.toLowerCase();
  matchIndex = findArgs.count;
  if (newSearch || clearHighlights) {
    rectRenderQueue.clear();
    borderRenderQueue.clear();
    nodesToRectangles(timelineRoot.children);
    const findResults = borderRenderQueue.get(findMatchColor) || [];
    totalMatches = findResults.length;

    if (!clearHighlights) {
      document.dispatchEvent(
        new CustomEvent('lv-find-results', { detail: { totalMatches: totalMatches } }),
      );
    }
  }

  const findResults = borderRenderQueue.get(findMatchColor) || [];
  const currentMatch = findResults[matchIndex - 1];
  if (currentMatch) {
    const x = currentMatch.x * state.zoom;
    const w = currentMatch.w * state.zoom;
    const xPos = x - state.offsetX;

    if (xPos > displayWidth || xPos + w < 0) {
      // center current event in middle of screen
      const maxWidth = state.zoom * timelineRoot.exitStamp - displayWidth;
      const midPoint = w / 2;
      state.offsetX = Math.max(0, Math.min(maxWidth, x + midPoint - displayWidth / 2));
    }

    const ls = Math.max(x - state.offsetX, 0);
    const rs = Math.min(x + w - state.offsetX, displayWidth);
    const xMidPoint = ls + (rs - ls) / 2;
    showTooltip(xMidPoint, depthToMouseY(currentMatch.y), true);
  }
  state.requestRedraw();
}

function onInitTimeline(): void {
  tooltip = document.createElement('div');
  tooltip.id = 'timeline-tooltip';
  container.appendChild(tooltip);

  const computedStyle = getComputedStyle(canvas);
  findMatchColor =
    computedStyle.getPropertyValue('--vscode-editor-findMatchHighlightBackground') ?? '#ea5c0054';
  currentFindMatchColor =
    computedStyle.getPropertyValue('--vscode-editor-findMatchBackground') ?? '#9e6a03';
  borderSettings = new Map<string, number>([
    [strokeColor, 1],
    [findMatchColor, 2],
  ]);

  if (canvas) {
    canvas.addEventListener('mouseout', onLeaveCanvas);
    canvas.addEventListener('wheel', handleScroll, { passive: true });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove, { passive: true });
    canvas.addEventListener('click', onClickCanvas);
  }

  new ResizeObserver(resize).observe(container);
  container.addEventListener('mousemove', onMouseMove);

  document.addEventListener('lv-find', _findOnTimeline as EventListener);
  document.addEventListener('lv-find-match', _findOnTimeline as EventListener);
  document.addEventListener('lv-find-close', _findOnTimeline as EventListener);
}
