/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import {decodeEntities} from './Browser.js';

const 
	typePattern = /^[A-Z_]*$/,
	truncateColor = {
		error: 'rgba(255, 128, 128, 0.2)',
		skip: 'rgba(128, 255, 128, 0.2)',
		unexpected: 'rgba(128, 128, 255, 0.2)'
	};

let logLines,
	totalDuration,
	truncated,
	reasons,
	cpuUsed;

export function truncateLog(timestamp, reason, color) {
	if (!reasons[reason]) {
		reasons[reason] = true;
		truncated.push({
			reason,
			timestamp,
			color: truncateColor[color]
		});
	}
}

function parseObjectNamespace(text) {
	const sep = text.indexOf('__');
	if (sep < 0) {
		return 'unmanaged';
	}
	return text.substring(0, sep);
}

function parseVfNamespace(text) {
	const sep = text.indexOf('__');
	if (sep < 0) {
		return 'unmanaged';
	}
	const firstSlash = text.indexOf('/');
	if (firstSlash < 0) {
		return 'unmanaged';
	}
	const secondSlash = text.indexOf('/', firstSlash + 1);
	if (secondSlash < 0) {
		return 'unmanaged';
	}
	return text.substring(secondSlash + 1, sep);
}

function parseTimestamp(text) {
	const timestamp = text.match(/.*\((\d+)\)/);
	return Number(timestamp[1]);
}

function parseLineNumber(text) {
	const lineNumberStr = text.match(/\[(\w*)\]/)[1],
		lineNumber = Number(lineNumberStr);

	return isNaN(lineNumber) ? lineNumberStr : lineNumber;
}

function parseRows(text) {
	const rowCount = text.match(/Rows:(\d+)/)[1];

	return Number(rowCount);
}

/* Log entry Parsers */

function parseMethod(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = decodeEntities(parts[4]) || this.type;
	if (this.text === 'System.Type.forName(String, String)') {
		this.cpuType = 'loading';		// assume we are not charged for class loading (or at least not lengthy remote-loading / compiling)
		// no namespace or it will get charged...
	}
}

function parseMethodExit(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
}

function parseSystemMethod(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = decodeEntities(parts[3]);
}

function parseCodeUnit(parts) {
	const subParts = parts[3].split(':'),
		name = parts[4] || parts[3];

	switch (subParts[0]) {
	case 'EventService':
		this.cpuType = 'method';
		this.namespace = parseObjectNamespace(subParts[1]);
		this.group = 'EventService ' + this.namespace;
		this.text = parts[3];
		break;
	case 'Validation':
		this.cpuType = 'custom';
		this.declarative = true;
		this.group = 'Validation';
		this.text = name || subParts[0] + ':' + subParts[1];
		break;
	case 'Workflow':
		this.cpuType = 'custom';
		this.declarative = true;
		this.group = 'Workflow';
		this.text = name || subParts[0];
		break;
	default:
		this.cpuType = 'method';
		if (name && name.startsWith('VF:'))
			this.namespace = parseVfNamespace(name)
		this.text = name || parts[3];		// ???
		break;
	}
}

function parseVfFormula(parts) {
	this.text = parts[3];
	this.group = this.type;
}

function parseConstructor(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = decodeEntities(parts[5] + parts[4]);
}

function parseLineNumberOnly(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
}

function parseVfSerializeViewstate(parts) {
	this.text = this.type;
}

function parseManagedPackage(parts) {
	const rawNs = parts[2],
		lastDot = rawNs.lastIndexOf('.'),
		ns = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);

	this.text = this.namespace = ns;
	this.name = this.type + ': ' + parts[2];
}

function afterManagedPackage(next) {
	this.exitStamp = next.timestamp;
	this.duration = this.netDuration = this.exitStamp - this.timestamp;
}

function parseDmlBegin(parts) {
	this.group = 'DML';
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = 'DML ' + parts[3] + ' ' + parts[4];
	this.rowCount = parseRows(parts[5]);
}

function parseDmlEnd(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
}

