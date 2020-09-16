/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
const convertorDiv = document.createElement('div');

export function decodeEntities(text) {
	if (!text) {
		return text;
	}
	convertorDiv.innerHTML = text;
	return convertorDiv.innerText;
}

export function encodeEntities(unsafeText) {
	if (!unsafeText) {
		return unsafeText;
	}
	convertorDiv.innerText = unsafeText;
	return convertorDiv.innerHTML;
}
