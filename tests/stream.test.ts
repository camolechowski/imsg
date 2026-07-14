import { Database } from 'bun:sqlite'
import { afterAll, expect, test } from 'bun:test'
import { FIXTURE, fixtureDb, repoRoot } from './helpers'

let nextRowid = FIXTURE.maxRowid + 1

afterAll(() => {
  const db = new Database(fixtureDb)
  db.query('DELETE FROM chat_message_join WHERE message_id > ?').run(FIXTURE.maxRowid)
  db.query('DELETE FROM message WHERE ROWID > ?').run(FIXTURE.maxRowid)
  db.close()
})

function insertMessage(opts: { chat: number; text: string; handle: number | null; fromMe?: boolean }): number {
  const rowid = nextRowid++
  const db = new Database(fixtureDb)
  const ns = (Date.now() - 978_307_200_000) * 1e6
  db.query(
    `INSERT INTO message (ROWID, guid, text, date, is_from_me, cache_has_attachments, service, account, handle_id)
     VALUES (?, ?, ?, ?, ?, 0, 'iMessage', ?, ?)`,
  ).run(
    rowid,
    `FIXTURE-${rowid}`,
    opts.text,
    ns,
    opts.fromMe ? 1 : 0,
    opts.fromMe ? 'E:me@example.com' : null,
    opts.handle,
  )
  db.query('INSERT INTO chat_message_join VALUES (?, ?)').run(opts.chat, rowid)
  db.close()
  return rowid
}

interface StreamHandle {
  nextLine(): Promise<any>
  waitExit(): Promise<number>
}

function spawnStream(args: string[]): StreamHandle {
  const proc = Bun.spawn(['node', 'dist/cli.js', 'stream', ...args], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      IMESSAGE_DB_PATH: fixtureDb,
      IMSG_CONFIG_PATH: '/nonexistent/imsg-config.json',
      NO_COLOR: '1',
    },
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const queue: string[] = []
  let resolveWait: ((line: string | null) => void) | null = null
  let closed = false

  void (async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        closed = true
        if (resolveWait) {
          const r = resolveWait
          resolveWait = null
          r(null)
        }
        return
      }
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!line.trim()) continue
        if (resolveWait) {
          const r = resolveWait
          resolveWait = null
          r(line)
        } else {
          queue.push(line)
        }
      }
    }
  })()

  return {
    async nextLine() {
      if (queue.length > 0) return JSON.parse(queue.shift()!)
      if (closed) throw new Error('stream closed with no more lines')
      const line = await new Promise<string | null>(resolve => {
        resolveWait = resolve
      })
      if (line === null) throw new Error('stream closed with no more lines')
      return JSON.parse(line)
    },
    async waitExit() {
      return await proc.exited
    },
  }
}

test('ready event is emitted with the current watermark cursor', async () => {
  const s = spawnStream(['--timeout', '1'])
  const ready = await s.nextLine()
  expect(ready.type).toBe('ready')
  expect(ready.cursor.rowid).toBe(FIXTURE.maxRowid)
  expect(typeof ready.cursor.ts).toBe('string')
  expect(await s.waitExit()).toBe(124)
})

test('a newly inserted message produces a message event', async () => {
  const s = spawnStream(['--interval', '100', '--max-events', '1', '--timeout', '5'])
  await s.nextLine() // ready
  const rowid = insertMessage({ chat: 1, text: 'stream test message', handle: 1 })
  const msg = await s.nextLine()
  expect(msg.type).toBe('message')
  expect(msg.rowid).toBe(rowid)
  expect(msg.text).toBe('stream test message')
  expect(msg.isFromMe).toBe(false)
  expect(await s.waitExit()).toBe(0)
})

test('--from filter excludes non-matching senders', async () => {
  const s = spawnStream(['--interval', '100', '--from', FIXTURE.handle1, '--timeout', '2'])
  await s.nextLine() // ready
  insertMessage({ chat: 2, text: 'from handle2', handle: 2 })
  expect(await s.waitExit()).toBe(124)
})

test('--max-events 1 exits 0 after the first matching event', async () => {
  const s = spawnStream(['--interval', '100', '--max-events', '1', '--timeout', '5'])
  await s.nextLine() // ready
  insertMessage({ chat: 1, text: 'first', handle: 1 })
  insertMessage({ chat: 1, text: 'second', handle: 1 })
  const msg = await s.nextLine()
  expect(msg.text).toBe('first')
  expect(await s.waitExit()).toBe(0)
})

test('--timeout with no traffic exits 124', async () => {
  const s = spawnStream(['--timeout', '1'])
  await s.nextLine() // ready
  expect(await s.waitExit()).toBe(124)
})