function parseSoqlBegin(parts) {
	this.group = 'SOQL';
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = 'SOQL: ' + parts[3] + ' - ' + parts[4];
}

function onSoqlExecuteEnd(end) {
	this.rowCount = end.rowCount;
}

function parseSoqlEnd(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.rowCount = parseRows(parts[3]);
}

function parseExternalEnd(parts) {
	this.text = parts[2];
}

function parseVariable(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = parts[3];
	this.group = this.type;
	this.value = parts[4];
}

function onVariableScopeEnd(end) {
	this.value = end.value;
}

function parseDebug(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = this.type + ':' + parts[3] + ' ' + parts[4];
	this.group = this.type;
}

function parseFormula(parts) {
	const extra = parts.length > 3 ? ' ' + parts[3] : '';

	this.text = parts[2] + extra;
	this.group = this.type;
}

function parseFlow(parts) {
	this.text = parts[3];
	this.group = this.type;
}

function parseFlowStartInterviewLimitUsage(parts) {
	this.text = parts[2];
	this.group = this.type;
}

function parseFlowElementError(parts) {
	this.text = parts[1] + parts[2] + ' ' + parts[3] + ' ' + parts[4];
}

function parseFlowActionCallDetail(parts) {
	this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5] + ' : ' + parts[6];
	this.group = this.type;
}

function parseFlowAssignmentDetail(parts) {
	this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5];
	this.group = this.type;
}

function parseFlowLoopDetail(parts) {
	this.text = parts[3] + ' : ' + parts[4];
	this.group = this.type;
}

function parseFlowRuleDetail(parts) {
	this.text = parts[3] + ' : ' + parts[4];
	this.group = this.type;
}

function parseFlowStartInterviewsBegin(parts) {
	this.group = 'FLOW_START_INTERVIEWS';
	this.text = 'FLOW_START_INTERVIEWS : ' + parts[2];
}

function parseFlowElementBegin(parts) {
	this.group = this.type;
	this.text = this.type + ' - ' + parts[3] + ' ' + parts[4];
}

function parseFlowBulkElementBegin(parts) {
	this.text = this.type + ' - ' + parts[2];
	this.group = this.type;
}

function parseFlowBulkElementDetail(parts) {
	this.text = parts[2] + ' : ' + parts[3] + ' : ' + parts[4];
	this.group = this.type;
}

function parseFlowBulkElementLimitUsage(parts) {
	this.text = parts[2];
	this.group = this.type;
}

function parseFlowElementDeferred(parts) {
	this.text = parts[2] + ' ' + parts[3];
	this.group = this.type;
}

function parseFlowValueAssignment(parts) {
	this.text = parts[3] + ' ' + parts[4];
	this.group = this.type;
}

function parseSavePoint(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = parts[3];
}

function parseNull(parts) {
}

function parseCumulativeLimitUsage(parts) {
	this.text = this.type;
	this.group = this.type;
}

function parseLimitUsage(parts) {
	this.lineNumber = parseLineNumber(parts[2]);
	this.text = parts[3] + ' ' + parts[4] + ' out of ' + parts[5];
	this.group = this.type;
}

function parseLimitUsageForNs(parts) {
	this.text = parts[2];
	this.group = this.type;
}

function afterLimitUsageForNs(next) {
	const cpuText = this.text.match(/Maximum CPU time: (\d+)/)[1],
		cpuTime = parseInt(cpuText, 10) * 1000000;	// convert from milli-seconds to nano-seconds

	if (!cpuUsed || cpuTime > cpuUsed) {
		cpuUsed = cpuTime;
	}
}

function parseTotalEmailRecipientsQueued(parts) {
	this.text = parts[2];
}

function parseStaticVariableList(parts) {
	this.text = '';
}

function parseEventServicePubBegin(parts) {
	this.group = this.type;
	this.text = parts[2];
}

function parseEventServicePubDetail(parts) {
	this.text = parts[2] + ' ' + parts[3] + ' ' + parts[4];
	this.group = this.type;
}

