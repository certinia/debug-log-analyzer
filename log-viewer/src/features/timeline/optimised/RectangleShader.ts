/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * rectangleShader
 *
 * Custom shader for rendering vertex-colored rectangles using PixiJS 8.
 * Supports both WebGL (GLSL) and WebGPU (WGSL) for maximum compatibility.
 *
 * The shader uses clip-space coordinates directly - positions are pre-transformed
 * in JavaScript for maximum performance (single draw call, no uniform binding overhead).
 *
 * Vertex attributes:
 * - aPosition: vec2 in clip space (-1 to 1)
 * - aColor: vec4 RGBA color (normalized 0-1)
 */

import { GlProgram, GpuProgram, Shader } from 'pixi.js';

/**
 * WebGL vertex shader (GLSL 300 ES)
 *
 * Simple pass-through shader - positions are already in clip space.
 * Passes vertex color to fragment shader.
 */
const glslVertex = /* glsl */ `#version 300 es
precision highp float;

in vec2 aPosition;
in vec4 aColor;

out vec4 vColor;

void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vColor = aColor;
}
`;

/**
 * WebGL fragment shader (GLSL 300 ES)
 *
 * Outputs premultiplied alpha color for correct blending with PixiJS 8's
 * default blend mode (GL_ONE, GL_ONE_MINUS_SRC_ALPHA).
 */
const glslFragment = /* glsl */ `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
    fragColor = vec4(vColor.rgb * vColor.a, vColor.a);
}
`;

/**
 * WebGPU vertex shader (WGSL)
 *
 * Same functionality as GLSL version for WebGPU renderer.
 */
const wgslVertex = /* wgsl */ `
struct VertexInput {
    @location(0) aPosition: vec2f,
    @location(1) aColor: vec4f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) vColor: vec4f,
}

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4f(input.aPosition, 0.0, 1.0);
    output.vColor = input.aColor;
    return output;
}
`;

/**
 * WebGPU fragment shader (WGSL)
 *
 * Outputs premultiplied alpha color for correct blending.
 */
const wgslFragment = /* wgsl */ `
struct FragmentInput {
    @location(0) vColor: vec4f,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4f {
    return vec4f(input.vColor.rgb * input.vColor.a, input.vColor.a);
}
`;

/**
 * Creates a shader program for rendering vertex-colored rectangles.
 *
 * The shader supports both WebGL and WebGPU backends automatically.
 * PixiJS 8 will select the appropriate program based on the renderer.
 *
 * @returns Shader instance ready for use with Mesh
 */
export function createRectangleShader(): Shader {
  const glProgram = GlProgram.from({
    vertex: glslVertex,
    fragment: glslFragment,
  });

  const gpuProgram = GpuProgram.from({
    vertex: {
      source: wgslVertex,
      entryPoint: 'main',
    },
    fragment: {
      source: wgslFragment,
      entryPoint: 'main',
    },
  });

  return new Shader({
    glProgram,
    gpuProgram,
    resources: {},
  });
}
