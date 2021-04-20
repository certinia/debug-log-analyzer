/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, {showTab} from './Util.js';
import {truncated} from './LineParser.js';

const defaultScaleX = 0.000001,
	maxCanvasWidth = 32000,
	scaleY = -15,
	keyMap = {
		codeUnit: {
			label: 'Code Unit',
			strokeColor: '#B0B0B0',
			fillColor: '#6BAD68',
			textColor: '#FFFFFF'
		},
		soql: {
			label: 'SOQL',
			strokeColor: '#B0B0B0',
			fillColor: '#4B9D6E',
			textColor: '#FFFFFF'
		},
		method: {
			label: 'Method',
			strokeColor: '#B0B0B0',
			fillColor: '#328C72',
			textColor: '#FFFFFF'
		},
		flow: {
			label: 'Flow',
			strokeColor: '#B0B0B0',
			fillColor: '#237A72',
			textColor: '#FFFFFF'
		},
		dml: {
			label: 'DML',
			strokeColor: '#B0B0B0',
			fillColor: '#22686D',
			textColor: '#FFFFFF'
		},
		workflow: {
			label: 'Workflow',
			strokeColor: '#B0B0B0',
			fillColor: '#285663',
			textColor: '#FFFFFF'
		},
		systemMethod: {
			label: 'System Method',
			strokeColor: '#B0B0B0',
			fillColor: '#2D4455',
			textColor: '#FFFFFF'
		}
	};

let	scaleX,
	scaleFont,
	maxX,
	maxY,
	logicalWidth,
	logicalHeight,
	displayWidth,
	displayHeight,
	timelineRoot,
	lastMouseX,
	lastMouseY;

function getMaxWidth(node) {
	if (node.exitStamp) {
		return node.exitStamp;
	}
	if (!node.children) {
		return null;
	}

	let maxX = node.timestamp || 0;
	for (let c = node.children.length - 1; c >= 0; --c) {
		const max = getMaxWidth(node.children[c]);
		if (max > maxX) {
			maxX = max;
		}
	}

	return maxX;
}