function parseWfCriteria(parts) {
	this.group = 'WF_CRITERIA';
	this.text = 'WF_CRITERIA : ' + parts[5] + ' : ' + parts[3];
}

function parseWfRuleEval(parts) {
	this.text = 'WF_RULE_EVAL';
}

function parseWfRuleFilter(parts) {
	this.text = parts[2];
	this.group = this.type;
}

function parseWfAction(parts) {
	this.text = parts[2];
	this.group = this.type;
}

function parseWfEvalValue(parts) {
	this.text = parts[2];
	this.group = this.type;
}

function parseWfFlowActionError(parts) {
	this.text = parts[1] + ' ' + parts[4];
}

function parseWfFlowActionErrorDetail(parts) {
	this.text = parts[1] + ' ' + parts[2];
}

function parseWfFieldUpdate(parts) {
	this.text = ' ' + parts[2] + ' ' + parts[3] + ' ' + parts[4] + ' ' + parts[5] + ' ' + parts[6];
	this.group = this.type;
}

function parseWfFormula(parts) {
	this.text = parts[2] + ' : ' + parts[3];
	this.group = this.type;
}

function parseException(parts) {
	const text = parts[3];
	if (text.indexOf('System.LimitException') >= 0) {
		truncateLog(this.timestamp, text, 'error');
	}

	this.lineNumber = parseLineNumber(parts[2]);
	this.text = text;
	this.group = this.type;
}

function parseFatal(parts) {
	truncateLog(this.timestamp, 'FATAL ERROR! cause=' + parts[2], 'error');

	this.text = parts[2];
}

