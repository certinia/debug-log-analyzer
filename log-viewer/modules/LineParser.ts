/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import {decodeEntities} from './Browser.js';

const 
	typePattern = /^[A-Z_]*$/,
	truncateColor: Map<string, string> = new Map([
		['error', 'rgba(255, 128, 128, 0.2)'],
		['skip', 'rgba(128, 255, 128, 0.2)'],
		['unexpected', 'rgba(128, 128, 255, 0.2)']
	]);

abstract class LogLine {
	type: string = ''
}


let logLines: LogLine[],
	totalDuration: number,
	truncated: [string, number, string | undefined][],
	reasons: Set<string>,
	cpuUsed: number

export function truncateLog(timestamp: number, reason: string, color: string) {
	if (!reasons.has(reason)) {
		reasons.add(reason)
		truncated.push([
			reason,
			timestamp,
			truncateColor.get(color)
		]);
	}
}

function parseObjectNamespace(text: string): string {
	const sep = text.indexOf('__');
	if (sep < 0) {
		return 'unmanaged';
	}
	return text.substring(0, sep);
}

function parseVfNamespace(text: string): string {
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

function parseTimestamp(text: string): number {
	const timestamp = text.match(/.*\((\d+)\)/);
	if (timestamp && timestamp.length>1)
		return Number(timestamp[1]);
	throw new Error(`Unable to parse timestamp: '${text}'`)	
}

function parseLineNumber(text: string): string | number {
	const matched = text.match(/\[(\w*)\]/)
	if (matched) {
		const lineNumber = Number(matched[1])
		if (isNaN(lineNumber))
			return lineNumber
		else
			return matched[1];	
	}
	throw new Error(`Unable to parse line number: '${text}'`)	
}

function parseRows(text: string): number {
	const rowCount = text.match(/Rows:(\d+)/);
	if (rowCount && rowCount.length>1)
		return Number(rowCount[1]);
	throw new Error(`Unable to parse row count: '${text}'`)	
}

/* Log line entry Parsers */

type lineNumber = number | string | undefined;

class ConstructorEntryLine extends LogLine {
	exitTypes = ['CONSTRUCTOR_EXIT']
	displayType = 'method'
	hasLineNumber = true
	cpuType = 'method'
	suffix = ' (constructor)'
	timelineKey = 'method'
	classes = 'node'
	lineNumber: lineNumber
	text: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = decodeEntities(parts[5] + parts[4]);
	}
}
class ConstructorExitLine extends LogLine {
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}

class MethodEntryLine extends LogLine {
	exitTypes = ['METHOD_EXIT']
	displayType =  'method'
	hasLineNumber = true
	cpuType = 'method'
	timelineKey = 'method'
	classes =  'node'
	lineNumber: lineNumber
	text: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = decodeEntities(parts[4]) || this.type;
		if (this.text === 'System.Type.forName(String, String)') {
			this.cpuType = 'loading';		// assume we are not charged for class loading (or at least not lengthy remote-loading / compiling)
			// no namespace or it will get charged...
		}
	}
}

class MethodExitLine extends LogLine {
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}

class SystemConstructorEntryLine extends LogLine {
	exitTypes =  ['SYSTEM_CONSTRUCTOR_EXIT']
	displayType = 'method'
	hasLineNumber = true
	cpuType = 'method'
	namespace = 'system'
	suffix = '(system constructor)'
	timelineKey = 'systemMethod'
	classes = 'node system'
	lineNumber: lineNumber
	text: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = decodeEntities(parts[3]);
	}
}
class SystemConstructorExitLine extends LogLine {
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}
class SystemMethodEntryLine extends LogLine {
	exitTypes = ['SYSTEM_METHOD_EXIT']
	displayType = 'method'
	hasLineNumber = true
	cpuType = 'method'
	namespace = 'system'
	timelineKey = 'systemMethod'
	classes = 'node system'
	lineNumber: lineNumber
	text: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = decodeEntities(parts[3]);
	}
}

class SystemMethodExitLine extends LogLine {
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}

class CodeUnitStartedLine extends LogLine {
	exitTypes = ['CODE_UNIT_FINISHED']
	displayType = 'method'
	hasLineNumber = false
	suffix = ' (entrypoint)'
	timelineKey = 'codeUnit'
	classes = 'node'
	cpuType: string
	namespace: string | undefined
	group: string | undefined
	text: string
	declarative: boolean | undefined

