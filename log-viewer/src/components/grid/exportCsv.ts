/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { saveFile } from '../../core/messaging/saveFile.js';
import type { LvGrid } from '../../grid/index.js';

// The byte order mark tells Excel the file is UTF-8.
const BOM = String.fromCharCode(0xfeff);

/**
 * Saves every row of the grid that passes its filters as CSV, through the extension
 * host, or as a browser download outside VS Code.
 */
export async function exportCsv(grid: Pick<LvGrid, 'exportText'>, fileName: string): Promise<void> {
  const text = await grid.exportText({ format: 'csv', tree: true });
  if (text === null) {
    return;
  }
  const content = `${BOM}${text}`;
  if (!saveFile(content, fileName)) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}
