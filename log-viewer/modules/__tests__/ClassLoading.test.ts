/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
/*
describe('Detect Class-Loading tests', () => {
	beforeEach(() => {
		jest.resetModules();
	});

	it('Should detect gaps before class constructors', () => {
		jest.mock('../LineParser', () => ({
			logLines: [{
				type: 'dummy',
				timestamp: 0
			}, {
				type: 'METHOD_ENTRY',
				timestamp: 2000000,
				text: 'CODATestHelper.CODATestHelper()'
			}]
		}));
		const {detectClassLoading} = require('../ClassLoading.js');
		const classList = detectClassLoading();

		expect(classList).toContainEqual({
			name: 'CODATestHelper',
			loadTime: 2000000,
			duplicate: false
		});
	});
	it('Should detect duplicate entries', () => {
		jest.mock('../LineParser', () => ({
			logLines: [{
				type: 'dummy',
				timestamp: 0
			}, {
				type: 'METHOD_ENTRY',
				timestamp: 2000000,
				text: 'CODATestHelper.CODATestHelper()'
			}, {
				type: 'METHOD_ENTRY',
				timestamp: 4000000,
				text: 'CODATestHelper.CODATestHelper()'
			}]
		}));
		const {detectClassLoading} = require('../ClassLoading.js');
		const classList = detectClassLoading();

		expect(classList).toContainEqual({
			name: 'CODATestHelper',
			loadTime: 2000000,
			duplicate: true
		});
	});
	it('Should detect gaps during Type.forName', () => {
		jest.mock('../LineParser', () => ({
			logLines: [{
				type: 'dummy',
				timestamp: 0,
				cpuType: 'loading'
			}, {
				type: 'METHOD_EXIT',
				timestamp: 3000000
			}]
		}));
		const {detectClassLoading} = require('../ClassLoading.js');
		const classList = detectClassLoading();

		expect(classList).toContainEqual({
			name: '<System.Type.forName>',
			loadTime: 3000000
		});
	});
});
*/