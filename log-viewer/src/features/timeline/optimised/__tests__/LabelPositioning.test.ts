/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { calculateLabelPosition, type LabelPositionParams } from '../rendering/LabelPositioning.js';

/**
 * Tests for LabelPositioning - smart label positioning for timeline overlays.
 */

describe('LabelPositioning', () => {
  describe('calculateLabelPosition', () => {
    const defaultParams: LabelPositionParams = {
      labelWidth: 100,
      labelHeight: 50,
      screenStartX: 200,
      screenEndX: 400,
      displayWidth: 800,
      displayHeight: 600,
      padding: 8,
    };

    describe('fully visible selection', () => {
      it('should center label in visible portion when space permits', () => {
        const result = calculateLabelPosition(defaultParams);

        // Selection is 200-400, visible width = 200, label width = 100
        // Centered: 200 + (200 - 100) / 2 = 250
        expect(result.left).toBe(250);
      });

      it('should center label vertically in viewport', () => {
        const result = calculateLabelPosition(defaultParams);

        // Viewport height = 600, label height = 50
        // Centered: 600 / 2 - 50 / 2 = 275
        expect(result.top).toBe(275);
      });

      it('should center small selection label on selection', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: 350,
          screenEndX: 370, // Only 20px wide
        };

        const result = calculateLabelPosition(params);

        // Small selection (20px) < labelWidth + padding*2 (116px)
        // Should still center on visible: 350 + (20 - 100) / 2 = 310
        // But clamped to padding: max(8, 310) = 310
        expect(result.left).toBe(310);
      });
    });

    describe('partially offscreen selection', () => {
      it('should stick to left edge when left side is offscreen and visible portion is small', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: -100,
          screenEndX: 50, // Visible portion (0-50) smaller than label + padding
        };

        const result = calculateLabelPosition(params);

        // Left edge offscreen, visible portion = 50px < label + padding (116px)
        // Stick to left edge with padding = 8
        expect(result.left).toBe(8);
      });

      it('should center in visible portion when left side offscreen but enough space', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: -100,
          screenEndX: 300, // Visible portion (0-300) wide enough
        };

        const result = calculateLabelPosition(params);

        // Visible portion = 0-300 (300px) >= labelWidth + padding*2 (116px)
        // Center in visible: 0 + (300 - 100) / 2 = 100
        expect(result.left).toBe(100);
      });

      it('should stick to right edge when right side is offscreen and visible portion is small', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: 750,
          screenEndX: 900, // Visible portion (750-800) smaller than label + padding
        };

        const result = calculateLabelPosition(params);

        // Right edge offscreen, visible portion = 50px < label + padding (116px)
        // Stick to right edge: 800 - 100 - 8 = 692
        expect(result.left).toBe(692);
      });

      it('should center in visible portion when right side offscreen but enough space', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: 600,
          screenEndX: 900, // Visible portion (600-800) = 200px
        };

        const result = calculateLabelPosition(params);

        // Visible portion = 600-800 (200px) >= labelWidth + padding*2 (116px)
        // Center in visible: 600 + (200 - 100) / 2 = 650
        expect(result.left).toBe(650);
      });

      it('should center on viewport when both edges are offscreen', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: -100,
          screenEndX: 900,
        };

        const result = calculateLabelPosition(params);

        // Both edges offscreen: center on viewport
        // Centered: (800 - 100) / 2 = 350
        expect(result.left).toBe(350);
      });
    });

    describe('vertical clamping', () => {
      it('should clamp to top padding when vertical center would be negative', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          labelHeight: 700, // Taller than viewport
        };

        const result = calculateLabelPosition(params);

        // Center would be 600/2 - 350 = -50, clamped to padding = 8
        expect(result.top).toBe(8);
      });

      it('should clamp to padding when label almost fits', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          labelHeight: 50,
          displayHeight: 60, // Very short viewport
        };

        const result = calculateLabelPosition(params);

        // The implementation uses Math.max(padding, min(available, centered))
        // available = 60 - 50 - 8 = 2
        // centered = 60/2 - 25 = 5
        // min(2, 5) = 2, then max(8, 2) = 8
        expect(result.top).toBe(8);
      });
    });

    describe('horizontal clamping', () => {
      it('should clamp left position to padding', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: 0,
          screenEndX: 20, // Very small selection at left edge
        };

        const result = calculateLabelPosition(params);

        // Would want to center at 0 + (20-100)/2 = -40
        // Clamped to padding = 8
        expect(result.left).toBe(8);
      });

      it('should clamp right position to viewport boundary', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: 780,
          screenEndX: 800, // Very small selection at right edge
        };

        const result = calculateLabelPosition(params);

        // displayWidth (800) - labelWidth (100) - padding (8) = 692
        expect(result.left).toBe(692);
      });
    });

    describe('custom padding', () => {
      it('should respect custom padding value for left stick', () => {
        const params: LabelPositionParams = {
          ...defaultParams,
          screenStartX: -100,
          screenEndX: 50, // Small visible portion
          padding: 20,
        };

        const result = calculateLabelPosition(params);

        // Left edge offscreen, small visible portion, stick to left with custom padding = 20
        expect(result.left).toBe(20);
      });

      it('should use default padding of 8 when not specified', () => {
        const params: LabelPositionParams = {
          labelWidth: 100,
          labelHeight: 50,
          screenStartX: -100,
          screenEndX: 50, // Small visible portion
          displayWidth: 800,
          displayHeight: 600,
          // No padding specified
        };

        const result = calculateLabelPosition(params);

        expect(result.left).toBe(8);
      });
    });
  });
});
