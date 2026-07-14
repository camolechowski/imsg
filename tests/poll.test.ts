import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { FIXTURE, fixtureDb, runCli } from './helpers'

test('poll with no cursor bootstraps at the watermark and exits 3', () => {
  const r = runCli(['poll', '--json'])
  expect(r.code).toBe(3)
  const d = JSON.parse(r.stdout)
  expect(d.messages).toEqual([])
  expect(d.cursor.rowid).toBe(FIXTURE.maxRowid)
  expect(typeof d.cursor.ts).toBe('string')
})

test('poll --since-rowid 0 emits everything with cursor at max rowid', () => {
  const r = runCli(['poll', '--since-rowid', '0', '--json'])
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.messages.length).toBe(FIXTURE.maxRowid)
  expect(d.cursor.rowid).toBe(FIXTURE.maxRowid)
  const m = d.messages[0]
  expect(m).toHaveProperty('rowid')
  expect(m).toHaveProperty('guid')
  expect(m).toHaveProperty('chatGuid')
  expect(m).toHaveProperty('isFromMe')
})

test('re-polling from the returned cursor emits nothing (no re-emission)', () => {
  const r = runCli(['poll', '--since-rowid', String(FIXTURE.maxRowid), '--json'])
  expect(r.code).toBe(3)
  const d = JSON.parse(r.stdout)
  expect(d.messages).toEqual([])
})

test('poll scoped to a handle only returns that chat', () => {
  const r = runCli(['poll', FIXTURE.handle1, '--since-rowid', '0', '--json'])
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.chat.guid).toBe(FIXTURE.dmGuid)
  expect(d.messages.length).toBe(FIXTURE.dmMessageCount)
  for (const m of d.messages) expect(m.chatGuid).toBe(FIXTURE.dmGuid)
})

test('poll --limit truncation pins the cursor to the last emitted message', () => {
  const r = runCli(['poll', '--since-rowid', '0', '--limit', '3', '--json'])
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.messages.length).toBe(3)
  expect(d.cursor.rowid).toBe(d.messages[2].rowid)
})

test('watch --timeout exits 124 with parseable JSON on a quiet db', () => {
  const start = Date.now()
  const r = runCli(['watch', '--timeout', '1', '--json'])
  expect(r.code).toBe(124)
  expect(Date.now() - start).toBeLessThan(3000)
  const d = JSON.parse(r.stdout)
  expect(d.messages).toEqual([])
  expect(d.cursor.rowid).toBeGreaterThanOrEqual(FIXTURE.maxRowid)
})

test('a newly inserted message is picked up exactly once by the old cursor', () => {
  const db = new Database(fixtureDb)
  const ns = (Date.now() - 978_307_200_000) * 1e6
  const rowid = FIXTURE.maxRowid + 1
  db.query(
    `INSERT INTO message (ROWID, guid, text, date, is_from_me, cache_has_attachments, service, account, handle_id)
     VALUES (?, ?, ?, ?, 0, 0, 'iMessage', NULL, 1)`,
  ).run(rowid, `FIXTURE-${rowid}`, 'fresh message', ns)
  db.query('INSERT INTO chat_message_join VALUES (1, ?)').run(rowid)
  db.close()

  const r = runCli(['poll', '--since-rowid', String(FIXTURE.maxRowid), '--json'])
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.messages.length).toBe(1)
  expect(d.messages[0].text).toBe('fresh message')
  expect(d.cursor.rowid).toBe(rowid)

  const again = runCli(['poll', '--since-rowid', String(rowid), '--json'])
  expect(again.code).toBe(3)
})
