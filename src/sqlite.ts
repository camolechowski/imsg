// Runtime-neutral sqlite access: bun:sqlite under bun, node:sqlite under node.
// createRequire keeps both specifiers out of the bundler's static graph.

import { createRequire } from 'node:module'

export interface SqlStatement {
  all(...params: Array<string | number>): unknown[]
  get(...params: Array<string | number>): unknown
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement
  close(): void
}

const req = createRequire(import.meta.url)

export function openReadOnly(path: string): SqlDatabase {
  if (process.versions.bun) {
    const { Database } = req('bun:sqlite')
    const db = new Database(path, { readonly: true })
    return { prepare: (sql: string) => db.query(sql), close: () => db.close() }
  }
  const { DatabaseSync } = req('node:sqlite')
  const db = new DatabaseSync(path, { readOnly: true })
  return {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      // chat.db dates are ns since 2001 and exceed 2^53; read as BigInt then
      // coerce to number (same lossy behavior as bun:sqlite).
      stmt.setReadBigInts(true)
      return {
        all: (...params: Array<string | number>) =>
          (stmt.all(...params) as unknown[]).map(coerceRow),
        get: (...params: Array<string | number>) => coerceRow(stmt.get(...params)),
      }
    },
    close: () => db.close(),
  }
}

function coerceRow(row: unknown): unknown {
  if (row == null || typeof row !== 'object') return row
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') (row as Record<string, unknown>)[k] = Number(v)
  }
  return row
}