	constructor(parts: string[]) {
		super();
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
}
class CodeUnitFinsihedLine extends LogLine {
	text: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
	}
}

class VFApexCallStartLine extends LogLine {
	exitTypes = ['VF_APEX_CALL_END']
	displayType = 'method'
	hasLineNumber = true
	cpuType = 'method'
	suffix = ' (VF APEX)'
	classes = 'node'
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}

class VFApexCallEndLine extends LogLine {
	text: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
	}
}

class VFFormulaStartLine extends LogLine {
	exitTypes = ['VF_EVALUATE_FORMULA_END']
	cpuType = 'custom'
	suffix = ' (VF FORMULA)'
	classes = 'node formula'
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3];
		this.group = this.type;
	}
}

class VFFormulaEndLine extends LogLine {
	text: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
	}
}

class VFSeralizeViewStateStartLine extends LogLine {
	exitTypes= ['VF_SERIALIZE_VIEWSTATE_END']
	displayType = 'method'
	cpuType = 'method'
	namespace = 'system'
	timelineKey= 'systemMethod'
	text: string

	constructor(parts: string[]) {
		super();
		this.text = this.type;
	}
}

class VFSeralizeViewStateEndLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
	}
}

class DMLBeginLine extends LogLine {
	exitTypes = ['DML_END']
	displayType = 'method'
	hasLineNumber = true
	cpuType = 'free'
	timelineKey = 'dml'
	group = 'DML'
	text: string
	lineNumber: lineNumber
	rowCount: number

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = 'DML ' + parts[3] + ' ' + parts[4];
		this.rowCount = parseRows(parts[5]);
	}
}

class DMLEndLine extends LogLine {
	text = ''
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}

interface EndLine {
	rowCount: number
}

class SOQLExecuteBeginLine extends LogLine {
	exitTypes = ['SOQL_EXECUTE_END']
	displayType = 'method'
	hasLineNumber = true
	cpuType = 'free'
	timelineKey = 'soql'
	group: string
	lineNumber: lineNumber
	text: string
	rowCount: number | undefined

	constructor(parts: string[]) {
		super();
		this.group = 'SOQL';
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = 'SOQL: ' + parts[3] + ' - ' + parts[4];
	}

	onEnd(end: EndLine) {
		this.rowCount = end.rowCount;
	}
}

class SOQLExecuteEndLine extends LogLine {
	text = ''
	lineNumber: lineNumber
	rowCount: number

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.rowCount = parseRows(parts[3]);
	}
}

class HeapAllocateLine extends LogLine {
	text = ''
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}

class StatementExecuteLine extends LogLine {
	text = ''
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
	}
}

class VariableScopeBeginLine extends LogLine {
	prefix = 'ASSIGN '
	classes = 'node detail'
	lineNumber: lineNumber
	text: string
	group: string
	value: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = parts[3];
		this.group = this.type;
		this.value = parts[4];
	}

	onEnd(end: any) {
		this.value = end.value;
	}
}

class VariableAssignmentLine extends LogLine {
	lineNumber: lineNumber
	text: string
	group: string
	value: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = parts[3];
		this.group = this.type;
		this.value = parts[4];
	}
}
class UserInfoLine extends LogLine {
	lineNumber: lineNumber
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = this.type + ':' + parts[3] + ' ' + parts[4];
		this.group = this.type;
	}
}

class UserDebugLine extends LogLine {
	lineNumber: lineNumber
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = this.type + ':' + parts[3] + ' ' + parts[4];
		this.group = this.type;
	}
}

class CumulativeLimitUsageLine extends LogLine {
	exitTypes = ['CUMULATIVE_LIMIT_USAGE_END']
	displayType = 'method'
	cpuType = 'system'
	timelineKey = 'systemMethod'
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = this.type;
		this.group = this.type;
	}
}

class CumulativeLimitUsageEndLine extends LogLine {
	constructor(parts: string[]) {
		super();
	}
}

class LimitUsageLine extends LogLine {
	lineNumber: lineNumber
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = parts[3] + ' ' + parts[4] + ' out of ' + parts[5];
		this.group = this.type;
	
	}
}

