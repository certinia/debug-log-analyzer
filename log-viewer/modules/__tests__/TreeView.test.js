/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import parseLog, {truncated} from '../LineParser.js';
import renderTreeView, {getRootMethod} from '../TreeView.js';

const LineIterator = renderTreeView.__get__('LineIterator'),
	addBlock = renderTreeView.__get__('addBlock'),
	endMethod = renderTreeView.__get__('endMethod'),
	getMethod = renderTreeView.__get__('getMethod');

describe('LineIterator tests', () => {
	it('Should return null when there are no more lines', () => {
		const iter = new LineIterator([]);
		expect(iter.fetch()).toEqual(null);
	});
	it('Should not move to the next line when calling peek', () => {
		const iter = new LineIterator([1]);
		expect(iter.peek()).toEqual(1);
		expect(iter.fetch()).toEqual(1);
	});
	it('Should return the lines in sequence', () => {
		const iter = new LineIterator([1, 2, 3]);
		expect(iter.fetch()).toEqual(1);
		expect(iter.fetch()).toEqual(2);
		expect(iter.fetch()).toEqual(3);
		expect(iter.fetch()).toEqual(null);
	});
});

describe('addBlock tests', () => {
	it('Should return an empty array', () => {
		expect(addBlock([], [])).toEqual([]);
	});
	it('Should ignore an empty lines list', () => {
		const children = [];

		addBlock(children, []);
		expect(children).toEqual([]);
	});
	it('Should wrap lines in a block and append to children', () => {
		const children = [];

		addBlock(children, [1]);
		expect(children).toEqual([{
			displayType: 'block',
			children: [1]
		}]);
	});
});

describe('endMethod tests', () => {
	beforeEach(() => {
		parseLog('');
	});

	it('Should set the method\'s exitStamp', () => {
		const method = {
				exitTypes: []
			},
			line = {
				timestamp: 500
			};

		endMethod(method, line, null);
		expect(method.exitStamp).toEqual(500);
	});
	it('Should call the method\'s onEnd method', () => {
		const method = {
				exitTypes: [],
				onEnd: jest.fn()
			},
			line = {
				timestamp: 500
			};

		endMethod(method, line, null);
		expect(method.onEnd.mock.calls.length).toEqual(1);
	});
	it('Should fetch the next line and clear discontinuity on exit', () => {
		const method = {
				exitTypes: ['EXIT'],
				onEnd: jest.fn()
			},
			line = {
				type: 'EXIT',
				timestamp: 500
			},
			iter = {
				fetch: jest.fn()
			};

		renderTreeView.__set__('discontinuity', true);
		endMethod(method, line, iter);
		expect(iter.fetch.mock.calls.length).toEqual(1);
		expect(renderTreeView.__get__('discontinuity')).toEqual(false);
	});
	it('Should not fetch the next line or clear discontinuity if not exit', () => {
		const method = {
				exitTypes: ['EXIT'],
				onEnd: jest.fn()
			},
			line = {
				timestamp: 500
			},
			iter = {
				fetch: jest.fn()
			};
//			truncateLog = jest.fn();

		renderTreeView.__set__('discontinuity', true);
//		renderTreeView.__set__('truncateLog', truncateLog);
		endMethod(method, line, iter);
		expect(iter.fetch.mock.calls.length).toEqual(0);
		expect(renderTreeView.__get__('discontinuity')).toEqual(true);
//		expect(truncateLog.mock.calls.length).toEqual(1);
	});
});

