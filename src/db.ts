// chat.db reader. Read-only, opens via ./sqlite (bun:sqlite or node:sqlite).
// Queries return domain types from ./types after decoding attributedBody for
// newer macOS rows.

import { homedir } from 'os'
import { join } from 'path'
import { openReadOnly, type SqlDatabase, type SqlStatement } from './sqlite'
import type {
  AttachmentInfo,
  Chat,
  ChatStyle,
  ChatSummary,
  Message,
  QueryFilter,
} from './types'

const DEFAULT_DB = process.env.IMESSAGE_DB_PATH ?? join(homedir(), 'Library', 'Messages', 'chat.db')

// Core Data epoch: 2001-01-01 UTC. message.date is nanoseconds since.
const APPLE_EPOCH_MS = 978_307_200_000

function appleDate(ns: number | null | undefined): Date | null {
  if (ns == null) return null
  return new Date(ns / 1e6 + APPLE_EPOCH_MS)
}

function dateToApple(d: Date): number {
  return (d.getTime() - APPLE_EPOCH_MS) * 1e6
}

// macOS encodes message text in attributedBody (typedstream NSAttributedString)
// when text is null. Hunt for the NSString class marker, skip metadata to the
// 0x2B inline-string sigil, then decode the streamtyped length prefix.
export function parseAttributedBody(blob: Uint8Array | null): string | null {
  if (!blob) return null
  const buf = Buffer.from(blob)
  let i = buf.indexOf('NSString')
  if (i < 0) return null
  i += 'NSString'.length
  while (i < buf.length && buf[i] !== 0x2b) i++
  if (i >= buf.length) return null
  i++
  let len: number
  const b = buf[i++]!
  if (b === 0x81) { len = buf[i]!; i += 1 }
  else if (b === 0x82) { len = buf.readUInt16LE(i); i += 2 }
  else if (b === 0x83) { len = buf.readUIntLE(i, 3); i += 3 }
  else { len = b }
  if (i + len > buf.length) return null
  return buf.toString('utf8', i, i + len)
}

function styleFor(n: number | null): ChatStyle | null {
  if (n === 45) return 'dm'
  if (n === 43) return 'group'
  return null
}

interface MsgRow {
  rowid: number
  guid: string
  text: string | null
  attributedBody: Uint8Array | null
  date: number
  is_from_me: number
  cache_has_attachments: number
  service: string | null
  account: string | null
  handle_id: string | null
  chat_guid: string
  chat_style: number | null
  chat_identifier: string | null
  chat_display_name: string | null
}

const MSG_COLS = `m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date,
                  m.is_from_me, m.cache_has_attachments, m.service, m.account,
                  h.id AS handle_id, c.guid AS chat_guid, c.style AS chat_style,
                  c.chat_identifier, c.display_name AS chat_display_name`

const MSG_JOINS = `FROM message m
                   JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
                   JOIN chat c ON c.ROWID = cmj.chat_id
                   LEFT JOIN handle h ON h.ROWID = m.handle_id`

export class IMsgDb {
  private db: SqlDatabase
  private qSelf!: SqlStatement
  private qChats!: SqlStatement
  private qChatByGuid!: SqlStatement
  private qChatByHandle!: SqlStatement
  private qParticipants!: SqlStatement
  private qMessagesByChat!: SqlStatement
  private qMessagesByChatSince!: SqlStatement
  private qRecent!: SqlStatement
  private qPoll!: SqlStatement
  private qPollRowidChat!: SqlStatement
  private qPollDate!: SqlStatement
  private qPollDateChat!: SqlStatement
  private qWatermark!: SqlStatement
  private qAttachments!: SqlStatement

