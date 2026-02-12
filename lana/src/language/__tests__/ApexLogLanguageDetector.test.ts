/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { createMockTextDocument } from '../../__tests__/mocks/vscode.js';
import { isApexLogContent } from '../ApexLogLanguageDetector.js';

describe('isApexLogContent', () => {
  it('should detect standard log with settings header on line 1', () => {
    const doc = createMockTextDocument({
      lines: [
        '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,NONE;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,NONE',
        '09:45:31.888 (1000)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log with preamble text before settings header', () => {
    const doc = createMockTextDocument({
      lines: [
        'Some preamble text from browser UI',
        'Another line of preamble',
        '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO',
        '09:45:31.888 (1000)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log without settings header but with EXECUTION_STARTED', () => {
    const doc = createMockTextDocument({
      lines: [
        'Some preamble text',
        '09:45:31.888 (1000)|EXECUTION_STARTED',
        '09:45:31.889 (2000)|USER_INFO|[EXTERNAL]|user@example.com',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log without settings header but with USER_INFO', () => {
    const doc = createMockTextDocument({
      lines: ['Some preamble text', '09:45:31.889 (2000)|USER_INFO|[EXTERNAL]|user@example.com'],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect real-world log starting with USER_INFO and no settings header', () => {
    const doc = createMockTextDocument({
      lines: [
        '17:23:32.3 (3925848)|USER_INFO|[EXTERNAL]|0054R00000B6Q3p|luke.cotter@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMT+00:00',
        '17:23:32.3 (4conversionId)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should detect log with settings header missing API version', () => {
    const doc = createMockTextDocument({
      lines: [
        'APEX_CODE,FINE;APEX_PROFILING,INFO;CALLOUT,INFO;DB,FINEST;NBA,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;WAVE,INFO;WORKFLOW,FINE',
        '17:23:32.3 (3925848)|USER_INFO|[EXTERNAL]|0054R00000B6Q3p|luke.cotter@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMT+00:00',
        '17:23:32.3 (4000)|EXECUTION_STARTED',
      ],
    });

    expect(isApexLogContent(doc)).toBe(true);
  });

  it('should not detect non-apex log file', () => {
    const doc = createMockTextDocument({
      lines: [
        '[2024-01-15 09:45:31] INFO: Application started',
        '[2024-01-15 09:45:32] DEBUG: Loading configuration',
        '[2024-01-15 09:45:33] ERROR: Connection failed',
      ],
    });

    expect(isApexLogContent(doc)).toBe(false);
  });

  it('should not detect empty document', () => {
    const doc = createMockTextDocument({
      lines: [],
    });

    expect(isApexLogContent(doc)).toBe(false);
  });
});
