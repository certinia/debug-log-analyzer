/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { createContext } from '@lit/context';

/** `logContext` is null both before a parse and after a failed one; this tells
 *  the two apart, so a surface waiting on the log knows which it is waiting for. */
export type LogStatus = 'parsing' | 'ready' | 'failed';

export const logStatusContext = createContext<LogStatus>(Symbol('lana-log-status'));