  constructor(path: string = DEFAULT_DB) {
    try {
      this.db = openReadOnly(path)
      this.db.prepare('SELECT ROWID FROM message LIMIT 1').get()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `cannot read ${path}: ${msg}\n  ` +
          `Grant Full Disk Access to the terminal (or the node/bun binary) in\n  ` +
          `System Settings → Privacy & Security → Full Disk Access.`,
      )
    }
    this.prepare()
  }

  private prepare(): void {
    const db = this.db

    this.qSelf = db.prepare(
      `SELECT DISTINCT account AS addr FROM message
       WHERE is_from_me = 1 AND account IS NOT NULL AND account != ''
       LIMIT 50`,
    )

    // Per-chat last message via a correlated subquery on the latest date.
    this.qChats = db.prepare(`
      SELECT c.guid, c.chat_identifier, c.display_name, c.style, c.service_name,
             m.text AS last_text, m.attributedBody AS last_attr, m.date AS last_date,
             m.is_from_me AS last_from_me,
             (SELECT COUNT(*) FROM chat_message_join cmj WHERE cmj.chat_id = c.ROWID) AS msg_count
      FROM chat c
      LEFT JOIN message m ON m.ROWID = (
        SELECT cmj.message_id FROM chat_message_join cmj
        JOIN message m2 ON m2.ROWID = cmj.message_id
        WHERE cmj.chat_id = c.ROWID
        ORDER BY m2.date DESC LIMIT 1
      )
      WHERE m.date IS NOT NULL
      ORDER BY m.date DESC
      LIMIT ?
    `)

    this.qChatByGuid = db.prepare(
      `SELECT c.guid, c.chat_identifier, c.display_name, c.style, c.service_name
       FROM chat c WHERE c.guid = ? LIMIT 1`,
    )

    // DM lookup: case-insensitive handle match. Prefer the chat with the most
    // recent message rather than the newest chat row.
    this.qChatByHandle = db.prepare(`
      SELECT c.guid, c.chat_identifier, c.display_name, c.style, c.service_name,
             MAX(m.date) AS last_date
      FROM chat c
      JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
      JOIN handle h ON h.ROWID = chj.handle_id
      LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
      LEFT JOIN message m ON m.ROWID = cmj.message_id
      WHERE c.style = 45 AND LOWER(h.id) = LOWER(?)
      GROUP BY c.ROWID, c.guid, c.chat_identifier, c.display_name, c.style, c.service_name
      ORDER BY last_date DESC, c.ROWID DESC
      LIMIT 1
    `)

    this.qParticipants = db.prepare(`
      SELECT DISTINCT h.id FROM handle h
      JOIN chat_handle_join chj ON chj.handle_id = h.ROWID
      JOIN chat c ON c.ROWID = chj.chat_id
      WHERE c.guid = ?
    `)

    this.qMessagesByChat = db.prepare(`
      SELECT ${MSG_COLS}
      ${MSG_JOINS}
      WHERE c.guid = ?
      ORDER BY m.date DESC
      LIMIT ?
    `)

    this.qMessagesByChatSince = db.prepare(`
      SELECT ${MSG_COLS}
      ${MSG_JOINS}
      WHERE c.guid = ? AND m.date >= ?
      ORDER BY m.date DESC
      LIMIT ?
    `)

    this.qRecent = db.prepare(`
      SELECT ${MSG_COLS}
      ${MSG_JOINS}
      WHERE m.date >= ?
      ORDER BY m.date DESC
      LIMIT ?
    `)

    this.qPoll = db.prepare(`
      SELECT ${MSG_COLS}
      ${MSG_JOINS}
      WHERE m.ROWID > ?
      ORDER BY m.ROWID ASC
      LIMIT 1000
    `)

    this.qPollRowidChat = db.prepare(`
      SELECT ${MSG_COLS}
      ${MSG_JOINS}
      WHERE m.ROWID > ? AND c.guid = ?
      ORDER BY m.ROWID ASC
      LIMIT 1000
    `)

    this.qPollDate = db.prepare(`
      SELECT ${MSG_COLS}
      ${MSG_JOINS}
      WHERE m.date > ?
      ORDER BY m.ROWID ASC
      LIMIT 1000
    `)

    this.qPollDateChat = db.prepare(`
      SELECT ${MSG_COLS}
      ${MSG_JOINS}
      WHERE m.date > ? AND c.guid = ?
      ORDER BY m.ROWID ASC
      LIMIT 1000
    `)

    this.qWatermark = db.prepare(`SELECT MAX(ROWID) AS max FROM message`)

    this.qAttachments = db.prepare(`
      SELECT a.filename, a.mime_type, a.transfer_name
      FROM attachment a
      JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
      WHERE maj.message_id = ?
    `)
  }

  /** Your own addresses (extracted from message.account on is_from_me rows). */
  selfAddresses(): string[] {
    const out: string[] = []
    for (const r of this.qSelf.all() as { addr: string }[]) {
      const norm = /^[A-Za-z]:/.test(r.addr) ? r.addr.slice(2) : r.addr
      out.push(norm.toLowerCase())
    }
    return out
  }

  watermark(): number {
    const r = this.qWatermark.get() as { max: number | null }
    return r?.max ?? 0
  }

  listChats(limit = 25): ChatSummary[] {
    const rows = this.qChats.all(limit) as Array<{
      guid: string
      chat_identifier: string | null
      display_name: string | null
      style: number | null
      service_name: string | null
      last_text: string | null
      last_attr: Uint8Array | null
      last_date: number | null
      last_from_me: number | null
      msg_count: number
    }>
    return rows
      .map(r => {
        const style = styleFor(r.style)
        if (!style) return null
        return {
          guid: r.guid,
          identifier: r.chat_identifier ?? r.guid,
          displayName: r.display_name,
          style,
          service: r.service_name ?? 'iMessage',
          participants: this.participants(r.guid),
          lastMessageAt: appleDate(r.last_date),
          lastText: r.last_text ?? parseAttributedBody(r.last_attr),
          lastFromMe: r.last_from_me === 1,
          messageCount: r.msg_count,
        }
      })
      .filter((c): c is ChatSummary => c !== null)
  }

  participants(chatGuid: string): string[] {
    return (this.qParticipants.all(chatGuid) as { id: string }[]).map(p => p.id)
  }

  findChat(target: string): Chat | null {
    if (/^(iMessage|SMS|RCS);[+-];/.test(target)) {
      const r = this.qChatByGuid.get(target) as
        | { guid: string; chat_identifier: string | null; display_name: string | null; style: number | null; service_name: string | null }
        | null
      if (!r) return null
      const style = styleFor(r.style)
      if (!style) return null
      return {
        guid: r.guid,
        identifier: r.chat_identifier ?? r.guid,
        displayName: r.display_name,
        style,
        service: r.service_name ?? 'iMessage',
        participants: this.participants(r.guid),
      }
    }
    const r = this.qChatByHandle.get(target) as
      | { guid: string; chat_identifier: string | null; display_name: string | null; style: number | null; service_name: string | null }
      | null
    if (!r) return null
    return {
      guid: r.guid,
      identifier: r.chat_identifier ?? r.guid,
      displayName: r.display_name,
      style: 'dm',
      service: r.service_name ?? 'iMessage',
      participants: this.participants(r.guid),
    }
  }

  messages(chatGuid: string, limit = 50, since?: Date): Message[] {
    const rows = (since
      ? (this.qMessagesByChatSince.all(chatGuid, dateToApple(since), limit) as MsgRow[])
      : (this.qMessagesByChat.all(chatGuid, limit) as MsgRow[]))
    return rows.map(r => this.toMessage(r)).reverse()
  }

  recent(filter: QueryFilter = {}): Message[] {
    const since = filter.since ?? new Date(Date.now() - 7 * 86_400_000)
    const limit = filter.limit ?? 50
    const rows = this.qRecent.all(dateToApple(since), Math.min(limit * 4, 5000)) as MsgRow[]
    let out = rows.map(r => this.toMessage(r))
    out = applyFilter(out, filter)
    return out.slice(0, limit)
  }

  search(text: string, filter: QueryFilter = {}): Message[] {
    const limit = filter.limit ?? 50
    const since = filter.since ?? new Date(Date.now() - 30 * 86_400_000)
    // Pull a bigger window then in-memory filter (text may live in attributedBody).
    const rows = this.qRecent.all(dateToApple(since), 20_000) as MsgRow[]
    const needle = text.toLowerCase()
    const all = rows.map(r => this.toMessage(r))
    const matched = all.filter(m => m.text.toLowerCase().includes(needle))
    return applyFilter(matched, { ...filter, text: undefined }).slice(0, limit)
  }

  /** New messages since a watermark (rowid). For watch mode. */
  pollSince(watermark: number): Message[] {
    const rows = this.qPoll.all(watermark) as MsgRow[]
    return rows.map(r => this.toMessage(r))
  }

  pollSinceRowid(rowid: number, chatGuid?: string): Message[] {
    const rows = (chatGuid
      ? (this.qPollRowidChat.all(rowid, chatGuid) as MsgRow[])
      : (this.qPoll.all(rowid) as MsgRow[]))
    return rows.map(r => this.toMessage(r))
  }

  pollSinceDate(since: Date, chatGuid?: string): Message[] {
    const rows = (chatGuid
      ? (this.qPollDateChat.all(dateToApple(since), chatGuid) as MsgRow[])
      : (this.qPollDate.all(dateToApple(since)) as MsgRow[]))
    return rows.map(r => this.toMessage(r))
  }

  attachments(rowid: number): AttachmentInfo[] {
    return (this.qAttachments.all(rowid) as Array<{
      filename: string | null
      mime_type: string | null
      transfer_name: string | null
    }>).map(a => ({
      filename: a.filename,
      mimeType: a.mime_type,
      transferName: a.transfer_name,
      resolvedPath: a.filename
        ? (a.filename.startsWith('~/') ? join(homedir(), a.filename.slice(2)) : a.filename)
        : null,
    }))
  }

  close(): void {
    this.db.close()
  }

  private toMessage(r: MsgRow): Message {
    const text = r.text ?? parseAttributedBody(r.attributedBody) ?? ''
    return {
      rowid: r.rowid,
      guid: r.guid,
      text,
      date: appleDate(r.date) ?? new Date(0),
      isFromMe: r.is_from_me === 1,
      handle: r.handle_id,
      service: r.service ?? 'iMessage',
      chatGuid: r.chat_guid,
      hasAttachments: r.cache_has_attachments === 1,
      attachments: r.cache_has_attachments === 1 ? this.attachments(r.rowid) : [],
      account: r.account,
    }
  }
}

function applyFilter(msgs: Message[], f: QueryFilter): Message[] {
  let out = msgs
  if (f.fromHandle) {
    const want = f.fromHandle.toLowerCase()
    out = out.filter(m => (m.handle?.toLowerCase() ?? '') === want)
  }
  if (f.service) {
    const want = f.service.toLowerCase()
    out = out.filter(m => m.service.toLowerCase() === want)
  }
  if (f.until) {
    const t = f.until.getTime()
    out = out.filter(m => m.date.getTime() <= t)
  }
  if (f.since) {
    const t = f.since.getTime()
    out = out.filter(m => m.date.getTime() >= t)
  }
  if (f.includeGroups === false || f.includeDms === false) {
    // chat_style isn't on Message; skip — caller can filter by chatGuid if needed.
  }
  if (f.text) {
    const needle = f.text.toLowerCase()
    out = out.filter(m => m.text.toLowerCase().includes(needle))
  }
  return out
}