class LimitUsageForNSLine extends LogLine {
	acceptsText = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
		this.group = this.type;
	}

	afterLimitUsageForNs(next: any) {
		const matched = this.text.match(/Maximum CPU time: (\d+)/),
			cpuText = matched ? matched[1] : '0',
			cpuTime = parseInt(cpuText, 10) * 1000000;	// convert from milli-seconds to nano-seconds
	
		if (!cpuUsed || cpuTime > cpuUsed) {
			cpuUsed = cpuTime;
		}
	}
}

class TotalEmailRecipientsQueuedLine extends LogLine {
	text: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
	}
}

class StaticVariableListLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
	}
}

class SystemModeEnterLine extends LogLine {}
class SystemModeExitLine extends LogLine {}
class ExecutionStartedLine extends LogLine {}
class ExecutionFinishedLine extends LogLine {}

class EnteringManagedPackageLine extends LogLine {
	displayType = 'method'
	cpuType = 'pkg'
	timelineKey = 'method'
	text: string
	name: string
	namespace: string
	exitStamp: any
	duration: any
	netDuration: any
	timestamp: any

	constructor(parts: string[]) {
		super();
		const rawNs = parts[2],
		lastDot = rawNs.lastIndexOf('.'),
		ns = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);

	this.text = this.namespace = ns;
	this.name = this.type + ': ' + parts[2];

	}

	after(next: any) {
		this.exitStamp = next.timestamp;
		this.duration = this.netDuration = this.exitStamp - this.timestamp;
	}
}

class EventSericePubBeginLine extends LogLine {
	exitTypes = ['EVENT_SERVICE_PUB_END']
	displayType = 'method'
	cpuType = 'custom'
	timelineKey = 'flow'
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.group = this.type;
		this.text = parts[2];
	
	}
}

class EventSericePubEndLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
	}
}

class EventSericePubDetailLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2] + ' ' + parts[3] + ' ' + parts[4];
		this.group = this.type;
	}
}

class SavePointSetLine extends LogLine {
	text: string
	lineNumber: lineNumber

	constructor(parts: string[]) {
		super();
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = parts[3];
	}
}

class FlowStartInterviewsBeginLine extends LogLine {
	exitTypes = ['FLOW_START_INTERVIEWS_END']
	displayType = 'method'
	cpuType = 'custom'
	declarative = true
	timelineKey = 'flow'
	group = 'FLOW_START_INTERVIEWS'
	text: string

	constructor(parts: string[]) {
		super();
		this.text = 'FLOW_START_INTERVIEWS : ' + parts[2];
	}
}

class FlowStartInterviewsEndLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
	}
}

class FlowStartInterviewBeginLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3];
		this.group = this.type;
	}
}

class FlowStartInterviewEndLine extends LogLine {
	constructor(parts: string[]) {
		super();
	}
}

class FlowStartInterviewLimitUsageLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
		this.group = this.type;
	}
}

class FlowCreateInterviewBeginLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
	}
}

class FlowCreateInterviewEndLine extends LogLine {
	constructor(parts: string[]) {
		super();
	}
}

class FlowElementBeginLine extends LogLine {
	exitTypes = ['FLOW_ELEMENT_END']
	displayType = 'method'
	cpuType = 'custom'
	declarative =  true
	timelineKey = 'flow'
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.group = this.type;
		this.text = this.type + ' - ' + parts[3] + ' ' + parts[4];
	}
}

class FlowElementEndLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
	}
}

class FlowElementDeferredLine extends LogLine {
	declarative = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2] + ' ' + parts[3];
		this.group = this.type;
	}
}

class FlowElementAssignmentLine extends LogLine {
	declarative = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3] + ' ' + parts[4];
		this.group = this.type;
	}
}

class FlowInterviewFinishedLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3];
		this.group = this.type;
		}
}

class FlowElementErrorLine extends LogLine {
	text: string

	constructor(parts: string[]) {
		super();
		this.text = parts[1] + parts[2] + ' ' + parts[3] + ' ' + parts[4];
		}
}

class FlowActionCallDetailLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5] + ' : ' + parts[6];
		this.group = this.type;
		}
}

class FlowAssignmentDetailLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5];
		this.group = this.type;
			}
}

class FlowLoopDetailLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3] + ' : ' + parts[4];
		this.group = this.type;
				}
}

class FlowRuleDetailLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3] + ' : ' + parts[4];
		this.group = this.type;
					}
}

