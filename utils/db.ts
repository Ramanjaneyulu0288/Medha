// ── DB result helpers ──
// react-native-nitro-sqlite (and most RN SQLite drivers) can return query rows
// in one of several shapes depending on platform/version:
//   - a plain array
//   - `{ rows: { _array: [...] } }`
//   - `{ rows: { length, item(i) } }`  (WebSQL-style cursor)
// These helpers normalize that into a single, predictable API so call sites
// don't each re-implement the defensive parsing.

/** Normalize any supported query result into a plain array of rows. */
export function readRows<T = any>(res: any): T[] {
  const rows = res?.rows;
  if (!rows) return [];
  if (Array.isArray(rows)) return rows as T[];
  if (Array.isArray(rows._array)) return rows._array as T[];
  if (typeof rows.item === 'function' && typeof rows.length === 'number') {
    const out: T[] = [];
    for (let i = 0; i < rows.length; i++) out.push(rows.item(i));
    return out;
  }
  return [];
}

/** Return the first row of a result, or undefined. */
export function firstRow<T = any>(res: any): T | undefined {
  return readRows<T>(res)[0];
}

/**
 * Resolve the rowid of the most recent INSERT.
 * Prefers the driver's `insertId` field; falls back to `last_insert_rowid()`.
 * `db` must expose `execute(sql)` (returns a query result).
 */
export function getInsertId(res: any, db: { execute: (sql: string) => any }): number | null {
  if (res?.insertId != null) return Number(res.insertId);
  try {
    const idRes = db.execute('SELECT last_insert_rowid() as id');
    const id = firstRow<{ id: number }>(idRes)?.id;
    return id != null ? Number(id) : null;
  } catch {
    return null;
  }
}
