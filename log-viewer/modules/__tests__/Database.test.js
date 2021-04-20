/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import analyseDb from '../Database.js';

describe('Analyse database tests', () => {
	it('Only DML and SOQL are collected', () => {
		const result = analyseDb({
			text: 'ROOT',
			children: [{
				type: 'DML_BEGIN',
				text: 'DML Op:Insert Type:codaCompany__c'
			}, {
				type: 'SOQL_EXECUTE_BEGIN',
				text: 'SELECT Id FROM Account'
			}, {
				type: 'METHOD_ENTRY',
				text: 'CODAJournalService.post(List)'
			}]
		});
		expect(result.dmlMap).toEqual({
			'DML Op:Insert Type:codaCompany__c': {
				count: 1,
				rowCount: 0
			}
		});
		expect(result.soqlMap).toEqual({
			'SELECT Id FROM Account': {
				count: 1,
				rowCount: 0
			}
		});
	});
	it('Aggregation traverses method trees', () => {
		const result = analyseDb({
			text: 'ROOT',
			children: [{
				type: 'DML_BEGIN',
				displayType: 'method',
				text: 'DML Op:Insert Type:codaCompany__c',
				children: [{
					type: 'SOQL_EXECUTE_BEGIN',
					text: 'SELECT Id FROM Account'
				}]
			}, {
				type: 'SOQL_EXECUTE_BEGIN',
				text: 'SELECT Id FROM Account',
				rowCount: 5
			}, {
				type: 'DML_BEGIN',
				text: 'DML Op:Insert Type:codaCompany__c',
				rowCount: 10
			}]
		});
		expect(result.dmlMap).toEqual({
			'DML Op:Insert Type:codaCompany__c': {
				count: 2,
				rowCount: 10
			}
		});
		expect(result.soqlMap).toEqual({
			'SELECT Id FROM Account': {
				count: 2,
				rowCount: 5
			}
		});
	});
});
