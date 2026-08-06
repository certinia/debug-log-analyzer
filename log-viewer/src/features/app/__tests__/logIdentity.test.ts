/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import { deriveLogIdentity } from '../logIdentity.js';

const USER_INFO_LINE =
  '09:18:22.6 (6297619)|USER_INFO|[EXTERNAL]|005Ea00000R6orz|tina.owen@example.com|(GMT-07:00) Pacific Daylight Time (America/Los_Angeles)|GMT-07:00\n';

/** A minimal parseable transaction around one CODE_UNIT_STARTED line. */
function transaction(codeUnitStarted: string, prefix = USER_INFO_LINE): string {
  return (
    prefix +
    '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
    codeUnitStarted +
    '09:18:22.10 (10000000)|CODE_UNIT_FINISHED|unit\n' +
    '09:18:22.10 (11000000)|EXECUTION_FINISHED\n'
  );
}

function identity(rawLog: string) {
  return deriveLogIdentity(parse(rawLog), rawLog);
}

describe('entry point', () => {
  it('maps anonymous apex to a friendly label, keeping the raw text as the detail', () => {
    const log = transaction(
      '09:18:22.6 (7000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex\n',
    );

    expect(identity(log).entryPoint).toEqual({
      label: 'Anonymous Apex',
      detail: 'execute_anonymous_apex',
    });
  });

  it('shows a VF page by its page name', () => {
    const log = transaction(
      '09:18:22.6 (7000000)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|VF: /apex/SiteLogin\n',
    );

    expect(identity(log).entryPoint?.label).toBe('VF SiteLogin');
  });

  it('shows a trigger by its name, from the "on" form', () => {
    const log = transaction(
      '09:18:22.6 (7000000)|CODE_UNIT_STARTED|[EXTERNAL]|01qd0000000LOhy|MyTrigger on Account trigger event BeforeInsert|__sfdc_trigger/MyTrigger\n',
    );

    expect(identity(log).entryPoint?.label).toBe('Trigger MyTrigger');
  });

  it('shows a trigger by its name, from the raw path form', () => {
    const log = transaction(
      '09:18:22.6 (7000000)|CODE_UNIT_STARTED|[EXTERNAL]|__sfdc_trigger/ns/MyTrigger\n',
    );

    expect(identity(log).entryPoint?.label).toBe('Trigger MyTrigger');
  });

  it('is null when the log has no code unit', () => {
    const log = USER_INFO_LINE + '09:18:22.6 (6574780)|EXECUTION_STARTED\n';

    expect(identity(log).entryPoint).toBeNull();
  });
});

describe('user and start time', () => {
  const anonymous = '09:18:22.6 (7000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex\n';

  it('reads the user from USER_INFO, and puts its timezone on the start time', () => {
    const { user, startTime } = identity(transaction(anonymous));

    expect(user).toEqual({ label: 'tina.owen', detail: 'tina.owen@example.com' });
    expect(startTime?.label).toBe('09:18:22');
    expect(startTime?.detail).toMatch(
      /^Started 09:18:22\S* \(GMT-07:00\) Pacific Daylight Time \(America\/Los_Angeles\)$/,
    );
  });

  it('finds USER_INFO past a preamble longer than any fixed scan window', () => {
    const preamble =
      '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO\n' +
      `Execute Anonymous: ${'x'.repeat(8192)}\n` +
      'Execute Anonymous: quoting |USER_INFO| inside the echo must not match\n';

    const { user } = identity(transaction(anonymous, preamble + USER_INFO_LINE));

    expect(user).toEqual({ label: 'tina.owen', detail: 'tina.owen@example.com' });
  });

  it('omits the user in a cropped log whose first event is not USER_INFO', () => {
    const { user, startTime } = identity(transaction(anonymous, ''));

    expect(user).toBeNull();
    expect(startTime?.detail).toMatch(/^Started 09:18:22\S*$/);
  });

  it('derives nothing from an empty log', () => {
    expect(identity('')).toEqual({ entryPoint: null, user: null, startTime: null });
  });
});
