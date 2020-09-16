/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, {highlightText} from './Util.js';
import {totalDuration} from './LineParser.js';

const nestedSort = {
		count: ['count', 'duration', 'name'],
		duration: ['duration', 'count', 'name'],
		netDuration: ['netDuration', 'count', 'name'],
		name: ['name', 'count', 'duration']
	};

let	metricList;

function addNodeToMap(map, node, key) {
	const children = node.children;

	if (key) {
		let metrics = map[key];
		if (metrics) {
			++metrics.count;
			if (node.duration) {
				metrics.duration += node.duration;
				metrics.netDuration += node.netDuration;
			}
		} else {
			map[key] = {
				name: key,
				count: 1,
				duration: node.duration || 0,
				netDuration: node.netDuration || 0
			};
		}
	}

	if (children) {
		children.forEach(function (child) {
			addNodeToMap(map, child, child.group || child.text);
		});
	}
}

export default function analyseMethods(rootMethod) {
	const methodMap = {};

	addNodeToMap(methodMap, rootMethod);
	metricList = Object.values(methodMap);
	return metricList;			// return value for unit testing
}

function entrySort(sortField, sortAscending, a, b) {
	let result;

	switch (sortField) {
	case 'count':
		a = a.count;
		b = b.count;
		break;
	case 'duration':
		a = a.duration;
		b = b.duration;
		break;
	case 'netDuration':
		a = a.netDuration;
		b = b.netDuration;
		break;
	default:
		a = a.name;
		b = b.name;
		break;
	}
	// compare with undefined handling (we get undefined durations when the log is truncated - so treat as high)
	if (a === b) {
		result = 0;
	} else if (a === undefined) {
		result = 1;
	} else if (b === undefined) {
		result = -1;
	} else if (a < b) {
		result = -1;
	} else {
		result = 1;
	}
	return sortAscending ? result : -result;
}

function nestedSorter(type, sortAscending, a, b) {
	const sortOrder = nestedSort[type];

	const len = sortOrder.length;
	for (let i = 0; i < len; ++i) {
		const result = entrySort(sortOrder[i], sortAscending, a, b);
		if (result !== 0) {
			return result;
		}
	}

	return 0;
}

function renderAnalysisLine(name, count, duration, netDuration, isBold) {
	const analysisRow = document.createElement('div'),
		nameText = highlightText(name, isBold),
		nameCell = document.createElement('span'),
		countText = highlightText(count, isBold),
		countCell = document.createElement('span'),
		durationText = highlightText(duration, isBold),
		durationCell = document.createElement('span'),
		netDurationText = highlightText(netDuration, isBold),
		netDurationCell = document.createElement('span');

	nameCell.className = 'name';
	nameCell.innerHTML = nameText;
	nameCell.title = nameText;
	countCell.className = 'count';
	countCell.innerHTML = countText;
	durationCell.className = 'duration';
	durationCell.innerHTML = durationText;
	netDurationCell.className = 'netDuration';
	netDurationCell.innerHTML = netDurationText;

	analysisRow.className = isBold ? 'row' : 'row data';
	analysisRow.appendChild(nameCell);
	analysisRow.appendChild(countCell);
	analysisRow.appendChild(durationCell);
	analysisRow.appendChild(netDurationCell);
	return analysisRow;
}

export function renderAnalysis() {
	const sortFieldElm = document.getElementById('sortField'),
		sortField = sortFieldElm.value,
		sortAscendingElm = document.getElementById('sortAscending'),
		sortAscending = sortAscendingElm.checked,
		analysisHeader = document.getElementById('analysisHeader'),
		analysisHolder = document.getElementById('analysis'),
		analysisFooter = document.getElementById('analysisFooter');

	metricList.sort(function (a, b) {
		return nestedSorter(sortField, sortAscending, a, b);
	});

	analysisHeader.innerHTML = '';
	analysisHeader.appendChild(renderAnalysisLine('Method Name', 'Count', 'Duration', 'Net duration', true));

	analysisHolder.innerHTML = '';
	let	totalCount = 0,
		totalNetDuration = 0;
	metricList.forEach(function (metric) {
		var duration = metric.duration ? formatDuration(metric.duration) : '-',
			netDuration = metric.netDuration ? formatDuration(metric.netDuration) : '-';

		analysisHolder.appendChild(renderAnalysisLine(metric.name, metric.count, duration, netDuration));
		totalCount += metric.count;
		totalNetDuration += metric.netDuration;
	});

	if (totalDuration) {
		analysisFooter.innerHTML = '';
		analysisFooter.appendChild(renderAnalysisLine('Total', totalCount, formatDuration(totalDuration), formatDuration(totalNetDuration), true));
	}
}

function onSortChange(evt) {
	renderAnalysis();
}

function onInitAnalysis(evt) {
	const sortField = document.getElementById('sortField'),
		sortAscending = document.getElementById('sortAscending');

	sortField.addEventListener('change', onSortChange);
	sortAscending.addEventListener('change', onSortChange);
}

window.addEventListener('DOMContentLoaded', onInitAnalysis);
