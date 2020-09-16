/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import parseLog, {logLines, totalDuration, lineMeta, truncated, cpuUsed} from '../LineParser.js';

const validateNamespace = parseLog.__get__('validateNamespace'),
	parseShortNamespace = parseLog.__get__('parseShortNamespace'),
	parseObjectNamespace = parseLog.__get__('parseObjectNamespace'),
	parseVfNamespace = parseLog.__get__('parseVfNamespace'),
	parseTimestamp = parseLog.__get__('parseTimestamp'),
	parseLineNumber = parseLog.__get__('parseLineNumber'),
	parseRows = parseLog.__get__('parseRows'),
	parseLine = parseLog.__get__('parseLine');

describe('validateNamespace tests', () => {
	it('Should accept known namespaces', () => {
		expect(validateNamespace('c2g')).toEqual('c2g');
		expect(validateNamespace('fferpcore')).toEqual('fferpcore');
		expect(validateNamespace('dlrs')).toEqual('dlrs');
	});
	it('Should identify system namespace', () => {
		expect(validateNamespace('common')).toEqual('system');
		expect(validateNamespace('System')).toEqual('system');
		expect(validateNamespace('Database')).toEqual('system');
		expect(validateNamespace('java__util')).toEqual('system');
	});
	it('Should consider other values unmanaged', () => {
		expect(validateNamespace('xxx')).toEqual('unmanaged');
		expect(validateNamespace('CODAIdentityMap')).toEqual('unmanaged');
		expect(validateNamespace('CODATestHelper')).toEqual('unmanaged');
		expect(validateNamespace('CODAAPIJournalTest_7_0')).toEqual('unmanaged');
	});
});

describe('parseShortNamespace tests', () => {
	it('Should consider no separator to be unmanaged', () => {
		expect(parseShortNamespace('CODAUnitOfWork')).toEqual('unmanaged');
	});
	it('Should consider unknown namespaces to be unmanaged', () => {
		expect(parseShortNamespace('CODAAPIJournalTest_7_0.testBulkCancelJournal()')).toEqual('unmanaged');
	});
	it('Should accept known namespaces', () => {
		expect(parseShortNamespace('c2g.CODAAPIJournalTest_7_0')).toEqual('c2g');
	});
});

describe('parseObjectNamespace tests', () => {
	it('Should consider no separator to be unmanaged', () => {
		expect(parseObjectNamespace('Account')).toEqual('unmanaged');
	});
	it('Should accept properly formatted namespaces', () => {
		expect(parseObjectNamespace('key001__Upsell_Contract__e')).toEqual('key001');
	});
});

describe('parseVfNamespace tests', () => {
	it('Should consider no separator to be unmanaged', () => {
		expect(parseVfNamespace('VF: /apex/CashMatching')).toEqual('unmanaged');
	});
	it('Should consider no slashes to be unmanaged', () => {
		expect(parseVfNamespace('VF: pse__ProjectBilling')).toEqual('unmanaged');
	});
	it('Should consider one slash to be unmanaged', () => {
		expect(parseVfNamespace('VF: /pse__ProjectBilling')).toEqual('unmanaged');
	});
	it('Should accept properly formatted namespaces', () => {
		expect(parseVfNamespace('VF: /apex/pse__ProjectBilling')).toEqual('pse');
	});
});

describe('parseTimestamp tests', () => {
	it('Should parse the timestamp from it\'s section', () => {
		expect(parseTimestamp('22:00:05.0 (59752074)')).toEqual(59752074);
	});
});

describe('parseLineNumber tests', () => {
	it('Should parse the line-number from it\'s section', () => {
		expect(parseLineNumber('[37]')).toEqual(37);
	});
});

describe('parseRows tests', () => {
	it('Should parse the row-count from it\'s section', () => {
		expect(parseRows('Rows:12')).toEqual(12);
	});
});

describe('parseLine tests', () => {
	const line = '15:20:52.222 (6574780)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()';

	it('Should return null if no meta', () => {
		expect(parseLine('09:18:22.6 (6574780)|DUMMY', null)).toEqual(null);
	});
	it('Should return an object with meta as prototype', () => {
		const meta = lineMeta.METHOD_ENTRY,
			node = parseLine(line, null);
		expect(Object.getPrototypeOf(node)).toEqual(meta);
	});
	it('Should return an object with a reference to the source line', () => {
		const node = parseLine(line, null);
		expect(node.logLine).toEqual(line);
	});
	it('Should return an object with a timestamp', () => {
		const node = parseLine(line, null);
		expect(node.timestamp).toEqual(6574780);
	});
});

