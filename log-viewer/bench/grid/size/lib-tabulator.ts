/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Tabulator as the app loads it: the core plus the modules every table registers. */
import { Tabulator } from 'tabulator-tables';

import * as CommonModules from '../../../src/tabulator/module/CommonModules.js';

Tabulator.registerModule(Object.values(CommonModules));
export { Tabulator };