describe('getMethod tests', () => {
	it('Should end at an exit line', () => {
		const lineIter = new LineIterator([{
				isExit: true,
				type: 'METHOD_EXIT',
				timestamp: 1000
			}]);

		const method = getMethod(lineIter, {
			exitTypes: ['METHOD_EXIT'],
			timestamp: 200
		});
		expect(truncated.length).toBe(0);
		expect(method.children).toEqual([]);
		expect(method.exitStamp).toEqual(1000);
		expect(method.duration).toEqual(800);
		expect(method.netDuration).toEqual(800);
	});
	it('Should collect method children directly', () => {
		const lineIter = new LineIterator([{
				type: 'METHOD_ENTRY',
				displayType: 'method',
				exitTypes: ['METHOD_EXIT'],
				timestamp: 500
			}, {
				isExit: true,
				type: 'METHOD_EXIT',
				timestamp: 600
			}, {
				isExit: true,
				type: 'METHOD_EXIT',
				timestamp: 1000
			}]);

		const method = getMethod(lineIter, {
			exitTypes: ['METHOD_EXIT'],
			timestamp: 200
		});
		expect(truncated.length).toBe(0);
		expect(method.children.length).toEqual(1);
		expect(method.children[0].type).toEqual('METHOD_ENTRY');
		expect(method.exitStamp).toEqual(1000);
		expect(method.duration).toEqual(800);
		expect(method.netDuration).toEqual(700);
	});
	it('Should collect detail children in blocks', () => {
		const lineIter = new LineIterator([{
				type: 'WF_FIELD_UPDATE',
				timestamp: 500
			}, {
				isExit: true,
				type: 'METHOD_EXIT',
				timestamp: 1000
			}]);

		const method = getMethod(lineIter, {
			exitTypes: ['METHOD_EXIT'],
			timestamp: 200
		});
		expect(truncated.length).toBe(0);
		expect(method.children.length).toEqual(1);
		expect(method.children[0].displayType).toEqual('block');
		expect(method.children[0].children[0].type).toEqual('WF_FIELD_UPDATE');
		expect(method.exitStamp).toEqual(1000);
		expect(method.duration).toEqual(800);
		expect(method.netDuration).toEqual(800);
	});
	it('Should detect truncated methods', () => {
		const lineIter = new LineIterator([]);

		const method = getMethod(lineIter, {
			exitTypes: ['METHOD_EXIT'],
			timestamp: 200
		});
		expect(truncated.length).toBe(1);
		expect(truncated[0].reason).toEqual('Unexpected-End');
		expect(method).not.toBe(null);
	});
});

describe('Tree Parsing tests', () => {
	it('Methods can have children', () => {
		const log = '09:18:22.6 (6574780)|EXECUTION_STARTED\n\n' +
			'14:12:52.7 (2945758236)|METHOD_ENTRY|[67]|01p4J00000FpRg6|fflib_Type.forName(String)\n' +
			'14:12:52.7 (2945765735)|METHOD_ENTRY|[50]|01p4J00000FpRg6|fflib_Type.normaliseQualifiedName(String)\n' +
			'14:12:52.7 (2945800815)|METHOD_EXIT|[50]|01p4J00000FpRg6|fflib_Type.normaliseQualifiedName(String)\n' +
			'14:12:52.7 (2945824408)|METHOD_EXIT|[67]|01p4J00000FpRg6|fflib_Type.forName(String)\n' +
			'09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

		parseLog(log);
		const rootMethod = getRootMethod();
		expect(rootMethod.type).toBe('ROOT');
		const method = rootMethod.children[0];
		expect(method.type).toBe('METHOD_ENTRY');
		expect(method.children.length).toBe(1);
		expect(method.children[0].type).toBe('METHOD_ENTRY');
	});
	it('Details are contained in blocks', () => {
		const log = '09:18:22.6 (6574780)|EXECUTION_STARTED\n\n' +
			'14:12:52.7 (2945758236)|METHOD_ENTRY|[67]|01p4J00000FpRg6|fflib_Type.forName(String)\n' +
			'09:18:47.875 (26067703682)|WF_FIELD_UPDATE|[Timecard Split: TC-10-10-2019-405682 a3y1D0000000lLO]|Field:Timecard Split: Exclude from Billing|Value:true|Id=04Yd00000001G9J|CurrentRule:PsaTimecardSplit_BillableAmout_Zero (Id=01Qd0000000Ayq4)\n' +
			'14:12:52.7 (2945824408)|METHOD_EXIT|[67]|01p4J00000FpRg6|fflib_Type.forName(String)\n' +
			'09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

		parseLog(log);
		const rootMethod = getRootMethod();
		expect(rootMethod.type).toBe('ROOT');
		expect(rootMethod.children.length).toBe(1);
		const method = rootMethod.children[0];
		expect(method.type).toBe('METHOD_ENTRY');
		expect(method.children.length).toBe(1);
		const block = method.children[0];
		expect(block.displayType).toBe('block');
		expect(block.children.length).toBe(1);
		const detail = block.children[0];
		expect(detail.type).toBe('WF_FIELD_UPDATE');
		expect(detail.children).toBe(undefined);
	});
});
