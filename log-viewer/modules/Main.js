/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import {showTab, recalculateDurations} from './Util.js';
import parseLog, {truncated} from './LineParser.js';
import renderTreeView, {getRootMethod} from './TreeView.js';
import renderTimeline, {maxX} from './Timeline.js';
import analyseMethods, {renderAnalysis} from './Analysis.js';
import analyseDb, {renderDb} from './Database.js';
import {setNamespaces} from './NamespaceExtrator.js';

import "../resources/css/Status.css";
import "../resources/css/Header.css";
import "../resources/css/Settings.css";
import "../resources/css/Tabber.css";
import "../resources/css/TreeView.css";
import "../resources/css/TimelineView.css";
import "../resources/css/AnalysisView.css";
import "../resources/css/DatabaseView.css";

const settingsPattern = /\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+/;

let logSize;

async function setStatus(name, path, status, color) {
	const statusHolder = document.getElementById('status'),
		nameSpan = document.createElement('span'),
		nameLink = document.createElement('a'),
		statusSpan = document.createElement('span'),
		sizeText = logSize ? (logSize / 1000000).toFixed(2) + ' MB' : '',
		elapsedText = maxX ? (maxX / 1000000000).toFixed(3) + ' Sec' : '',
		infoSep = sizeText && elapsedText ? ', ' : '',
		infoText = sizeText || elapsedText ? '\xA0(' + sizeText + infoSep + elapsedText + ')' : '';

	nameLink.setAttribute("href", "#");
	nameLink.appendChild(document.createTextNode(name));
    nameLink.addEventListener('click', () => {
		window.vscodeAPIInstance.postMessage({path: path});
    });
	nameSpan.appendChild(nameLink);
	nameSpan.appendChild(document.createTextNode(infoText + '\xA0-\xA0'));

	statusSpan.innerText = status;
	statusSpan.style.color = color;

	statusHolder.innerHTML = '';
	statusHolder.appendChild(nameSpan);
	statusHolder.appendChild(statusSpan);

	if (Array.isArray(truncated)) {
		truncated.forEach(entry => {
			const reasonSpan = document.createElement('span');

			reasonSpan.innerText = entry.reason;
			reasonSpan.className = 'reason';
			reasonSpan.style.backgroundColor = entry.color;
			statusHolder.appendChild(reasonSpan);
		});
	}
	await timeout(10);
}

function getLogSettings(log) {
	const match = log.match(settingsPattern);
	if (!match) {
		return null;
	}

	const settings = match[0],
		settingStr = settings.substring(settings.indexOf(' ') + 1),
		settingList = settingStr.split(';');

	return settingList.reduce((acc, entry) => {
		const parts = entry.split(',');
		acc[parts[0]] = parts[1];
		return acc;
	}, {});
}

async function markContainers(node, targetType, propertyName) {
	const children = node.children,
		len = children.length;

	for (let i = 0; i < len; ++i) {
		const child = children[i];
		if (child.type === targetType) {
			node[propertyName] = true;
		}
		if (child.displayType === 'method') {
			node[propertyName] |= await markContainers(child, targetType, propertyName);
		}
	}

	return node[propertyName];
}

async function insertPackageWrappers(node) {
	const children = node.children,
		isParentDml = node.type === 'DML_BEGIN';

	let lastPkg,
		i = 0;
	while (i < children.length) {
		const child = children[i],
			childType = child.type;

		if (lastPkg) {
			if (childType === 'ENTERING_MANAGED_PKG' && child.namespace === lastPkg.namespace) {
				// combine adjacent (like) packages
				children.splice(i, 1);					// remove redundant child from parent

				lastPkg.exitStamp = child.exitStamp;
				recalculateDurations(lastPkg);
				continue;								// skip any more child processing (it's gone)
			} else if (isParentDml && (childType === 'DML_BEGIN' || childType === 'SOQL_EXECUTE_BEGIN')) {
				// move child DML / SOQL into the last package
				children.splice(i, 1);					// remove moving child from parent
				lastPkg.children.push(child);			// move child into the pkg

				lastPkg.containsDml = child.containsDml || childType === 'DML_BEGIN';
				lastPkg.containsSoql = child.containsSoql || childType === 'SOQL_EXECUTE_BEGIN';
				lastPkg.exitStamp = child.exitStamp;	// move the end
				recalculateDurations(lastPkg);
				if (child.displayType === 'method') {
					await insertPackageWrappers(child);
				}
				continue;								// skip any more child processing (it's moved)
			} else {
				++i;
			}
		} else {
			++i;
		}
		if (child.displayType === 'method') {
			await insertPackageWrappers(child);
		}
		lastPkg = childType === 'ENTERING_MANAGED_PKG' ? child : null;
	}
}

let timerText,
	startTime;

function timer(text) {
	const time = new Date();
	if (timerText) {
		console.debug(timerText + ' = ' + (time - startTime) + 'ms');
	}
	timerText = text;
	startTime = time;
}

async function renderLogSettings(logSettings) {
	const holder = document.getElementById('logSettings');

	holder.innerHTML = '';

	for (const key in logSettings) {
		const level = logSettings[key];

		if (level !== 'NONE') {
			const setting = document.createElement('div'),
				title = document.createElement('span'),
				value = document.createElement('span');

			title.innerText = key + ':';
			title.className = 'settingTitle';
			value.innerText = level;
			value.className = 'settingValue';
			setting.className = 'setting';
			setting.appendChild(title);
			setting.appendChild(value);
			holder.appendChild(setting);
		}
	}
}

async function displayLog(log, name, path) {
	logSize = log.length;
	await setStatus(name, path, "Processing...", "black");
	
	timer("parseLog");
	await Promise.all([
		renderLogSettings(getLogSettings(log)), 
		parseLog(log)
	]);

	timer("getRootMethod");
	const rootMethod = getRootMethod();

	timer("analyse");
	await Promise.all([
		setNamespaces(rootMethod),
		markContainers(rootMethod, "DML_BEGIN", "containsDml"),
		markContainers(rootMethod, "SOQL_EXECUTE_BEGIN", "containsSoql")
	]);
	await insertPackageWrappers(rootMethod);
	await Promise.all([
		analyseMethods(rootMethod), 
		analyseDb(rootMethod)
	]);

	await setStatus(name, path, "Rendering...", "black");

	timer("renderViews");
	await Promise.all([
		renderTreeView(rootMethod),
		renderTimeline(rootMethod),
		renderAnalysis(),
		renderDb()
	]);
	timer("");
	setStatus(name, path, "Ready", truncated.length > 0 ? "red" : "green");
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readLog() {
    const name = document.getElementById("LOG_FILE_NAME").innerHTML;
	const path = document.getElementById("LOG_FILE_PATH").innerHTML;
    const src = document.getElementById("LOG_FILE_TXT").innerHTML;
    const ns = document.getElementById("LOG_FILE_NS").innerHTML;

    // hacky I know
    window.activeNamespaces = ns.split(",");
    window.vscodeAPIInstance = acquireVsCodeApi();
    displayLog(src, name, path);
}

function onTabSelect(evt) {
	showTab(evt.target.id);
}

function onInit(evt) {
	const tabHolder = document.querySelector('.tabHolder');

	tabHolder.querySelectorAll('.tab').forEach(t => t.addEventListener('click', onTabSelect));

	readLog();
}

window.addEventListener('DOMContentLoaded', onInit);
