/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { Domain } from 'node:domain';
import {encodeEntities} from './Browser.js';

export function highlightText(unsafeText:string , isBold: boolean) {
	const text = encodeEntities(unsafeText);
	return isBold ? '<b>' + text + '</b>' : text;
}

export default function formatDuration(duration: number) {
	const microSecs = ~~(duration / 1000),		// convert from nano-seconds
		text = String(microSecs),
		textPadded = text.length < 4 ? '0000'.substr(text.length) + text : text,	// length min = 4
		millis = textPadded.substring(0, textPadded.length - 3),
		micros = textPadded.substr(textPadded.length - 3);

	return millis + '.' + micros + 'ms';
}

export function showTab(tabId: string) {
	const tabHolder = document.querySelector('.tabHolder'),
		tab = document.getElementById(tabId),
		tabber = document.querySelector('.tabber'),
		show = tab?.dataset.show,
		tabItem = show ? document.getElementById(show) : null;

	tabHolder?.querySelectorAll('.tab').forEach(t => t.classList.remove('selected'));
	tab?.classList.add('selected');
	tabber?.querySelectorAll('.tabItem').forEach(t => t.classList.remove('selected'));
	if (tabItem) {
		tabItem.classList.add('selected');
	}
}

export function recalculateDurations(node: any) {
	const children = node.children;

	node.netDuration = node.duration = node.exitStamp - node.timestamp;
	for (let i = 0; i < children.length; ++i) {
		const duration = children[i].duration;

		if (duration) {
			node.netDuration -= duration;
		}
	}
}
