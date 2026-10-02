const TOOLTIP_MESSAGE =
  'Tabulator writes a string tooltip with innerHTML, so log text is read as markup. Use textCellTooltip from features/call-tree/components/TableShared.ts.';

export default {
  meta: { name: 'lana' },
  rules: {
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
