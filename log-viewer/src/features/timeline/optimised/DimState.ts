/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { sameMembers } from '../../../core/utility/Util.js';
import type { MatchedEventInfo } from '../types/search.types.js';

/** Frames kept in colour while the rest of the chart is dimmed. */
export interface FrameDim {
  ids: ReadonlySet<string>;
  /** The same frames' time, depth and category, so one merged into a pixel bucket still lights. */
  info: ReadonlyArray<MatchedEventInfo>;
  /** Categories kept in colour whole. */
  categories: ReadonlySet<string>;
}

const NO_CATEGORIES: ReadonlySet<string> = new Set();
const NO_FRAMES: FrameDim = { ids: new Set(), info: [], categories: NO_CATEGORIES };

/**
 * Which dim the chart shows. Three sources ask for one: a search, the inspector's
 * emphasis and the legend's categories. Only one shows, in that order.
 */
export class DimState {
  private readonly hasSearch: () => boolean;
  // Built when set, so the render loop reads them without allocating.
  private emphasis: FrameDim = NO_FRAMES;
  private legend: FrameDim = NO_FRAMES;

  /** @param hasSearch - Whether a search is on, matches or not; it outranks the rest. */
  constructor(hasSearch: () => boolean) {
    this.hasSearch = hasSearch;
  }

  /**
   * Point at these frames, as the inspector does. Empty drops the emphasis.
   * @returns Whether anything changed
   */
  setEmphasis(ids: ReadonlySet<string>, info: ReadonlyArray<MatchedEventInfo>): boolean {
    if (sameMembers(ids, this.emphasis.ids)) {
      return false;
    }
    this.emphasis = { ids, info, categories: NO_CATEGORIES };
    return true;
  }

  /**
   * Keep these categories in colour, as the legend does. Empty drops them.
   * @returns Whether anything changed
   */
  setCategories(categories: ReadonlySet<string>): boolean {
    if (sameMembers(categories, this.legend.categories)) {
      return false;
    }
    this.legend = categories.size ? { ...NO_FRAMES, categories } : NO_FRAMES;
    return true;
  }

  /** What the chart shows: the search's own styling, frames to keep, or null to draw normally. */
  chart(): 'search' | FrameDim | null {
    if (this.hasSearch()) {
      return 'search';
    }
    if (this.emphasis.ids.size) {
      return this.emphasis;
    }
    return this.legend.categories.size ? this.legend : null;
  }

  /** Whether the legend's categories are the dim on screen; only then may Escape clear them. */
  legendShowing(): boolean {
    return this.chart() === this.legend;
  }

  /** The categories the minimap keeps in colour: the legend's, only while they show. */
  minimapCategories(): ReadonlySet<string> {
    return this.legendShowing() ? this.legend.categories : NO_CATEGORIES;
  }
}
