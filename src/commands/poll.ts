import { EXIT, isChatAllowed, loadConfig, type ImsgConfig } from '../config'
import { IMsgDb } from '../db'
import { colors, formatDateTime, jsonOut, padRight, stripNewlines, truncate } from '../format'
import { getInt, getString, looksLikeChatGuid, normalizeHandle, parseSince } from '../parse'
import { hasRenderableContent, type Chat, type CommandContext, type Message } from '../types'

interface Cursor {
  rowid: number
  ts: string
}

export async function handlePoll(ctx: CommandContext): Promise<void> {
  const target = ctx.positional[0]
  const limit = getInt(ctx.flags, 'limit', 500) ?? 500
  const sinceRowid = getInt(ctx.flags, 'since-rowid')
  const since = sinceRowid === undefined ? parseSince(getString(ctx.flags, 'since')) : undefined
  const cfg = loadConfig()

  const db = new IMsgDb()
  try {
    let chat: Chat | null = null
    if (target) {
      const lookup = looksLikeChatGuid(target) ? target : normalizeHandle(target)
      chat = db.findChat(lookup)
      if (!chat) {
        if (ctx.out.json) {
          console.log(jsonOut({ error: 'chat not found', target: lookup }))
        } else {
          console.error(`no chat found for: ${lookup}`)
        }
        process.exit(EXIT.ERROR)
      }
      if (!isChatAllowed(cfg, chat)) {
        if (ctx.out.json) {
          console.log(JSON.stringify({ error: 'blocked by allowlist' }))
        } else {
          console.error('imsg: chat blocked by allowlist')
        }
        process.exit(EXIT.BLOCKED)
      }
    }

    // No cursor given: bootstrap. Emit nothing, hand back the current watermark.
    if (sinceRowid === undefined && !since) {
      emit(ctx, chat, [], { rowid: db.watermark(), ts: new Date().toISOString() })
      process.exit(EXIT.NO_NEW)
    }

    const fetched =
      sinceRowid !== undefined
        ? db.pollSinceRowid(sinceRowid, chat?.guid)
        : db.pollSinceDate(since!, chat?.guid)

    const visible = chat || !cfg?.allowlist ? fetched : filterAllowed(fetched, cfg, db)
    const renderable = visible.filter(hasRenderableContent)
    const truncated = renderable.length > limit
    const emitted = truncated ? renderable.slice(0, limit) : renderable

    // Cursor: max fetched rowid normally; when --limit truncates, pin to the
    // last emitted message so nothing is silently skipped on the next call.
    const lastFetched = fetched[fetched.length - 1]
    const lastEmitted = emitted[emitted.length - 1]
    const cursor: Cursor =
      truncated && lastEmitted
        ? { rowid: lastEmitted.rowid, ts: lastEmitted.date.toISOString() }
        : lastFetched
          ? { rowid: lastFetched.rowid, ts: lastFetched.date.toISOString() }
          : { rowid: db.watermark(), ts: new Date().toISOString() }

    emit(ctx, chat, emitted, cursor)
    process.exit(emitted.length > 0 ? EXIT.OK : EXIT.NO_NEW)
  } finally {
    db.close()
  }
}

function filterAllowed(messages: Message[], cfg: ImsgConfig, db: IMsgDb): Message[] {
  const cache = new Map<string, boolean>()
  return messages.filter(m => {
    let ok = cache.get(m.chatGuid)
    if (ok === undefined) {
      const chat = db.findChat(m.chatGuid)
      ok = chat !== null && isChatAllowed(cfg, chat)
      cache.set(m.chatGuid, ok)
    }
    return ok
  })
}

function emit(ctx: CommandContext, chat: Chat | null, messages: Message[], cursor: Cursor): void {
  if (ctx.out.json) {
    console.log(jsonOut({ chat, messages, cursor }))
    return
  }
  const c = colors(ctx.out)
  for (const m of messages) {
    const when = c.dim(formatDateTime(m.date).padEnd(12))
    const who = m.isFromMe ? c.green('you') : c.cyan(truncate(m.handle ?? '?', 22))
    const arrow = m.isFromMe ? c.dim('→') : c.dim('←')
    let text = stripNewlines(m.text)
    if (!text && m.hasAttachments) text = c.dim('[attachment]')
    if (!ctx.out.noTrunc) text = truncate(text, Math.max(20, ctx.out.width - 50))
    console.log(`${when} ${arrow} ${padRight(who, 22)} ${text}`)
  }
  console.log(c.dim(`cursor: rowid=${cursor.rowid}`))
}