class FlowBulkElementBeginLine extends LogLine {
	exitTypes = ['FLOW_BULK_ELEMENT_END']
	displayType = 'method'
	cpuType = 'custom'
	declarative = true
	timelineKey = 'flow'

	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = this.type + ' - ' + parts[2];
		this.group = this.type;
						}
}

class FlowBulkElementEndLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
	}
}

class FlowBulkElementDetailLine extends LogLine {
	declarative = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2] + ' : ' + parts[3] + ' : ' + parts[4];
		this.group = this.type;
	}
}

class FlowBulkElementLimitUsage extends LogLine {
	declarative = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
		this.group = this.type;
	}
}

class ValidationRuleLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3];
		this.group = this.type;
	}
}

class ValidationFormulaLine extends LogLine {
	acceptsText = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		const extra = parts.length > 3 ? ' ' + parts[3] : '';

		this.text = parts[2] + extra;
		this.group = this.type;
	}
}

class ValidationPassLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[3];
		this.group = this.type;

	}
}

class WFFlowActionBeginLine extends LogLine {
	text = ''
}

class WFFlowActionEndLine extends LogLine {
}

class WFFlowActionErrorLine extends LogLine {
	text: string

	constructor(parts: string[]) {
		super();
		this.text = parts[1] + ' ' + parts[4];
	}	
}

class WFFlowActionErrorDetailLine extends LogLine {
	text: string

	constructor(parts: string[]) {
		super();
		this.text = parts[1] + ' ' + parts[2];
	}	
}

class WFFieldUpdateLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = ' ' + parts[2] + ' ' + parts[3] + ' ' + parts[4] + ' ' + parts[5] + ' ' + parts[6];
		this.group = this.type;
	}	
}

class WFRuleEvalBeginLine extends LogLine {
	exitTypes = ['WF_RULE_EVAL_END']
	displayType = 'method'
	cpuType = 'custom'
	declarative = true
	timelineKey = 'workflow'
	text = 'WF_RULE_EVAL';

	constructor(parts: string[]) {
		super();
	}	
}

class WFRuleEvalEndLine extends LogLine {
	text = ''

	constructor(parts: string[]) {
		super();
	}	
}

class WFRuleEvalValueLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
		this.group = this.type;
	}	
}

class WFRuleFilterLine extends LogLine {
	acceptsText = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
		this.group = this.type;
	}	
}

class WFRuleNotEvaluatedLine extends LogLine {
	text = ''
}

class WFCriteriaBeginLine extends LogLine {
	exitTypes = ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED']
	displayType = 'method'
	cpuType ='custom'
	declarative = true
	timelineKey = 'workflow'
	group = 'WF_CRITERIA'
	text: string

	constructor(parts: string[]) {
		super();
		this.text = 'WF_CRITERIA : ' + parts[5] + ' : ' + parts[3];
	}
}

class WFCriteriaEndLine extends LogLine {
	text = ''
}

class WFFormulaLine extends LogLine {
	acceptsText = true
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2] + ' : ' + parts[3];
		this.group = this.type;
	
	}
}

class WFActionLine extends LogLine {
	text: string
	group: string

	constructor(parts: string[]) {
		super();
		this.text = parts[2];
		this.group = this.type;
	}
}

class WFActionsEndLine extends LogLine {
}

class WFSpoolActionBeginLine extends LogLine {
	text = ''
}

class WFTimeTriggersBeginLine extends LogLine {
	text = ''
}

class ExceptionThrownLine extends LogLine {
	discontinuity = true
	lineNumber: lineNumber
	text: string
	group: string
	timestamp: any

	constructor(parts: string[]) {
		super();
	const text = parts[3];
	if (text.indexOf('System.LimitException') >= 0) {
		truncateLog(this.timestamp, text, 'error');
	}

	this.lineNumber = parseLineNumber(parts[2]);
	this.text = text;
	this.group = this.type;
	}

}

class FatalErrorLine extends LogLine {
	acceptsText = true
	hideable = false
	discontinuity = true

	lineNumber: lineNumber
	text: string
	timestamp: any

	constructor(parts: string[]) {
		super();
		truncateLog(this.timestamp, 'FATAL ERROR! cause=' + parts[2], 'error');

		this.text = parts[2];
	}

}

const lineTypeMap = new Map<string, new (parts: string[]) => LogLine>(
	[
		["FATAL_ERROR", FatalErrorLine]
	]
)

const lineMeta = {
	ROOT: {
	},
	/*
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
	*/		
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
