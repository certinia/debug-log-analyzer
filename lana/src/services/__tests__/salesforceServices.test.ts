/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { getLogBody, listLogs } from '../salesforceServices.js';
import { getRuntime, getServicesApi } from '../servicesRuntime.js';

jest.mock('../servicesRuntime.js', () => ({
  getRuntime: jest.fn(),
  getServicesApi: jest.fn(),
}));

const mockRunPromise = jest.fn();
const mockListLogs = jest.fn((limit: number) => ({ limit }));
const mockGetLogBody = jest.fn((id: string) => ({ id }));

beforeEach(() => {
  jest.clearAllMocks();
  (getRuntime as jest.Mock).mockReturnValue({ runPromise: mockRunPromise });
  (getServicesApi as jest.Mock).mockReturnValue({
    services: { ApexLogService: { listLogs: mockListLogs, getLogBody: mockGetLogBody } },
  });
});

describe('listLogs', () => {
  it('forwards the abort signal to the runtime so a dismissal really cancels', () => {
    const signal = new AbortController().signal;

    listLogs(signal);

    expect(mockRunPromise).toHaveBeenCalledWith(expect.anything(), { signal });
  });

  it('asks for the record limit', () => {
    listLogs(undefined, 50);

    expect(mockListLogs).toHaveBeenCalledWith(50);
  });
});

describe('getLogBody', () => {
  it('runs without a signal', () => {
    getLogBody('07L000000000001');

    expect(mockRunPromise).toHaveBeenCalledWith(expect.anything());
  });
});
