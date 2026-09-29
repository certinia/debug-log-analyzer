/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { Mesh, type Container, type Geometry, type Shader } from 'pixi.js';

import { RectangleGeometry } from '../RectangleGeometry.js';
import { createRectangleShader } from '../RectangleShader.js';

/**
 * A rectangle mesh in `container`, drawn by the clip-space shader. `label` is what the
 * Pixi devtools call the mesh.
 */
export function createRectangleMesh(
  container: Container,
  label: string,
): { geometry: RectangleGeometry; mesh: Mesh<Geometry, Shader> } {
  const geometry = new RectangleGeometry();
  const mesh = new Mesh<Geometry, Shader>({
    geometry: geometry.getGeometry(),
    shader: createRectangleShader(),
  });
  mesh.label = label;
  container.addChild(mesh);
  return { geometry, mesh };
}
