// Builds tests/fixtures/chat.db — a small synthetic iMessage database matching
// the schema slices src/db.ts queries. No real messages. Run with node >= 22.13.

import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(root, 'tests', 'fixtures')
const dbPath = join(dir, 'chat.db')

export const FIXTURE = {
  dbPath,
  handle1: '+15550001111',
  handle2: '+15550002222',
  dmGuid: 'iMessage;-;+15550001111',
  groupGuid: 'iMessage;+;chat9999',
  groupName: 'Test Group',
  attributedText: 'decoded from attributedBody',
  attachmentFilename: '~/Library/Messages/Attachments/ab/cd/IMG_0001.heic',
  maxRowid: 8,
}

const APPLE_EPOCH_MS = 978_307_200_000

function ns(minutesAgo: number): number {
  return (Date.now() - minutesAgo * 60_000 - APPLE_EPOCH_MS) * 1e6
}

function attributedBody(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  if (payload.length >= 0x80) throw new Error('fixture payload too long')
  return Buffer.concat([
    Buffer.from([0x04, 0x0b, 0x73, 0x74]),
    Buffer.from('NSString', 'ascii'),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
    Buffer.from([payload.length]),
    payload,
  ])
}

rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec(`
  CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
  CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, style INTEGER,
                     chat_identifier TEXT, display_name TEXT, service_name TEXT);
  CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT,
                        attributedBody BLOB, date INTEGER, is_from_me INTEGER,
                        cache_has_attachments INTEGER DEFAULT 0, service TEXT,
                        account TEXT, handle_id INTEGER);
  CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
  CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
  CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT,
                           mime_type TEXT, transfer_name TEXT);
  CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
`)

db.prepare('INSERT INTO handle VALUES (1, ?)').run(FIXTURE.handle1)
db.prepare('INSERT INTO handle VALUES (2, ?)').run(FIXTURE.handle2)

db.prepare('INSERT INTO chat VALUES (1, ?, 45, ?, NULL, ?)').run(
  FIXTURE.dmGuid, FIXTURE.handle1, 'iMessage')
db.prepare('INSERT INTO chat VALUES (2, ?, 43, ?, ?, ?)').run(
  FIXTURE.groupGuid, 'chat9999', FIXTURE.groupName, 'iMessage')

db.exec(`
  INSERT INTO chat_handle_join VALUES (1, 1);
  INSERT INTO chat_handle_join VALUES (2, 1);
  INSERT INTO chat_handle_join VALUES (2, 2);
`)

const insertMsg = db.prepare(
  `INSERT INTO message (ROWID, guid, text, attributedBody, date, is_from_me,
                        cache_has_attachments, service, account, handle_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
const joinMsg = db.prepare('INSERT INTO chat_message_join VALUES (?, ?)')

interface Seed {
  rowid: number
  chat: number
  text: string | null
  attr: Buffer | null
  minutesAgo: number
  fromMe: boolean
  hasAtt: boolean
  handle: number | null
}

const seeds: Seed[] = [
  { rowid: 1, chat: 1, text: 'hey, are we still on for tonight?', attr: null, minutesAgo: 120, fromMe: false, hasAtt: false, handle: 1 },
  { rowid: 2, chat: 1, text: 'yes! 7pm works', attr: null, minutesAgo: 118, fromMe: true, hasAtt: false, handle: null },
  { rowid: 3, chat: 2, text: 'group dinner friday?', attr: null, minutesAgo: 90, fromMe: false, hasAtt: false, handle: 2 },
  { rowid: 4, chat: 2, text: 'count me in', attr: null, minutesAgo: 85, fromMe: true, hasAtt: false, handle: null },
  { rowid: 5, chat: 1, text: null, attr: attributedBody(FIXTURE.attributedText), minutesAgo: 60, fromMe: false, hasAtt: false, handle: 1 },
  { rowid: 6, chat: 1, text: 'check out this photo', attr: null, minutesAgo: 45, fromMe: false, hasAtt: true, handle: 1 },
  { rowid: 7, chat: 2, text: 'running late, start without me', attr: null, minutesAgo: 20, fromMe: false, hasAtt: false, handle: 2 },
  { rowid: 8, chat: 1, text: 'see you soon', attr: null, minutesAgo: 5, fromMe: true, hasAtt: false, handle: null },
]

for (const s of seeds) {
  insertMsg.run(
    s.rowid, `FIXTURE-${s.rowid}`, s.text, s.attr, ns(s.minutesAgo),
    s.fromMe ? 1 : 0, s.hasAtt ? 1 : 0, 'iMessage',
    s.fromMe ? 'E:me@example.com' : null, s.handle)
  joinMsg.run(s.chat, s.rowid)
}

db.prepare('INSERT INTO attachment VALUES (1, ?, ?, ?)').run(
  FIXTURE.attachmentFilename, 'image/heic', 'IMG_0001.heic')
db.prepare('INSERT INTO message_attachment_join VALUES (6, 1)').run()

db.close()
console.log(`fixture written: ${dbPath}`)
