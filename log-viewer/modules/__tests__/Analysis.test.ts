/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
/*
import analyseMethods from '../Analysis.js';

describe('Analyse methods tests', () => {
	it('Nodes should use group as key', () => {
		const metricList = analyseMethods({
			text: 'ROOT',
			children: [{
				group: 'GroupKey',
				duration: 100,
				netDuration: 50
			}]
		});
		expect(metricList).toEqual([{
			name: 'GroupKey',
			count: 1,
			duration: 100,
			netDuration: 50
		}]);
	});
	it('Key should default to text if no group', () => {
		const metricList = analyseMethods({
			text: 'ROOT',
			children: [{
				text: 'GroupKey',
				duration: 100,
				netDuration: 50
			}]
		});
		expect(metricList).toEqual([{
			name: 'GroupKey',
			count: 1,
			duration: 100,
			netDuration: 50
		}]);
	});
	it('Missing durations should default to 0', () => {
		const metricList = analyseMethods({
			text: 'ROOT',
			children: [{
				group: 'GroupKey'
			}]
		});
		expect(metricList).toEqual([{
			name: 'GroupKey',
			count: 1,
			duration: 0,
			netDuration: 0
		}]);
	});
	it('Durations should accumulate by Key', () => {
		const metricList = analyseMethods({
			text: 'ROOT',
			children: [{
				group: 'Key1',
				duration: 100,
				netDuration: 20
			}, {
				group: 'Key2',
				duration: 1000,
				netDuration: 500
			}, {
				group: 'Key1',
				duration: 200,
				netDuration: 40
			}]
		});
		expect(metricList).toEqual([{
			name: 'Key1',
			count: 2,
			duration: 300,
			netDuration: 60
		}, {
			name: 'Key2',
			count: 1,
			duration: 1000,
			netDuration: 500
		}]);
	});
	it('It should traverse the tree', () => {
		const metricList = analyseMethods({
			text: 'ROOT',
			children: [{
				group: 'Key1',
				duration: 20,
				netDuration: 10,
				children: [{
					group: 'Key2',
					duration: 10,
					netDuration: 5
				}]
			}, {
				group: 'Key3',
				duration: 1000,
				netDuration: 500,
				children: [{
					group: 'Key1',
					duration: 50,
					netDuration: 20
				}]
			}]
		});
		expect(metricList).toEqual([{
			name: 'Key1',
			count: 2,
			duration: 70,
			netDuration: 30
		}, {
			name: 'Key2',
			count: 1,
			duration: 10,
			netDuration: 5
		}, {
			name: 'Key3',
			count: 1,
			duration: 1000,
			netDuration: 500
		}]);
	});
});
*/