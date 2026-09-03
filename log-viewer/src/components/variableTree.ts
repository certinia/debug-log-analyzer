/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  NOT_RECORDED,
  type AddressState,
  type FrameVariables,
  type VariableRow,
} from '../core/log/frameVariables.js';
import {
  clampRaw,
  isExpandable,
  parseVariableValue,
  type VariableValue,
} from '../core/log/variableValue.js';

/**
 * The Variables section as one flat list of rows.
 *
 * Flat because it is a keyboard tree: every row is reachable with the arrow
 * keys, so the row after the one in hand has to be a lookup rather than a walk
 * of nested markup. Only an open row contributes its children, so a closed
 * group costs one row.
 *
 * Structure is how a value is formatted: an object opens into a row per
 * property, and a property that is itself an object opens again. The log's own
 * text is never reformatted, only laid out.
 */

/**
 * How deep a value may open.
 *
 * The log serialises one level itself, so depth beyond that comes from resolving
 * an address, and each resolved object may name more. The cycle guard stops a
 * loop; this stops a long chain.
 */
const MAX_DEPTH = 8;

export interface Common {
  /** Stable across selections, so disclosure and focus survive a re-render. */
  id: string;
  depth: number;
  expandable: boolean;
  open: boolean;
}

/** A value as shown, which is not always the text the log wrote on that line. */
export interface Shown {
  value: VariableValue;
  /** The text behind {@link value}, for the raw text row. */
  raw: string;
  /** The address this row's own text named, where its text was only an address. */
  address: string | null;
  /** True where {@link raw} came from that address rather than from this row. */
  resolved: boolean;
  /** Where the log first describes the object, where that is after this frame. */
  laterAt: number | null;
  /** The class of the object shown, where the log names it. More telling than
   *  the declared type, which is often only an interface. */
  className: string | null;
}

/** What the log holds for an address, as the frame stood. */
export type Resolver = (address: string) => AddressState;

/** The class of the object at an address, where the log names it. */
export type ClassOf = (address: string) => string | null;

/** A row that shows a value of its own, as well as holding others. */
export type GroupSelf = Shown & { declaredType: string | null };

/** What a group is, before the disclosure state it is pushed with. */
interface GroupHead {
  id: string;
  name: string;
  count: number;
  /** Whose frame, or whose class: metadata beside the name. */
  of?: string | null;
  openByDefault?: boolean;
  /** False where opening it would promise a depth the log has not got. */
  expandable?: boolean;
  /** The group's own value, where the group *is* an object. */
  self?: GroupSelf | null;
}

export type VariableTreeRow = Common &
  (
    | { kind: 'group'; name: string; of: string | null; count: number; self: GroupSelf | null }
    | { kind: 'class'; className: string; count: number }
    | ({ kind: 'variable'; row: VariableRow } & Shown)
    | ({ kind: 'entry'; key: string | null } & Shown)
    | { kind: 'text'; raw: string }
    | { kind: 'note'; text: string }
  );

/** The value a row shows: an address resolves to the object it names. */
export function shownValue(row: VariableRow, resolve: Resolver, classOf: ClassOf): Shown {
  // The value's own address where it has one, else the address the line
  // reported for it. A field write reports its owner and so carries neither.
  return shown(row.value, row.address, row.address ?? row.objectAddress, resolve, classOf);
}

/**
 * One value, as shown: the object an address names where the log holds it, else
 * the row's own text.
 *
 * `classAddress` differs from `address` only for a value the log serialised in
 * place: it has no address to resolve, but the line still named the object.
 */
function shown(
  text: string,
  address: string | null,
  classAddress: string | null,
  resolve: Resolver,
  classOf: ClassOf,
): Shown {
  const state = address ? resolve(address) : NOT_RECORDED;
  const raw = state.text ?? text;
  return {
    value: parseVariableValue(raw),
    raw,
    address,
    resolved: state.text !== null,
    laterAt: state.laterAt,
    className: classAddress ? classOf(classAddress) : null,
  };
}

/**
 * Every row the section shows, in order, given which ids are open.
 *
 * `isOpen` decides a group's default too, so the caller owns the policy: Local
 * opens, the rest do not.
 */
