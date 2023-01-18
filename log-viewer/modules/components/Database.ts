/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { html, render } from 'lit';
import './DatabaseSection';
export async function renderDb() {
  const dbContainer = document.getElementById('dbContent');
  if (dbContainer) {
    render(
      html` <div>
        <database-section type="dml"></database-section>
        <database-section type="soql"></database-section>
      </div>`,
      dbContainer
    );
  }
}
