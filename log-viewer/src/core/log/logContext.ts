/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { createContext } from '@lit/context';

import type { LogStore } from './LogStore.js';

/**
 * The log on screen, for any component that reads it.
 *
 * The app root provides it and a new log is a new store, so a subscribing
 * consumer re-renders on a parse without listening for an event. Null until the
 * first log parses.
 */
export const logContext = createContext<LogStore | null>(Symbol('lana-log-store'));