function getMaxDepth(node, depth = 0) {
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

function drawScale(ctx) {
	ctx.lineWidth = 1;
	ctx.font = scaleFont;
	ctx.textBaseline = 'top';
	ctx.textAlign = 'left';

	const xStep = 100000000,	// 1/10th second
		detailed = scaleX > 0.0000002,	// threshHold for 1/10ths and text
		labeled = scaleX > 0.00000002;	// threshHold for labels
	for (let x = xStep, i = 1; x < maxX; x += xStep, ++i) {
		const major = i % 10 === 0,		// whole seconds
			xPos = x * scaleX;

		if (detailed || major) {
			ctx.strokeStyle = major ? '#F88962' : '#E0E0E0';
			ctx.beginPath();
			ctx.moveTo(xPos, -logicalHeight);
			ctx.lineTo(xPos, 0);
			ctx.stroke();

			if (labeled) {
				const seconds = x / 1000000000;
				ctx.fillStyle = major ? '#F88962' : '#808080';
				ctx.fillText(seconds.toFixed(1) + 's', xPos + 2, -logicalHeight + 2);
			}
		}
	}
}

function drawNodes(ctx, node, depth) {
	const tlKey = node.timelineKey;

	if (tlKey) {
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

function drawTruncation(ctx) {
	const len = truncated.length;
	let i = 0;

	while (i < len) {
		const thisEntry = truncated[i++],
			nextEntry = i < len ? truncated[i] : null,
			startTime = thisEntry.timestamp,
			endTime = nextEntry ? nextEntry.timestamp : maxX;

		ctx.fillStyle = thisEntry.color;
		ctx.fillRect(startTime * scaleX, -logicalHeight, (endTime - startTime) * scaleX, logicalHeight);
	}
}

function calculateSizes(canvas) {
	maxX = getMaxWidth(timelineRoot);				// maximum display value in nano-seconds
	maxY = getMaxDepth(timelineRoot);				// maximum nested call depth

	const shrinkToFit = document.getElementById('shrinkToFit').checked;
	if (shrinkToFit) {
		const viewWidth = document.getElementById('timelineScroll').offsetWidth;
		scaleX = viewWidth / maxX;					// ok to use the default scale
	} else if (defaultScaleX * maxX < maxCanvasWidth) {	// does the default scale fit our canvas?
		scaleX = defaultScaleX;						// ok to use the default scale
	} else {
		scaleX = maxCanvasWidth / maxX;				// adjust the scale to avoid overflow
	}

	scaleFont = scaleX > 0.0000004 ? 'normal 16px serif' : 'normal 8px serif';
	logicalWidth = canvas.width = scaleX * maxX;	// maximum scaled value to draw
	displayWidth = logicalWidth;					// canvas display width (1-to-1 with logical width)
	canvas.style.width = displayWidth + 'px';
	logicalHeight = canvas.height = -scaleY * maxY;	// maximum scaled value to draw
	displayHeight = logicalHeight;					// canvas display height (1-to-1 with logical height)
	canvas.style.height = displayHeight + 'px';
}

export default function renderTimeline(rootMethod) {
	const canvas = document.getElementById('timeline'),
		ctx = canvas.getContext('2d');

	timelineRoot = rootMethod;
	calculateSizes(canvas);

	ctx.setTransform(1, 0, 0, 1, 0, logicalHeight);	// shift y-axis down so that 0,0 is bottom-left

	if (truncated.length > 0) {
		drawTruncation(ctx);
	}
	drawScale(ctx);
	drawNodes(ctx, timelineRoot, 0);
}

function renderTimelineKey() {
	const keyHolder = document.getElementById('timelineKey'),
		title = document.createElement('span');

	keyHolder.innerHTML = '';
	title.innerText = '';
	keyHolder.appendChild(title);

	for (const keyName in keyMap) {
		const keyMeta = keyMap[keyName],
			keyEntry = document.createElement('div'),
			title = document.createElement('span');

		title.innerText = keyMeta.label;
		keyEntry.className = 'keyEntry';
		keyEntry.style.backgroundColor = keyMeta.fillColor;
		keyEntry.style.color = keyMeta.textColor;
		keyEntry.appendChild(title);
		keyHolder.appendChild(keyEntry);
	}
}

function onShrinkToFit(evt) {
	renderTimeline(timelineRoot);
}

function findByPosition(node, depth, x, targetDepth) {
	if (node.duration) {		// we can only test nodes with a duration
		if (node.timestamp > x || node.exitStamp < x) {
			return null;		// x-axis miss (can't include us or children)
		}

		if (depth === targetDepth) {
			return node;		// target found!
		}
	}

	if (node.children) {		// search children
		const childDepth = node.duration ? depth + 1 : depth;
		if (targetDepth >= childDepth) {
			const len = node.children.length;
			for (let c = 0; c < len; ++c) {
				const target = findByPosition(node.children[c], childDepth, x, targetDepth);
				if (target) {
					return target;
				}
			}
		}
	}

	return null;				// target not found!
}

function showTooltip(offsetX, offsetY) {
	const timelineScroll = document.getElementById('timelineScroll'),
		x = (offsetX + timelineScroll.scrollLeft) / displayWidth * maxX,
		depth = ~~((displayHeight - offsetY) / displayHeight * maxY),
		tooltip = document.getElementById('tooltip');

	const target = findByPosition(timelineRoot, 0, x, depth);
	if (target) {
		let posLeft = offsetX + 10,
			posTop = offsetY + 2,
			text = target.type + '<br>' + target.text;

		if (target.timestamp) {
			text += '<br>timestamp: ' + target.timestamp;
			if (target.exitStamp) {
				text += ' => ' + target.exitStamp;
				text += '<br>duration: ' + formatDuration(target.duration);
				if (target.cpuType === 'free') {
					text += ' (free)';
				} else {
					text += ' (netDuration: ' + formatDuration(target.netDuration) + ')';
				}
			}
		}
		tooltip.innerHTML = text;
		tooltip.style.display = 'block';

		if ((posLeft + tooltip.offsetWidth) > timelineScroll.offsetWidth) {
			posLeft = timelineScroll.offsetWidth - tooltip.offsetWidth;
		}
		tooltip.style.left = posLeft + timelineScroll.offsetLeft + 'px';
		if ((posTop + tooltip.offsetHeight) > timelineScroll.offsetHeight) {
			posTop -= (tooltip.offsetHeight + 4);
			if (posTop < -100) {
				posTop = -100;
			}
		}
		tooltip.style.top = posTop + timelineScroll.offsetTop + 'px';
		// console.debug('Mouse at ' + offsetX + 'x' + offsetY + ' Tooltip at ' + posLeft + 'x' + posTop + ' to ' + (posLeft + w) + 'x' + (posTop + h));
	} else {
		tooltip.style.display = 'none';
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
function onMouseMove(evt) {
	const target = evt.target;

	if (target.id === 'timeline' || target.id === 'tooltip') {
		const timelineScroll = document.getElementById('timelineScroll'),
			clRect = timelineScroll.getClientRects()[0],
			style = window.getComputedStyle(timelineScroll),
			borderLeft = parseInt(style.borderLeftWidth, 10),
			borderTop = parseInt(style.borderTopWidth, 10);

		lastMouseX = evt.clientX - clRect.left - borderLeft;
		lastMouseY = evt.clientY - clRect.top - borderTop;
		showTooltip(lastMouseX, lastMouseY);
		// console.debug('Mouse: ' + evt.target.id + ' - ' + lastMouseX + 'x' + lastMouseY);
	}
}

function showNode(elm, expand) {
	if (expand) {
		const toggle = elm.querySelector('.toggle'),
			childContainer = elm.querySelector('.childContainer');

		childContainer.style.display = 'block';
		toggle.textContent = '-';
	}

	const parent = elm.parentElement;
	if (parent.id !== 'tree') {		// stop at the root of the tree
		showNode(parent, true);
	}
}

function onClickCanvas(evt) {
	const x = evt.offsetX / displayWidth * maxX,
		depth = ~~((displayHeight - evt.offsetY) / displayHeight * maxY);

	const target = findByPosition(timelineRoot, 0, x, depth);
	if (target && target.timestamp) {
		const methodElm = document.querySelector('div[data-enterstamp="' + target.timestamp + '"]'),
			methodName = methodElm.querySelector('span.name') || methodElm;

		showTab('treeTab');
		showNode(methodElm, false);
		methodElm.scrollIntoView();
		window.getSelection().selectAllChildren(methodName);
	}
}

function onLeaveCanvas(evt) {
	if (!evt.relatedTarget || evt.relatedTarget.id !== 'tooltip') {
		const tooltip = document.getElementById('tooltip');
		tooltip.style.display = 'none';
	}
}

function onTimelineScroll() {
	showTooltip(lastMouseX, lastMouseY);
}

function onInitTimeline(evt) {
	const canvas = document.getElementById('timeline'),
		timelineScroll = document.getElementById('timelineScroll'),
		shrinkToFit = document.getElementById('shrinkToFit');

	shrinkToFit.addEventListener('click', onShrinkToFit);
	canvas.addEventListener('click', onClickCanvas);
	canvas.addEventListener('mouseout', onLeaveCanvas);
	timelineScroll.addEventListener('scroll', onTimelineScroll);

	document.addEventListener('mousemove', onMouseMove);	// document seem to get all the events (regardless of which element we're over)

	renderTimelineKey();
}

window.addEventListener('DOMContentLoaded', onInitTimeline);

export { maxX };