const lineMeta = {
	ROOT: {
	},
	CONSTRUCTOR_ENTRY: {
		exitTypes: ['CONSTRUCTOR_EXIT'],
		displayType: 'method',
		hasLineNumber: true,
		cpuType: 'method',
		suffix: ' (constructor)',
		timelineKey: 'method',
		parse: parseConstructor,
		classes: 'node'
	},
	CONSTRUCTOR_EXIT: {
		parse: parseMethodExit
	},
	METHOD_ENTRY: {
		exitTypes: ['METHOD_EXIT'],
		displayType: 'method',
		hasLineNumber: true,
		cpuType: 'method',
		timelineKey: 'method',
		parse: parseMethod,
		classes: 'node'
	},
	METHOD_EXIT: {
		parse: parseMethodExit
	},
	SYSTEM_CONSTRUCTOR_ENTRY: {
		exitTypes: ['SYSTEM_CONSTRUCTOR_EXIT'],
		displayType: 'method',
		hasLineNumber: true,
		cpuType: 'method',
		namespace: 'system',
		suffix: ' (system constructor)',
		timelineKey: 'systemMethod',
		parse: parseSystemMethod,
		classes: 'node system'
	},
	SYSTEM_CONSTRUCTOR_EXIT: {
		parse: parseMethodExit
	},
	SYSTEM_METHOD_ENTRY: {
		exitTypes: ['SYSTEM_METHOD_EXIT'],
		displayType: 'method',
		hasLineNumber: true,
		cpuType: 'method',
		namespace: 'system',
		timelineKey: 'systemMethod',
		parse: parseSystemMethod,
		classes: 'node system'
	},
	SYSTEM_METHOD_EXIT: {
		parse: parseMethodExit
	},
	CODE_UNIT_STARTED: {
		exitTypes: ['CODE_UNIT_FINISHED'],
		displayType: 'method',
		hasLineNumber: false,
		suffix: ' (entrypoint)',
		timelineKey: 'codeUnit',
		parse: parseCodeUnit,
		classes: 'node'
	},
	CODE_UNIT_FINISHED: {
		parse: parseExternalEnd
	},
	VF_APEX_CALL_START: {
		exitTypes: ['VF_APEX_CALL_END'],
		displayType: 'method',
		hasLineNumber: true,
		cpuType: 'method',
		suffix: ' (VF APEX)',
		parse: parseMethod,
		classes: 'node'
	},
	VF_APEX_CALL_END: {
		parse: parseExternalEnd
	},
	VF_EVALUATE_FORMULA_BEGIN: {
		exitTypes: ['VF_EVALUATE_FORMULA_END'],
		cpuType: 'custom',
		suffix: ' (VF FORMULA)',
		parse: parseVfFormula,
		classes: 'node formula'
	},
	VF_EVALUATE_FORMULA_END: {
		parse: parseExternalEnd
	},
	VF_SERIALIZE_VIEWSTATE_BEGIN: {
		exitTypes: ['VF_SERIALIZE_VIEWSTATE_END'],
		displayType: 'method',
		cpuType: 'method',
		namespace: 'system',
		timelineKey: 'systemMethod',
		parse: parseVfSerializeViewstate
	},
	VF_SERIALIZE_VIEWSTATE_END: {
		parse: parseNull,
		text: ''
	},
	DML_BEGIN: {
		exitTypes: ['DML_END'],
		displayType: 'method',
		hasLineNumber: true,
		cpuType: 'free',
		timelineKey: 'dml',
		parse: parseDmlBegin
	},
	DML_END: {
		parse: parseDmlEnd,
		text: ''
	},
	SOQL_EXECUTE_BEGIN: {
		exitTypes: ['SOQL_EXECUTE_END'],
		displayType: 'method',
		hasLineNumber: true,
		cpuType: 'free',
		timelineKey: 'soql',
		parse: parseSoqlBegin,
		onEnd: onSoqlExecuteEnd
	},
	SOQL_EXECUTE_END: {
		parse: parseSoqlEnd,
		text: ''
	},
	HEAP_ALLOCATE: {
		parse: parseLineNumberOnly,
		text: ''
	},
	STATEMENT_EXECUTE: {
		parse: parseLineNumberOnly,
		text: ''
	},
	VARIABLE_SCOPE_BEGIN: {
//		exitTypes: ['VARIABLE_ASSIGNMENT'],
		prefix: 'ASSIGN ',
		parse: parseVariable,
		onEnd: onVariableScopeEnd,
		classes: 'node detail'
	},
	VARIABLE_ASSIGNMENT: {
		parse: parseVariable
	},
	USER_INFO: {
		parse: parseDebug
	},
	USER_DEBUG: {
		parse: parseDebug
	},
	CUMULATIVE_LIMIT_USAGE: {
		exitTypes: ['CUMULATIVE_LIMIT_USAGE_END'],
		displayType: 'method',
		cpuType: 'system',
		timelineKey: 'systemMethod',
		parse: parseCumulativeLimitUsage
	},
	CUMULATIVE_LIMIT_USAGE_END: {
		parse: parseNull,
		text: ''
	},
	LIMIT_USAGE: {			// single limit report
		parse: parseLimitUsage
	},
	LIMIT_USAGE_FOR_NS: {	// should capture following lines!
		parse: parseLimitUsageForNs,
		after: afterLimitUsageForNs,
		acceptsText: true
	},
	TOTAL_EMAIL_RECIPIENTS_QUEUED: {
		parse: parseTotalEmailRecipientsQueued
	},
	STATIC_VARIABLE_LIST: {
		parse: parseStaticVariableList,
		acceptsText: true
	},
	SYSTEM_MODE_ENTER: {
	},
	SYSTEM_MODE_EXIT: {
	},
	EXECUTION_STARTED: {
	},
	EXECUTION_FINISHED: {
	},
	ENTERING_MANAGED_PKG: {
		displayType: 'method',
		cpuType: 'pkg',
		timelineKey: 'method',
		parse: parseManagedPackage,
		after: afterManagedPackage
	},
	EVENT_SERVICE_PUB_BEGIN: {
		exitTypes: ['EVENT_SERVICE_PUB_END'],
		displayType: 'method',
		cpuType: 'custom',
		timelineKey: 'flow',
		parse: parseEventServicePubBegin
	},
	EVENT_SERVICE_PUB_END: {
		parse: parseNull,
		text: ''
	},
	EVENT_SERVICE_PUB_DETAIL: {
		parse: parseEventServicePubDetail
	},
	SAVEPOINT_SET: {
		parse: parseSavePoint
	},
	FLOW_START_INTERVIEWS_BEGIN: {
		exitTypes: ['FLOW_START_INTERVIEWS_END'],
		displayType: 'method',
		cpuType: 'custom',
		declarative: true,
		timelineKey: 'flow',
		parse: parseFlowStartInterviewsBegin
	},
	FLOW_START_INTERVIEWS_END: {
		parse: parseNull,
		text: ''
	},
	FLOW_START_INTERVIEW_BEGIN: {		// don't parse as blocks - unreliable terminator
//		exitTypes: ['FLOW_START_INTERVIEW_END'],
		parse: parseFlow
	},
	FLOW_START_INTERVIEW_END: {
	},
	FLOW_START_INTERVIEW_LIMIT_USAGE: {
		parse: parseFlowStartInterviewLimitUsage
	},
	FLOW_CREATE_INTERVIEW_BEGIN: {
//		exitTypes: ['FLOW_CREATE_INTERVIEW_END'],
		parse: parseNull,
		text: ''
	},
	FLOW_CREATE_INTERVIEW_END: {
	},
	FLOW_ELEMENT_BEGIN: {
		exitTypes: ['FLOW_ELEMENT_END'],
		displayType: 'method',
		cpuType: 'custom',
		declarative: true,
		timelineKey: 'flow',
		parse: parseFlowElementBegin
	},
	FLOW_ELEMENT_END: {
		parse: parseNull,
		text: ''
	},
	FLOW_ELEMENT_DEFERRED: {
		declarative: true,
		parse: parseFlowElementDeferred
	},
	FLOW_VALUE_ASSIGNMENT: {
		declarative: true,
		parse: parseFlowValueAssignment
	},
	FLOW_INTERVIEW_FINISHED: {
		parse: parseFlow
	},
	FLOW_ELEMENT_ERROR: {
		parse: parseFlowElementError
	},
	FLOW_ACTIONCALL_DETAIL: {
		parse: parseFlowActionCallDetail
	},
	FLOW_ASSIGNMENT_DETAIL: {
		parse: parseFlowAssignmentDetail
	},
	FLOW_LOOP_DETAIL: {
		parse: parseFlowLoopDetail
	},
	FLOW_RULE_DETAIL: {
		parse: parseFlowRuleDetail
	},
	FLOW_BULK_ELEMENT_BEGIN: {
		exitTypes: ['FLOW_BULK_ELEMENT_END'],
		displayType: 'method',
		cpuType: 'custom',
		declarative: true,
		timelineKey: 'flow',
		parse: parseFlowBulkElementBegin
	},
	FLOW_BULK_ELEMENT_END: {
		parse: parseNull,
		text: ''
	},
	FLOW_BULK_ELEMENT_DETAIL: {
		declarative: true,
		parse: parseFlowBulkElementDetail
	},
	FLOW_BULK_ELEMENT_LIMIT_USAGE: {
		declarative: true,
		parse: parseFlowBulkElementLimitUsage
	},
	VALIDATION_RULE: {
		parse: parseVfFormula
	},
	VALIDATION_FORMULA: {
		parse: parseFormula,
		acceptsText: true
	},
	VALIDATION_PASS: {
		parse: parseVfFormula
	},
	WF_FLOW_ACTION_BEGIN: {
//		exitTypes: ['WF_FLOW_ACTION_END'],	// don't parse as blocks - they're massively nested
		parse: parseNull,
		text: ''
	},
	WF_FLOW_ACTION_END: {
	},
	WF_FLOW_ACTION_ERROR: {
		parse: parseWfFlowActionError
	},
	WF_FLOW_ACTION_ERROR_DETAIL: {
		parse: parseWfFlowActionErrorDetail
	},
	WF_FIELD_UPDATE: {
		parse: parseWfFieldUpdate
	},
	WF_RULE_EVAL_BEGIN: {
		exitTypes: ['WF_RULE_EVAL_END'],
		displayType: 'method',
		cpuType: 'custom',
		declarative: true,
		timelineKey: 'workflow',
		parse: parseWfRuleEval
	},
	WF_RULE_EVAL_END: {
		parse: parseNull,
		text: ''
	},
	WF_RULE_EVAL_VALUE: {
		parse: parseWfEvalValue
	},
	WF_RULE_FILTER: {
		parse: parseWfRuleFilter,
		acceptsText: true
	},
	WF_RULE_NOT_EVALUATED: {
		parse: parseNull,
		text: ''
	},
	WF_CRITERIA_BEGIN: {
		exitTypes: ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'],
		displayType: 'method',
		cpuType: 'custom',
		declarative: true,
		timelineKey: 'workflow',
		parse: parseWfCriteria
	},
	WF_CRITERIA_END: {
		parse: parseNull,
		text: ''
	},
	WF_FORMULA: {
		parse: parseWfFormula,
		acceptsText: true
	},
	WF_ACTION: {		// don't parse as blocks - unreliable terminator
		parse: parseWfAction
	},
	WF_ACTIONS_END: {
	},
	WF_SPOOL_ACTION_BEGIN: {
		parse: parseNull,
		text: ''
	},
	WF_TIME_TRIGGERS_BEGIN: {
		parse: parseNull,
		text: ''
	},
	EXCEPTION_THROWN: {
		parse: parseException,
		discontinuity: true
	},
	FATAL_ERROR: {
		parse: parseFatal,
		acceptsText: true,
		hideable: false,
		discontinuity: true
	}
};

