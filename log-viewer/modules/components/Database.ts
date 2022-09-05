/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { html, render } from 'lit';
import './DatabaseSection';
export async function renderDb() {
  const dbContainer = document.getElementById('dbContent');
  if (dbContainer) {
    const sections = [
      html`<database-section type="dml" />`,
      html`<database-section type="soql" />`,
    ];
    render(html`<div>${sections}</div>`, dbContainer);
  }
}
