/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, {recalculateDurations} from './Util.js';
import {logLines, lineMeta, truncateLog} from './LineParser.js';

let treeRoot,
	parseDepth,
	lastTimestamp,
	discontinuity;

class LineIterator {
	constructor(lines) {
		this.lines = lines;
		this.index = 0;
	}

	peek() {
		return this.index < this.lines.length ? this.lines[this.index] : null;
	}

	fetch() {
		return this.index < this.lines.length ? this.lines[this.index++] : null;
	}
}

function addBlock(children, lines) {
	if (lines.length > 0) {
		children.push({
			displayType: 'block',
			children: lines
		});
	}
	return [];
}

function endMethod(method, endLine, lineIter) {
	method.exitStamp = endLine.timestamp;
	if (method.onEnd) {				// the method wants to see the exit line
		method.onEnd(endLine);
	}

	// is this a 'good' end line?
	if (method.exitTypes.includes(endLine.type) && (!method.hasLineNumber || endLine.lineNumber === method.lineNumber)) {
		discontinuity = false;		// end stack unwinding
		lineIter.fetch();			// consume the line
	} else {
		if (!discontinuity) {		// discontinuities should have been reported already
			truncateLog(endLine.timestamp, 'Unexpected-Exit', 'unexpected');
		}
	}
}

function getMethod(lineIter, method) {
	const exitTypes = method.exitTypes,
		children = [];

	if (++parseDepth > 1000) {
		debugger;
	}

	if (exitTypes) {
		let	lines = [],
			line;

		while (line = lineIter.peek()) {			// eslint-disable-line no-cond-assign
			if (line.discontinuity) {				// discontinuities are stack unwinding (caused by Exceptions)
				discontinuity = true;				// start unwinding stack
			}
			if (line.isExit) {
				endMethod(method, line, lineIter);
				break;
			}

			lineIter.fetch();						// it's a child - consume the line
			lastTimestamp = line.timestamp;
			if (line.exitTypes || line.displayType === 'method') {
				lines = addBlock(children, lines);
				children.push(getMethod(lineIter, line));
			} else {
				lines.push(line);
			}
		}

		if (line == null) {			// truncated method - terminate at the end of the log
			method.exitStamp = lastTimestamp;
			method.duration = lastTimestamp - method.timestamp;
			truncateLog(lastTimestamp, 'Unexpected-End', 'unexpected');
		}

		addBlock(children, lines);
	}

	method.children = children;

	recalculateDurations(method);

	--parseDepth;
	return method;
}

export function getRootMethod() {
	const lineIter = new LineIterator(logLines),
		children = [],
		rootMethod = {
			text: 'Log Root',
			type: 'ROOT',
			children
		};
	let	lines = [],
		line;

	parseDepth = 0;
	discontinuity = false;
	lastTimestamp = undefined;
	while (line = lineIter.fetch()) {		// eslint-disable-line no-cond-assign
		if (lineMeta[line.type].exitTypes) {
			lines = addBlock(children, lines);
			children.push(getMethod(lineIter, line));
		} else {
			lines.push(line);
		}
	}

	addBlock(children, lines);

	return rootMethod;
}

function getClassName(methodName) {
	const index = methodName.indexOf('.');

	if (index >= 0) {
		return methodName.substr(0, index) + '.cls';
	}
	return methodName.indexOf(' trigger ') >= 0 ? methodName.split(' ')[2] + '.trigger' : null;
}

function onExpandCollapse(evt) {
	const pe = evt.target.parentElement,
		toggle = pe.querySelector('.toggle'),
		childContainer = pe.querySelector('.childContainer');

	switch (toggle.textContent) {
	case '+':
		// expand
		childContainer.style.display = 'block';
		toggle.textContent = '-';
		break;
	case '-':
		// collapse
		childContainer.style.display = 'none';
		toggle.textContent = '+';
		break;
	}
}