describe('parseLog tests', () => {
	it('Should parse between EXECUTION_STARTED and EXECUTION_FINISHED and return an iterator', () => {
		const log = '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n' +
			'09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
			'09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
			'09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
			'09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

		parseLog(log);
		expect(logLines.length).toEqual(2);
		expect(logLines[0].type).toEqual('CODE_UNIT_STARTED');
		expect(logLines[1].type).toEqual('CODE_UNIT_FINISHED');
	});
	it('Should handle partial logs', () => {
		const log = '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
			'09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n';

		parseLog(log);

		expect(logLines.length).toBe(1);
		expect(logLines[0].type).toBe('CODE_UNIT_STARTED');
	});
	it('Should detect skipped log entries', () => {
		const log = '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
			'15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'*** Skipped 22606355 bytes of detailed log\n' +
			'15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'09:19:13.82 (2000)|EXECUTION_FINISHED\n';

		parseLog(log);

		expect(truncated.length).toBe(1);
		expect(truncated[0].reason).toBe('Skipped-Lines');
	});
	it('Should detect truncated logs', () => {
		const log = '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
			'15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n';

		parseLog(log);

		expect(truncated.length).toBe(1);
		expect(truncated[0].reason).toBe('Max-Size-reached');
	});
	it('Should detect exceptions', () => {
		const log = '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
			'15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'16:16:04.97 (1000)|EXCEPTION_THROWN|[60]|System.LimitException: c2g:Too many SOQL queries: 101\n' +
			'09:19:13.82 (2000)|EXECUTION_FINISHED\n';

		parseLog(log);

		expect(truncated.length).toBe(1);
		expect(truncated[0].reason).toBe('System.LimitException: c2g:Too many SOQL queries: 101');
	});
	it('Should detect fatal errors', () => {
		const log = '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
			'15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'16:16:04.97 (1000)|FATAL_ERROR|System.LimitException: c2g:Too many SOQL queries: 101\n' +
			'09:19:13.82 (2000)|EXECUTION_FINISHED\n';

		parseLog(log);

		expect(truncated.length).toBe(1);
		expect(truncated[0].reason).toBe('System.LimitException: c2g:Too many SOQL queries: 101');
	});
	it('Should capture totalDuration', () => {
		const log = '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
			'15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'09:19:13.82 (2000)|EXECUTION_FINISHED\n';

		parseLog(log);
		expect(totalDuration).toBe(800);
	});
	it('Methods should have line-numbers', () => {
		const log = '09:18:22.6 (6574780)|EXECUTION_STARTED\n\n' +
			'15:20:52.222 (4113741282)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'15:20:52.222 (4113760256)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
			'09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

		parseLog(log);
		expect(logLines.length).toBe(2);
		expect(logLines[0].lineNumber).toBe(185);
	});
	it('Packages should have a namespace', () => {
		const log = '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
			'11:52:06.13 (151717928)|ENTERING_MANAGED_PKG|appirio_core\n' +
			'09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

		parseLog(log);
		expect(logLines.length).toBe(1);
		expect(logLines[0].namespace).toBe('appirio_core');
	});
	it('Limit Usage for NS provides cpuUsed', () => {
		const log = '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
			'14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE\n' +
			'14:29:44.163 (40163621912)|LIMIT_USAGE_FOR_NS|(default)|\n' +
			'  Number of SOQL queries: 8 out of 100\n' +
			'  Number of query rows: 26 out of 50000\n' +
			'  Number of SOSL queries: 0 out of 20\n' +
			'  Number of DML statements: 8 out of 150\n' +
			'  Number of DML rows: 26 out of 10000\n' +
			'  Maximum CPU time: 4564 out of 10000\n' +
			'  Maximum heap size: 0 out of 6000000\n' +
			'  Number of callouts: 0 out of 100\n' +
			'  Number of Email Invocations: 0 out of 10\n' +
			'  Number of future calls: 0 out of 50\n' +
			'  Number of queueable jobs added to the queue: 0 out of 50\n' +
			'  Number of Mobile Apex push calls: 0 out of 10\n' +
			'14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE_END\n' +
			'09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

		parseLog(log);
		expect(logLines.length).toBe(3);
		expect(logLines[1].type).toBe('LIMIT_USAGE_FOR_NS');
		expect(cpuUsed).toBe(4564000000);
	});
});
