import { expect, test } from 'bun:test'
import { IMsgDb } from '../src/db'
import { FIXTURE, fixtureDb } from './helpers'

test('listChats returns both chats with correct styles', () => {
  const db = new IMsgDb(fixtureDb)
  const chats = db.listChats()
  db.close()
  const dm = chats.find(c => c.guid === FIXTURE.dmGuid)
  const group = chats.find(c => c.guid === FIXTURE.groupGuid)
  expect(dm?.style).toBe('dm')
  expect(group?.style).toBe('group')
  expect(group?.displayName).toBe(FIXTURE.groupName)
})

test('findChat resolves a DM by handle', () => {
  const db = new IMsgDb(fixtureDb)
  const chat = db.findChat(FIXTURE.handle1)
  db.close()
  expect(chat?.guid).toBe(FIXTURE.dmGuid)
  expect(chat?.participants).toContain(FIXTURE.handle1)
})

test('messages come back oldest-first and decode attributedBody', () => {
  const db = new IMsgDb(fixtureDb)
  const msgs = db.messages(FIXTURE.dmGuid, 50)
  db.close()
  expect(msgs.length).toBe(FIXTURE.dmMessageCount)
  const rowids = msgs.map(m => m.rowid)
  expect(rowids).toEqual([...rowids].sort((a, b) => a - b))
  const attr = msgs.find(m => m.rowid === 5)
  expect(attr?.text).toBe(FIXTURE.attributedText)
})

test('attachment rows expand ~ to an absolute resolvedPath', () => {
  const db = new IMsgDb(fixtureDb)
  const msgs = db.messages(FIXTURE.dmGuid, 50)
  db.close()
  const withAtt = msgs.find(m => m.hasAttachments)
  expect(withAtt?.attachments.length).toBe(1)
  const att = withAtt!.attachments[0]!
  expect(att.resolvedPath?.startsWith('/')).toBe(true)
  expect(att.resolvedPath?.endsWith(FIXTURE.attachmentSuffix)).toBe(true)
})

test('watermark reflects the max message rowid', () => {
  const db = new IMsgDb(fixtureDb)
  expect(db.watermark()).toBeGreaterThanOrEqual(FIXTURE.maxRowid)
  db.close()
})
