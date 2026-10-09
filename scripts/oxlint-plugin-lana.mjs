import path from 'node:path';

const TOOLTIP_MESSAGE =
  'Tabulator writes a string tooltip with innerHTML, so log text is read as markup. Use textCellTooltip from features/call-tree/components/TableShared.ts.';

const GRID_DIR = `${path.sep}log-viewer${path.sep}src${path.sep}grid`;

/**
 * What each grid layer may import. Relative imports may reach only the listed layers;
 * bare imports only the listed packages. `ui → render → core`, and core has no dependencies.
 */
const GRID_LAYERS = {
  core: { layers: ['core'], packages: [] },
  render: { layers: ['core', 'render'], packages: ['@tanstack/virtual-core'] },
  ui: { layers: ['core', 'render', 'ui'], packages: ['lit', '@lit/'] },
  // grid/index.ts: the public entry point re-exports every layer.
  '': { layers: ['', 'core', 'render', 'ui'], packages: [] },
};

/** The grid layer a resolved path is in ('' for grid/index.ts), or null outside the grid. */
function gridLayerOf(file) {
  const at = file.indexOf(GRID_DIR + path.sep);
  if (at === -1) {
    return null;
  }
  const rest = file.slice(at + GRID_DIR.length + 1);
  const first = rest.split(path.sep)[0];
  return first in GRID_LAYERS && first !== '' && rest.includes(path.sep) ? first : '';
}

function gridBoundary(context) {
  const file = context.filename;
  const layer = gridLayerOf(file);
  const inLogViewer = file.includes(`${path.sep}log-viewer${path.sep}`);

  function check(node) {
    const spec = node.source?.value;
    if (typeof spec !== 'string') {
      return;
    }
    const relative = spec.startsWith('.');
    const target = relative ? path.resolve(path.dirname(file), spec).replace(/\.js$/, '') : null;

    if (layer === null) {
      // Outside the grid: only the public entry point.
      if (inLogViewer && target && gridLayerOf(target) !== null) {
        const entry =
          file.slice(0, file.indexOf(`${path.sep}log-viewer${path.sep}`)) +
          GRID_DIR +
          `${path.sep}index`;
        if (target !== entry) {
          context.report({
            node: node.source,
            message: 'Import the grid from grid/index.ts only. Its layers are internal.',
          });
        }
      }
      return;
    }

    const allowed = GRID_LAYERS[layer];
    if (relative) {
      const targetLayer = gridLayerOf(target);
      if (targetLayer === null) {
        context.report({
          node: node.source,
          message: 'The grid is built as an outside library: it may not import app code.',
        });
      } else if (!allowed.layers.includes(targetLayer)) {
        context.report({
          node: node.source,
          message: `grid/${layer} may not import grid/${targetLayer || 'index.ts'}. Layers depend one way: ui → render → core.`,
        });
      }
    } else if (
      !allowed.packages.some((p) => spec === p || spec.startsWith(p.endsWith('/') ? p : `${p}/`))
    ) {
      context.report({
        node: node.source,
        message: `grid/${layer || 'index.ts'} may not import '${spec}'. Allowed: ${allowed.packages.join(', ') || 'no packages'}.`,
      });
    }
  }

  return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
}

export default {
  meta: { name: 'lana' },
  rules: {
    'grid-boundary': { create: gridBoundary },
    'no-tabulator-html-tooltip': {
      create(context) {
        return {
          Property(node) {
            if (
              node.key.type === 'Identifier' &&
              node.key.name === 'tooltip' &&
              node.value.type === 'Literal' &&
              node.value.value === true
            ) {
              context.report({ node, message: TOOLTIP_MESSAGE });
            }
          },
        };
      },
    },
  },
};