export function toTreeRows(
  frame: FrameVariables,
  isOpen: (id: string, openByDefault: boolean) => boolean,
  resolve: Resolver = () => NOT_RECORDED,
  classOf: ClassOf = () => null,
): VariableTreeRow[] {
  const rows: VariableTreeRow[] = [];

  const note = (id: string, depth: number, text: string): void => {
    rows.push({ kind: 'note', id, depth, expandable: false, open: false, text });
  };

  /** The rows an open value contributes: one per property, or its raw text. */
  const children = (
    parentId: string,
    depth: number,
    holder: Shown,
    seen: ReadonlySet<string>,
  ): void => {
    const { value, raw } = holder;
    if (value.kind === 'container' && value.entries.length) {
      let repeats = 0;
      const keys = new Set<string>();
      value.entries.forEach((entry, at) => {
        const id = `${parentId}/${at}`;
        const { address } = entry;
        if (entry.key !== null) {
          if (keys.has(entry.key)) {
            repeats++;
          } else {
            keys.add(entry.key);
          }
        }
        // One already open above this row: opening it again would be a cycle.
        const cycle = address !== null && seen.has(address);
        const held = shown(entry.text, address, address, resolve, classOf);
        const expandable = !cycle && depth < MAX_DEPTH && isExpandable(held.value);
        const open = expandable && isOpen(id, false);
        rows.push({ kind: 'entry', id, depth, expandable, open, key: entry.key, ...held });
        if (open) {
          children(id, depth + 1, held, withAddress(seen, held.resolved ? held.address : null));
        }
      });
      if (repeats) {
        note(
          `${parentId}/repeats`,
          depth,
          `${repeats} keys repeat, kept in the order the log wrote them.`,
        );
      }
      if (value.truncated) {
        note(`${parentId}/cut`, depth, 'The log cut this collection short.');
      }
      return;
    }
    const { text, clamped } = clampRaw(raw);
    rows.push({
      kind: 'text',
      id: `${parentId}/raw`,
      depth,
      expandable: false,
      open: false,
      raw: text,
    });
    if (clamped) {
      note(`${parentId}/clamped`, depth, `Shown to the first ${text.length} characters.`);
    }
  };

  const variables = (parentId: string, depth: number, of: readonly VariableRow[]): void => {
    for (const row of of) {
      const id = `${parentId}/${row.name}`;
      const held = shownValue(row, resolve, classOf);
      const expandable = isExpandable(held.value);
      const open = expandable && isOpen(id, false);
      rows.push({ kind: 'variable', id, depth, expandable, open, row, ...held });
      if (open) {
        children(id, depth + 1, held, withAddress(new Set(), held.resolved ? held.address : null));
      }
    }
  };

  const group = (head: GroupHead, kids: (depth: number) => void): void => {
    const { id, expandable = true, openByDefault = false, of = null, self = null } = head;
    const open = expandable && isOpen(id, openByDefault);
    rows.push({ ...head, kind: 'group', depth: 0, expandable, open, of, self });
    if (open) {
      kids(1);
    }
  };

  group(
    {
      id: 'local',
      name: 'Local',
      of: frame.frameLabel,
      count: frame.locals.length,
      openByDefault: true,
    },
    (depth) => {
      if (frame.locals.length) {
        variables('local', depth, frame.locals);
      } else {
        note('local/none', depth, 'The log records no locals for this frame.');
      }
    },
  );

  // `this` is the object the frame runs on, so the group *is* that object: its
  // own value when closed, its fields when open. A class with no fields has
  // nothing to open, which is the honest reading of a stateless class.
  if (frame.thisRow || frame.fields.length) {
    const self = frame.thisRow ? shownValue(frame.thisRow, resolve, classOf) : null;
    group(
      {
        id: 'this',
        name: 'this',
        count: frame.fields.length,
        expandable: frame.fields.length > 0,
        self: self && { ...self, declaredType: frame.thisRow?.declaredType ?? frame.thisType },
      },
      (depth) => variables('this', depth, frame.fields),
    );
  }

  if (frame.statics.length) {
    const total = frame.statics.reduce((sum, entry) => sum + entry.rows.length, 0);
    // Statics nest one level by class: every static the log names is
    // class-qualified, and a log holds thousands of them.
    group({ id: 'static', name: 'Static', count: total }, () => {
      for (const entry of frame.statics) {
        const id = `static/${entry.className}`;
        const open = isOpen(id, false);
        rows.push({
          kind: 'class',
          id,
          depth: 1,
          expandable: true,
          open,
          className: entry.className,
          count: entry.rows.length,
        });
        if (open) {
          variables(id, 2, entry.rows);
        }
      }
    });
  }

  return rows;
}

/** The addresses open above a row, so the same object cannot open inside itself. */
function withAddress(seen: ReadonlySet<string>, address: string | null): ReadonlySet<string> {
  return address ? new Set([...seen, address]) : seen;
}

/** The row that holds `id`'s children, for the key that moves out of one. */
export function parentOf(rows: readonly VariableTreeRow[], at: number): number {
  const depth = rows[at]?.depth ?? 0;
  for (let above = at - 1; above >= 0; above--) {
    if ((rows[above]?.depth ?? 0) < depth) {
      return above;
    }
  }
  return -1;
}
