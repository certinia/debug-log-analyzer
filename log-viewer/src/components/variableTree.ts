/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  NOT_RECORDED,
  type FrameVariables,
  type IndexView,
  type VariableRow,
} from '../core/log/frameVariables.js';
import {
  assembledContainer,
  clampRaw,
  isExpandable,
  parseVariableValue,
  type ValueEntry,
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
  /** The object this row shows, however its line named it: its own address, or
   *  the address the line reported for it. What its fields are indexed by. */
  objectAddress: string | null;
  /** What the row opens into, in that order. One list, so the preview, the
   *  count and the rows below cannot disagree. */
  parts: readonly Part[];
  /** What a closed row previews, where the object's parts reached the log as
   *  writes of their own rather than on its own line. Null where its own text is
   *  all there is. */
  assembled: VariableValue | null;
}

/** One part of a value: a field the log recorded for the object, or a key the
 *  value's own text held. `at` is its place in that text, for a stable id. */
export type Part = { field: VariableRow } | { entry: ValueEntry; at: number };

/** What the tree asks the log about an address. Every lookup is optional: a
 *  caller with no index still gets its rows, with nothing resolved. */
export type Lookups = Partial<IndexView>;

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

/** The value a row shows: an address resolves to the object it names.
 *
 *  `fields` overrides what the log holds for the object, for a caller that has
 *  already gathered them: the `this` group's fields merge the index with the
 *  frame's own writes, and its preview must be the list it opens on. */
function shownValue(row: VariableRow, lookups: Lookups, fields?: readonly VariableRow[]): Shown {
  // The value's own address where it has one, else the address the line
  // reported for it. A field write reports its owner and so carries neither.
  return shown(row.value, row.address, row.address ?? row.objectAddress, lookups, fields);
}

/**
 * One value, as shown: the object an address names where the log holds it, else
 * the row's own text.
 *
 * `objectAddress` differs from `address` only for a value the log serialised in
 * place: it has no address to resolve, but the line still named the object, and
 * that is what its class and its fields are indexed by.
 */
function shown(
  text: string,
  address: string | null,
  objectAddress: string | null,
  lookups: Lookups,
  given?: readonly VariableRow[],
): Shown {
  const state = (address ? lookups.resolve?.(address) : null) ?? NOT_RECORDED;
  const raw = state.text ?? text;
  const value = parseVariableValue(raw);
  const fields = given ?? (objectAddress ? (lookups.fields?.(objectAddress) ?? []) : []);
  const parts = partsOf(fields, value);
  return {
    value,
    raw,
    address,
    resolved: state.text !== null,
    laterAt: state.laterAt,
    className: (objectAddress && lookups.classOf?.(objectAddress)) || null,
    objectAddress,
    parts,
    // Only where a part came from a write of its own: a value the log
    // serialised in place previews as the log wrote it.
    assembled: fields.length ? assembledOf(parts, value) : null,
  };
}

/**
 * What a value opens into, in that order: the fields the log recorded for the
 * object, then the keys the value's own text held that no field covers.
 *
 * A recorded field wins because it is its own write, at or before this frame,
 * where a serialised key is only as the object stood when that line was written.
 * One list, read by the preview, the count and the rows alike.
 */
function partsOf(fields: readonly VariableRow[], value: VariableValue): Part[] {
  const named = new Set(fields.map((field) => field.name));
  const parts: Part[] = fields.map((field) => ({ field }));
  const held = value.kind === 'container' ? value.entries : [];
  held.forEach((entry, at) => {
    if (entry.key === null || !named.has(entry.key)) {
      parts.push({ entry, at });
    }
  });
  return parts;
}

/** {@link partsOf} as one value, for the row that holds them closed: the log
 *  wrote `{}` for an object it could not serialise, and a row showing only that
 *  reads as empty while holding eight fields. */