function describeMethod(node, linkInfo) {
	const methodPrefix = node.prefix || '',
		methodSuffix = node.suffix || '';

	let text = node.text;
	let link = null;

	if (linkInfo) {
	    link = document.createElement("a");
	    link.setAttribute("href", "#");
	    link.appendChild(document.createTextNode(text));
        link.addEventListener('click', () => {
            openMethodSource(linkInfo);
        });
	    text = ""
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
	if (node.displayType === 'method') {
		if (node.value) {
			desc2 += (' = ' + node.value);
		}
		desc2 += methodSuffix + ' - ';
		desc2 += node.truncated ? 'TRUNCATED' : formatDuration(node.duration) + ' (' + formatDuration(node.netDuration) + ')';
		if (node.lineNumber) {
			desc2 += ', line: ' + node.lineNumber;
		}
	}
	if (node.containsDml || node.containsSoql) {
		let prefix = '';
		if (node.containsDml) {
			prefix = prefix + 'D';
		}
		if (node.containsSoql) {
			prefix = prefix + 'S';
		}
		desc = '(' + prefix + ') ' + desc;
	}
    if (link) {
        return [document.createTextNode(desc), link, document.createTextNode(desc2)];
    }
    else {
	    return [document.createTextNode(desc), document.createTextNode(desc2)];
    }
}

function renderBlock(childContainer, block) {
	const lines = block.children,
		len = lines.length;

	for (let i = 0; i < len; ++i) {
		const line = lines[i],
			txt = line.summaryCount ? (line.group || line.text) : line.text,
			lineNode = document.createElement('div');

		lineNode.className = line.hideable !== false ? 'block detail' : 'block';
		if (line.summaryCount) {
			const countElement = document.createElement('span');

			countElement.innerText = 'x' + line.summaryCount;
			countElement.className = 'count';
			lineNode.appendChild(countElement);
		}
		let text = txt && txt !== line.type ? line.type + ' - ' + txt : line.type;
		if (text.endsWith('\\')) {
			text = text.substring(0, text.length - 1);
		}
		const textNode = document.createTextNode(text);
		lineNode.appendChild(textNode);
		childContainer.appendChild(lineNode);
	}
}

function openMethodSource(info) {
    if (info) {
        window.vscodeAPIInstance.postMessage(info);
    }
}

function showParentMethod(mainNode) {
	const parentContainer = mainNode.parentElement;
	if (parentContainer.id === 'tree') {	// stop at the root of the tree
		return;
	}

	const parentNode = parentContainer.parentElement,
		parentName = parentNode.querySelector('span.name');

	parentName.scrollIntoView();
	window.getSelection().selectAllChildren(parentName);
}

function deriveOpenInfo(node) {
    const
		text = node.text,
		isMethod = node.type === 'METHOD_ENTRY' || node.type === 'CONSTRUCTOR_ENTRY',
		re = /^[0-9a-zA-Z_]+(\.[0-9a-zA-Z_]+)*\(.*\)$/;

	if (!isMethod || !re.test(text))
		return null;

	let lineNumber = "";
	if (node.hasLineNumber)
		lineNumber = "-" + node.lineNumber;

	let qname = text.substr(0, text.indexOf('('))
	if (node.type === 'METHOD_ENTRY') {
		const lastDot = qname.lastIndexOf('.');
		return {
			typeName: text.substr(0, lastDot) + lineNumber,
			text: text
		}
	} else {
		return {
			typeName: qname + lineNumber,
			text: text
		}
	}
}

function renderTreeNode(node, calledFrom) {
	const mainNode = document.createElement('div'),
		toggle = document.createElement('span'),
		children = node.children,
		toggleNode = document.createTextNode(children.length > 0 ? '+' : ' '),
		childContainer = document.createElement('div'),
		titleElement = document.createElement('span'),
		fileOpenInfo = deriveOpenInfo(node),
		titleElements = describeMethod(node, fileOpenInfo);
    for (let i = 0; i < titleElements.length; i++) {
    	titleElement.appendChild(titleElements[i]);
    }
	titleElement.className = 'name';
	if (children.length > 0) {
		toggle.className = 'toggle';
		toggle.addEventListener('click', onExpandCollapse);
	} else {
		toggle.className = 'indent';
	}
	toggle.appendChild(toggleNode);

	childContainer.className = 'childContainer';
	childContainer.style.display = 'none';
	const len = children.length;
	for (let i = 0; i < len; ++i) {
		const child = children[i];
		switch (child.displayType) {
		case 'method':
			childContainer.appendChild(renderTreeNode(child, getClassName(node.text)));
			break;
		case 'block':
			renderBlock(childContainer, child);
			break;
		}
	}

	if (node.timestamp) {
		mainNode.dataset.enterstamp = '' + node.timestamp;
	}
	mainNode.className = node.classes || '';
	mainNode.appendChild(toggle);
	if (node.summaryCount) {
		const countElement = document.createElement('span');

		countElement.innerText = 'x' + node.summaryCount;
		countElement.className = 'count';
		mainNode.appendChild(countElement);
	}
	mainNode.appendChild(titleElement);
	mainNode.appendChild(childContainer);

	return mainNode;
}

function renderTree() {
	const treeContainer = document.getElementById('tree');

	treeContainer.innerHTML = '';
	treeContainer.appendChild(renderTreeNode(treeRoot, null));
}

export default function renderTreeView(rootMethod) {
	treeRoot = rootMethod;
	renderTree();
}

function expand(elm) {
	const toggle = elm.querySelector('.toggle');

	if (toggle && toggle.textContent !== ' ') {	// can we toggle this block?
		const childContainer = elm.querySelector('.childContainer');
		childContainer.style.display = 'block';
		toggle.textContent = '-';

		let	child = childContainer.firstElementChild;
		while (child) {
			if (!child.classList.contains('block')) {
				expand(child);
			}
			child = child.nextElementSibling;
		}
	}
}

function collapse(elm) {
	const toggle = elm.querySelector('.toggle');

	if (toggle && toggle.textContent !== ' ') {	// can we toggle this block?
		const childContainer = elm.querySelector('.childContainer');
		childContainer.style.display = 'none';
		toggle.textContent = '+';

		let child = childContainer.firstElementChild;
		while (child) {
			if (!child.classList.contains('block')) {
				collapse(child);
			}
			child = child.nextElementSibling;
		}
	}
}

function onExpandAll(evt) {
	const treeContainer = document.getElementById('tree');

	expand(treeContainer.firstElementChild);
}

function onCollapseAll(evt) {
	const treeContainer = document.getElementById('tree');

	collapse(treeContainer.firstElementChild);
}

function hideBySelector(selector, hide) {
	const sheet = document.styleSheets[0],
		rules = sheet.rules;

	for (let i = 0; i < rules.length; ++i) {
		const rule = rules[i];
		if (rule.selectorText === selector) {
			rule.style.display = hide ? 'none' : 'block';
			break;
		}
	}
}

function onHideDetails(evt) {
	hideBySelector('.detail', evt.target.checked);
}

function onHideSystem(evt) {
	hideBySelector('.node.system', evt.target.checked);
}

function onHideFormula(evt) {
	hideBySelector('.node.formula', evt.target.checked);
}

function onInitTree(evt) {
	const expandAll = document.getElementById('expandAll'),
		collapseAll = document.getElementById('collapseAll'),
		hideDetails = document.getElementById('hideDetails'),
		hideSystem = document.getElementById('hideSystem'),
		hideFormula = document.getElementById('hideFormula');

	expandAll.addEventListener('click', onExpandAll);
	collapseAll.addEventListener('click', onCollapseAll);
	hideDetails.addEventListener('change', onHideDetails);
	hideSystem.addEventListener('change', onHideSystem);
	hideFormula.addEventListener('change', onHideFormula);
}

window.addEventListener('DOMContentLoaded', onInitTree);
