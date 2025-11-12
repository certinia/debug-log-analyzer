/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * WebGL 2.0 Capability Check
 *
 * Validates browser support for WebGL 2.0 required by mesh-based rendering.
 */

export interface WebGLCheckResult {
  supported: boolean;
  error?: string;
  context?: WebGL2RenderingContext;
}

/**
 * Check if the browser supports WebGL 2.0.
 *
 * Creates a temporary canvas and attempts to get a WebGL 2.0 context.
 * Returns detailed result with support status and error information.
 */
export function checkWebGL2Support(): WebGLCheckResult {
  try {
    // Create temporary canvas for context testing
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');

    if (!gl) {
      return {
        supported: false,
        error:
          'WebGL 2.0 not available. Please use a modern browser (Chrome, Firefox, Safari, or Edge).',
      };
    }

    // Verify basic WebGL 2.0 functionality
    const hasVertexArrayObjects = gl.createVertexArray !== undefined;
    if (!hasVertexArrayObjects) {
      return {
        supported: false,
        error: 'WebGL 2.0 is missing required features (Vertex Array Objects).',
      };
    }

    return {
      supported: true,
      context: gl,
    };
  } catch (e) {
    return {
      supported: false,
      error: `WebGL 2.0 initialization failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