function assembledOf(parts: readonly Part[], value: VariableValue): VariableValue {
  return assembledContainer(
    parts.map((part) =>
      'field' in part
        ? { key: part.field.name, text: part.field.value }
        : { key: part.entry.key, text: part.entry.text },
    ),
    // The object's own line serialised nothing, so only a surviving serialised
    // part can be short of what the log held.
    value.kind === 'container' && value.truncated && parts.some((part) => 'entry' in part),
  );
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
  lookups: Lookups = {},
): VariableTreeRow[] {
  const rows: VariableTreeRow[] = [];

  const note = (id: string, depth: number, text: string): void => {
    rows.push({ kind: 'note', id, depth, expandable: false, open: false, text });
  };

  /** The rows an open value contributes: the parts it holds, or its raw text. */
  function children(
    parentId: string,
    depth: number,
    holder: Shown,
    seen: ReadonlySet<string>,
  ): void {
    const { value, raw, parts } = holder;
    if (parts.length) {
      let repeats = 0;
      const keys = new Set<string>();
      for (const part of parts) {
        if ('field' in part) {
          variable(parentId, depth, part.field, seen);
          continue;
        }
        const { entry, at } = part;
        if (entry.key !== null) {
          if (keys.has(entry.key)) {
            repeats++;
          } else {
            keys.add(entry.key);
          }
        }
        const id = `${parentId}/${at}`;
        const held = shown(entry.text, entry.address, entry.address, lookups);
        if (pushValue({ kind: 'entry', key: entry.key }, id, depth, held, seen)) {
          children(id, depth + 1, held, withAddress(seen, held.objectAddress));
        }
      }
      if (repeats) {
        note(
          `${parentId}/repeats`,
          depth,
          `${repeats} keys repeat, kept in the order the log wrote them.`,
        );
      }
      if (value.kind === 'container' && value.truncated) {
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
  }

  function variables(
    parentId: string,
    depth: number,
    of: readonly VariableRow[],
    seen: ReadonlySet<string>,
  ): void {
    for (const row of of) {
      variable(parentId, depth, row, seen);
    }
  }

  function variable(
    parentId: string,
    depth: number,
    row: VariableRow,
    seen: ReadonlySet<string>,
  ): void {
    const id = `${parentId}/${row.name}`;
    const held = shownValue(row, lookups);
    if (pushValue({ kind: 'variable', row }, id, depth, held, seen)) {
      children(id, depth + 1, held, withAddress(seen, held.objectAddress));
    }
  }

  /** Pushes a row that shows a value, and says whether its children follow.
   *
   *  One rule for what may open: the value holds parts, or its text is too long
   *  to read in a row. An object already open above this row would be a cycle,
   *  and `MAX_DEPTH` stops a long chain. */
  function pushValue(
    of: { kind: 'variable'; row: VariableRow } | { kind: 'entry'; key: string | null },
    id: string,
    depth: number,
    held: Shown,
    seen: ReadonlySet<string>,
  ): boolean {
    const cycle = held.objectAddress !== null && seen.has(held.objectAddress);
    const expandable =
      !cycle && depth < MAX_DEPTH && (held.parts.length > 0 || isExpandable(held.value));
    const open = expandable && isOpen(id, false);
    rows.push({ ...of, id, depth, expandable, open, ...held });
    return open;
  }

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
        variables('local', depth, frame.locals, new Set());
      } else {
        note('local/none', depth, 'The log records no locals for this frame.');
      }
    },
  );

  // `this` is the object the frame runs on, so the group *is* that object: its
  // own value when closed, its fields when open. A class with no fields has
  // nothing to open, which is the honest reading of a stateless class.
  if (frame.thisRow || frame.fields.length) {
    const self = frame.thisRow ? shownValue(frame.thisRow, lookups, frame.fields) : null;
    group(
      {
        id: 'this',
        name: 'this',
        count: frame.fields.length,
        expandable: frame.fields.length > 0,
        self: self && { ...self, declaredType: frame.thisRow?.declaredType ?? frame.thisType },
      },
      // The frame's own object, so a field pointing back at it cannot reopen it.
      (depth) =>
        variables('this', depth, frame.fields, withAddress(new Set(), self?.objectAddress ?? null)),
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
          variables(id, 2, entry.rows, new Set());
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
