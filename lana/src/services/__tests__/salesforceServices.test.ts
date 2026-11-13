/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import * as Effect from 'effect/Effect';
import * as SubscriptionRef from 'effect/SubscriptionRef';

import { getLogBody, getTargetOrg, listLogs } from '../salesforceServices.js';
import { getRuntime, getServicesApi } from '../servicesRuntime.js';

jest.mock('../servicesRuntime.js', () => ({
  getRuntime: jest.fn(),
  getServicesApi: jest.fn(),
}));

const mockRunPromise = jest.fn();
const log = (Id: string) => ({ Id, LogLength: 1, StartTime: '', Status: 'Success' });
const mockListLogs = jest.fn(
  (_limit?: number): Effect.Effect<ReturnType<typeof log>[], { _tag: string }> =>
    Effect.succeed([]),
);
const mockGetLogBody = jest.fn((id: string) => ({ id }));

beforeEach(() => {
  (getRuntime as jest.Mock).mockReturnValue({ runPromise: mockRunPromise });
  (getServicesApi as jest.Mock).mockReturnValue({
    services: { ApexLogService: { listLogs: mockListLogs, getLogBody: mockGetLogBody } },
  });
});

describe('listLogs', () => {
  it('forwards the abort signal to the runtime so a dismissal really cancels', () => {
    const signal = new AbortController().signal;

    void listLogs(signal);

    expect(mockRunPromise).toHaveBeenCalledWith(expect.anything(), { signal });
  });

  it('asks for the record limit', () => {
    void listLogs(undefined, 50);

    expect(mockListLogs).toHaveBeenCalledWith(50);
  });

  it('returns the newest logs up to the limit from a Services that takes no limit', async () => {
    mockRunPromise.mockImplementationOnce(Effect.runPromise);
    mockListLogs.mockImplementation((limit) =>
      limit === undefined
        ? Effect.succeed([log('07L3'), log('07L2'), log('07L1')])
        : Effect.fail({ _tag: 'ParseError' }),
    );

    await expect(listLogs(undefined, 2)).resolves.toEqual([log('07L3'), log('07L2')]);
  });

  it('does not ask again when the org refuses the query', async () => {
    mockRunPromise.mockImplementationOnce(Effect.runPromise);
    mockListLogs.mockImplementationOnce(() => Effect.fail({ _tag: 'ApexLogQueryError' }));

    await expect(listLogs()).rejects.toThrow();
    expect(mockListLogs).toHaveBeenCalledTimes(1);
  });
});

describe('getLogBody', () => {
  it('runs without a signal', () => {
    void getLogBody('07L000000000001');

    expect(mockRunPromise).toHaveBeenCalledWith(expect.anything());
  });
});

describe('getTargetOrg', () => {
  it('reads the current value of the default org ref', async () => {
    (getRuntime as jest.Mock).mockReturnValue({ runPromise: Effect.runPromise });
    (getServicesApi as jest.Mock).mockReturnValue({
      services: {
        TargetOrgRef: () => SubscriptionRef.make({ orgId: '00D000000000001', alias: 'myorg' }),
      },
    });

    await expect(getTargetOrg()).resolves.toEqual({ orgId: '00D000000000001', alias: 'myorg' });
  });
});
