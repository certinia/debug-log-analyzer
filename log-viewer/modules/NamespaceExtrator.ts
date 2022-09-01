import { RootNode } from './parsers/TreeParser';

/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
function collectNamespaces(node: RootNode): Set<string> {
  const children = node.children;
  const namespaces = new Set<string>();
  let i = 0;
  while (i < window.activeNamespaces.length) {
    namespaces.add(window.activeNamespaces[i]);
    ++i;
  }

  i = 0;
  while (i < children.length) {
    const child = children[i],
      childType = child.type;

    if (childType === 'ENTERING_MANAGED_PKG') {
      namespaces.add(child.text);
    }
    ++i;
  }
  return namespaces;
}

function extractNamespace(namespaces: Set<string>, text: string) {
  const parts = text.split('.');
  if (namespaces.has(parts[0])) {
    return parts[0];
  } else {
    return null;
  }
}

async function setNamespaces(node: RootNode) {
  const namespaces = collectNamespaces(node);
  const children = node.children;

  let i = 0;
  while (i < children.length) {
    const child = children[i],
      childType = child.type;

    if (childType === 'CODE_UNIT_STARTED' && child.type === 'method' && !child.namespace) {
      child.namespace = extractNamespace(namespaces, child.text);
    } else if (childType === 'EXCEPTION_THROWN') {
      child.namespace = extractNamespace(namespaces, child.text);
    } else if (childType === 'CONSTRUCTOR_ENTRY') {
      child.namespace = extractNamespace(namespaces, child.text);
    } else if (childType === 'METHOD_ENTRY') {
      child.namespace = extractNamespace(namespaces, child.text);
    }
    ++i;
  }
  return namespaces;
}

export { setNamespaces };
