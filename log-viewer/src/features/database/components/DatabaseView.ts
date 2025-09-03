/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '../../../components/CallStack.js';
import type { ApexLog } from '../../../core/log-parser/LogEvents.js';
import { globalStyles } from '../../../styles/global.styles.js';
import './DMLView.js';
import './DatabaseSOQLDetailPanel.js';
import './DatabaseSection.js';
import './SOQLView.js';

@customElement('database-view')
export class DatabaseView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  dmlMatches = 0;
  soqlMatches = 0;

  @state()
  dmlHighlightIndex = 0;
  @state()
  soqlHighlightIndex = 0;

  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  findMap = {};

  constructor() {
    super();

    document.addEventListener('db-find-results', this._findResults as EventListener);
    document.addEventListener('lv-find-match', this._findHandler as EventListener);
    document.addEventListener('lv-find', this._findHandler as EventListener);
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }
    `,
  ];

  render() {
    return html`
      <dml-view
        .timelineRoot="${this.timelineRoot}"
        .highlightIndex="${this.dmlHighlightIndex}"
      ></dml-view>
      <soql-view
        .timelineRoot="${this.timelineRoot}"
        .highlightIndex="${this.soqlHighlightIndex}"
      ></soql-view>
    `;
  }

  _findHandler = (
    e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>,
  ) => {
    this._find(e.detail);
  };

  _find = (arg: { count: number }) => {
    const matchIndex = arg.count;
    if (matchIndex <= this.dmlMatches) {
      this.dmlHighlightIndex = matchIndex;
      this.soqlHighlightIndex = 0;
    } else {
      this.soqlHighlightIndex = matchIndex - this.dmlMatches;
      this.dmlHighlightIndex = 0;
    }
  };

  _findResults = (e: CustomEvent<{ totalMatches: number; type: 'dml' | 'soql' }>) => {
    if (e.detail.type === 'dml') {
      this.dmlMatches = e.detail.totalMatches;
    } else if (e.detail.type === 'soql') {
      this.soqlMatches = e.detail.totalMatches;
    }

    this._find({ count: 1 });

    document.dispatchEvent(
      new CustomEvent('lv-find-results', {
        detail: { totalMatches: this.dmlMatches + this.soqlMatches },
      }),
    );
  };
}
