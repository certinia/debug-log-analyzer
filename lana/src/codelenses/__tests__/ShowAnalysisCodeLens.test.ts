/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { languages } from 'vscode';

import type { Context } from '../../Context.js';
import { APEX_LOG_URI_SCHEMES } from '../../language/ApexLogLanguageDetector.js';
import { ShowAnalysisCodeLens } from '../ShowAnalysisCodeLens.js';

describe('ShowAnalysisCodeLens.apply', () => {
  it('registers log selectors for every supported workspace scheme', () => {
    const subscriptions: { dispose(): void }[] = [];
    const context = { context: { subscriptions } } as unknown as Context;

    ShowAnalysisCodeLens.apply(context);

    expect(languages.registerCodeLensProvider).toHaveBeenCalledWith(
      APEX_LOG_URI_SCHEMES.flatMap((scheme) => [
        { scheme, language: 'apexlog' },
        { scheme, pattern: '**/*.log' },
        { scheme, pattern: '**/*.txt' },
      ]),
      expect.any(ShowAnalysisCodeLens),
    );
    expect(subscriptions).toHaveLength(1);
  });
});
