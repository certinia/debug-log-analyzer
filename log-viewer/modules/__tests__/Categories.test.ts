/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
/*
import analyseCategories from '../Categories.js';

document.body.innerHTML = '<input type="checkbox" id="categoryInternal">';

describe('Analyse categories tests', () => {
	it('The main CPU estimates are determined by line type', () => {
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'method',
				netDuration: 20
			}, {
				cpuType: 'pkg',
				netDuration: 30
			}, {
				cpuType: 'custom',
				netDuration: 50
			}, {
				cpuType: 'free',
				netDuration: 5
			}, {
				cpuType: 'loading',
				netDuration: 80
			}]
		});
		expect(result.cpuEstimate.method).toEqual(20);
		expect(result.cpuEstimate.pkg).toEqual(30);
		expect(result.cpuEstimate.custom).toEqual(50);
		expect(result.cpuEstimate.free).toEqual(5);
		expect(result.cpuEstimate.loading).toEqual(80);
	});
	it('The ff CPU estimate is determined by namespace', () => {
		document.getElementById('categoryInternal').checked = false;
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'method',
				netDuration: 10,
				namespace: 'c2g'		// includes ff namespaces
			}, {
				cpuType: 'method',
				netDuration: 30,
				namespace: 'system'		// includes the system namespace
			}, {
				cpuType: 'method',
				netDuration: 50,
				namespace: 'aaa'
			}]
		});
		expect(result.cpuEstimate.ff).toEqual(40);
	});
	it('The ff CPU estimate includes all namespaces when internal', () => {
		document.getElementById('categoryInternal').checked = true;
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'method',
				netDuration: 10,
				namespace: 'c2g'		// includes ff namespaces
			}, {
				cpuType: 'method',
				netDuration: 30,
				namespace: 'system'		// includes the system namespace
			}, {
				cpuType: 'method',
				netDuration: 50,
				namespace: 'aaa'
			}]
		});
		expect(result.cpuEstimate.ff).toEqual(90);
	});
	it('The declarative CPU estimate collects declarative sub-trees excluding any free time', () => {
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'method',			// included as declarative
				declarative: true,
				netDuration: 10,
				children: [{
					cpuType: 'free',		// excluded as free
					declarative: true,
					netDuration: 100,
					children: [{
						cpuType: 'method',	// included as a child of declarative
						netDuration: 40
					}]
				}]
			}, {
				cpuType: 'method',			// excluded
				netDuration: 60
			}]
		});
		expect(result.cpuEstimate.declarative).toEqual(50);
	});
	it('The customer CPU estimate collects declarative or unknown-namespace sub-trees excluding any free time', () => {
		document.getElementById('categoryInternal').checked = false;
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'method',			// included as unknown namespace
				netDuration: 10,
				namespace: 'aaa',
				children: [{
					cpuType: 'free',		// excluded as free
					netDuration: 100,
					children: [{
						cpuType: 'method',	// included as a child of unknown namespace
						netDuration: 40
					}]
				}]
			}, {
				cpuType: 'method',			// excluded
				netDuration: 60,
				namespace: 'c2g'
			}]
		});
		expect(result.cpuEstimate.customer).toEqual(50);
	});
	it('The customer CPU becomes ff CPU when internal', () => {
		document.getElementById('categoryInternal').checked = true;
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'method',			// included as unknown namespace
				netDuration: 10,
				namespace: 'aaa',
				children: [{
					cpuType: 'free',		// excluded as free
					netDuration: 100,
					children: [{
						cpuType: 'method',	// included as a child of unknown namespace
						netDuration: 40
					}]
				}]
			}, {
				cpuType: 'method',			// excluded from customer but part of ff
				netDuration: 60,
				namespace: 'c2g'
			}]
		});
		expect(result.cpuEstimate.customer).toEqual(0);	// no customer
		expect(result.cpuEstimate.ff).toEqual(110);		// 60 regular ff + 50 customer
	});
	it('cpuByNamespace collects values by namespace', () => {
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'method',
				netDuration: 10,
				namespace: 'c2g'
			}, {
				cpuType: 'method',
				netDuration: 30,
				namespace: 'system'
			}, {
				cpuType: 'method',
				netDuration: 50,
				namespace: 'aaa'
			}]
		});
		expect(result.cpuByNamespace.c2g).toEqual(10);
		expect(result.cpuByNamespace.system).toEqual(30);
		expect(result.cpuByNamespace.aaa).toEqual(50);
	});
	it('pkgCpuByNamespace collects only managed package namespaces', () => {
		const result = analyseCategories({
			text: 'ROOT',
			children: [{
				cpuType: 'pkg',
				netDuration: 10,
				namespace: 'c2g'
			}, {
				cpuType: 'pkg',
				netDuration: 30,
				namespace: 'system'
			}, {
				cpuType: 'method',
				netDuration: 50,
				namespace: 'aaa'
			}]
		});
		expect(result.pkgCpuByNamespace.c2g).toEqual(10);
		expect(result.pkgCpuByNamespace.system).toEqual(30);
		expect(result.pkgCpuByNamespace.aaa).toEqual(undefined);
	});
});
*/