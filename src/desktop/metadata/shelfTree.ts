// Pure shelf-text tree: no imports, so the template rewriter and readback verify can share it.

export type ShelfLeaf = { leaf: string };
export type ShelfGroup = { ops: string[]; children: ShelfNode[]; paren: boolean };
export type ShelfNode = ShelfLeaf | ShelfGroup;

const SHELF_OPERATORS = new Set(['/', '+', '*']);

/**
 * Parse shelf text into a tree. Groups keep their parens and operators; leaves are bracketed
 * pill refs (with `]]` escapes). Lenient: never throws, ignores stray parens.
 */
export function parseShelfTree(value: string): ShelfNode | undefined {
  let pos = 0;

  const skipSpace = (): void => {
    while (pos < value.length && /\s/.test(value[pos])) pos++;
  };

  const parseLeaf = (): ShelfLeaf | undefined => {
    let current = '';
    let inBracketedName = false;
    while (pos < value.length) {
      const char = value[pos];
      if (inBracketedName) {
        current += char;
        pos++;
        if (char === ']') {
          if (value[pos] === ']') {
            current += ']';
            pos++;
          } else {
            inBracketedName = false;
          }
        }
        continue;
      }
      if (char === '[') {
        inBracketedName = true;
      } else if (SHELF_OPERATORS.has(char) || char === '(' || char === ')') {
        break;
      }
      current += char;
      pos++;
    }
    const trimmed = current.trim();
    return trimmed ? { leaf: trimmed } : undefined;
  };

  const parseOperand = (): ShelfNode | undefined => {
    skipSpace();
    if (value[pos] === '(') {
      pos++;
      const inner = parseExpr(true);
      skipSpace();
      if (value[pos] === ')') pos++;
      if (inner && 'ops' in inner) inner.paren = true;
      return inner;
    }
    return parseLeaf();
  };

  const parseExpr = (nested: boolean): ShelfNode | undefined => {
    const children: ShelfNode[] = [];
    const ops: string[] = [];
    let pendingOp = '/';
    for (;;) {
      const operand = parseOperand();
      if (operand) {
        if (children.length > 0) ops.push(pendingOp);
        children.push(operand);
      }
      skipSpace();
      const char = value[pos];
      if (char !== undefined && SHELF_OPERATORS.has(char)) {
        pendingOp = char;
        pos++;
        continue;
      }
      if (char === ')' && !nested) {
        pos++;
        continue;
      }
      if (char === undefined || char === ')') break;
      pos++;
    }
    if (children.length === 0) return undefined;
    if (children.length === 1) return children[0];
    return { ops, children, paren: false };
  };

  return parseExpr(false);
}

export function serializeShelfTree(node: ShelfNode | undefined): string {
  if (!node) return '';
  if ('leaf' in node) return node.leaf;
  const body = node.children
    .map((child, i) => (i === 0 ? '' : ` ${node.ops[i - 1]} `) + serializeShelfTree(child))
    .join('');
  return node.paren ? `(${body})` : body;
}

export function shelfTreeFromValue(value: string | string[] | undefined): ShelfNode | undefined {
  if (!value) return undefined;
  const texts = Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v : String(v)))
    : typeof value === 'string'
      ? [value]
      : [];
  const nodes = texts.map(parseShelfTree).filter((n): n is ShelfNode => n !== undefined);
  if (nodes.length <= 1) return nodes[0];
  return { ops: nodes.slice(1).map(() => '/'), children: nodes, paren: false };
}

export function shelfLeaves(node: ShelfNode | undefined): string[] {
  if (!node) return [];
  if ('leaf' in node) return [node.leaf];
  return node.children.flatMap(shelfLeaves);
}

/**
 * Parse a shelf value into pill refs in order, looking through grouping parens and
 * the "/", "+" and "*" operators.
 */
export function parseShelfValue(value: string | string[] | undefined): string[] {
  return shelfLeaves(shelfTreeFromValue(value));
}

export function removeShelfLeaf(
  node: ShelfNode,
  ref: string | ((leaf: string) => boolean),
): ShelfNode | undefined {
  if ('leaf' in node) {
    return (typeof ref === 'string' ? node.leaf === ref : ref(node.leaf)) ? undefined : node;
  }
  const children: ShelfNode[] = [];
  const ops: string[] = [];
  node.children.forEach((child, i) => {
    const kept = removeShelfLeaf(child, ref);
    if (!kept) return;
    if (children.length > 0) ops.push(node.ops[i - 1] ?? node.ops[0] ?? '/');
    children.push(kept);
  });
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  return { ops, children, paren: node.paren };
}

/** Drop every pill matching `predicate` from shelf text, keeping the surrounding operator structure. */
export function pruneShelfLeaves(value: string, predicate: (leaf: string) => boolean): string {
  const tree = parseShelfTree(value);
  return serializeShelfTree(tree && removeShelfLeaf(tree, predicate));
}

function isSlashGroup(node: ShelfNode): node is ShelfGroup {
  return 'ops' in node && node.ops.every((op) => op === '/');
}

// Tableau writes parenthesised "/" groups of 3+ pills right-nested: (a / (b / c)).
function rightNestSlashGroup(group: ShelfGroup): void {
  if (!group.paren || group.children.length <= 2) return;
  let tail: ShelfNode = group.children[group.children.length - 1];
  for (let i = group.children.length - 2; i >= 1; i--) {
    tail = { ops: ['/'], children: [group.children[i], tail], paren: true };
  }
  group.children = [group.children[0], tail];
  group.ops = ['/'];
}

// An unparenthesized + or * group joined to a new "/" operand needs its parens to keep its meaning.
function parenthesized(node: ShelfNode): ShelfNode {
  if ('leaf' in node || node.paren || node.ops.every((op) => op === '/')) return node;
  return { ...node, paren: true };
}

export function insertShelfLeaf(
  root: ShelfNode | undefined,
  index: number | undefined,
  ref: string,
): ShelfNode {
  const leaf: ShelfLeaf = { leaf: ref };
  if (!root) return leaf;
  const count = shelfLeaves(root).length;
  if (index === undefined || index < 0 || index >= count) {
    if ('ops' in root && !root.paren && isSlashGroup(root)) {
      root.ops.push('/');
      root.children.push(leaf);
      return root;
    }
    return { ops: ['/'], children: [parenthesized(root), leaf], paren: false };
  }
  if ('leaf' in root) return { ops: ['/'], children: [leaf, parenthesized(root)], paren: false };

  // Path of groups from the root down to the leaf at `index`, with the child slot taken in each.
  const path: Array<{ group: ShelfGroup; slot: number }> = [];
  let seen = 0;
  const find = (group: ShelfGroup): boolean => {
    for (let i = 0; i < group.children.length; i++) {
      const child = group.children[i];
      path.push({ group, slot: i });
      if ('ops' in child) {
        if (find(child)) return true;
      } else if (seen++ === index) {
        return true;
      }
      path.pop();
    }
    return false;
  };
  find(root);

  // Never join a "+" or "*" group: insert beside the nearest "/" ancestor's child instead.
  let depth = path.length - 1;
  while (depth >= 0 && !isSlashGroup(path[depth].group)) depth--;
  if (depth < 0) {
    return index === 0
      ? { ops: ['/'], children: [leaf, parenthesized(root)], paren: false }
      : { ops: ['/'], children: [parenthesized(root), leaf], paren: false };
  }
  const { group, slot } = path[depth];
  group.children.splice(slot, 0, leaf);
  group.ops.splice(Math.max(slot - 1, 0), 0, '/');
  rightNestSlashGroup(group);
  return root;
}