// annotate meta with derived information
Object.keys(lineMeta).forEach(type => {
	const meta = lineMeta[type];

	meta.type = type;
	if (meta.exitTypes) {
		meta.exitTypes.forEach(exitType => {
			lineMeta[exitType].isExit = true;
		});
	}
});

function parseLine(line, lastEntry) {
	const parts = line.split('|'),
		type = parts[1],
		meta = lineMeta[type];

	if (!meta) {
		if (!typePattern.test(type) && lastEntry && lastEntry.acceptsText) {	// wrapped text from the previous entry?
			lastEntry.text += ' | ' + line;
			return null;
		}
		if (type) {
			console.warn('Unknown log line: ' + type);
		} else {
			if (line.startsWith('*** Skipped')) {
				truncateLog(lastEntry.timestamp, 'Skipped-Lines', 'skip');
			} else if (line.indexOf('MAXIMUM DEBUG LOG SIZE REACHED') >= 0) {
				truncateLog(lastEntry.timestamp, 'Max-Size-reached', 'skip');
			} else {
				console.warn('Bad log line: ' + line);
			}
		}
		return null;
	} else if (!meta.parse) {				// types with no parse are completely ignored
		return null;
	}

	const entry = Object.create(meta);		// construct a new entry with 'meta' for it's prototype
	entry.logLine = line;
	entry.timestamp = parseTimestamp(parts[0]);
	entry.parse(parts);
	if (lastEntry && lastEntry.after) {
		lastEntry.after(entry);
	}
	return entry;
}

export default async function parseLog(log: string) {
	const start = log.indexOf('EXECUTION_STARTED');
	const raw = log.substring(start, log.length);
	let rawLines = raw.split('\n');
	rawLines = rawLines.slice(1, rawLines.length - 1);		// strip the "EXECUTION_STARTED" and "EXECUTION_FINISHED" lines

	// reset global variables to be captured durung parsing
	logLines = [];
	truncated = [];
	reasons = {};
	cpuUsed = undefined;

	let lastEntry;
	let len = rawLines.length;
	for (let i = 0; i < len; ++i) {
		const line = rawLines[i];
		if (line) {		// ignore blank lines
			const entry = parseLine(line, lastEntry);
			if (entry) {
				logLines.push(entry);
				lastEntry = entry;
			}
		}
	}

	totalDuration = logLines.length > 1 ? logLines[logLines.length - 1].timestamp - logLines[0].timestamp : null;

	return logLines;
}

export { logLines, totalDuration, lineMeta, truncated, cpuUsed };
