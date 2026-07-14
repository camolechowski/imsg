import { EXIT, isChatAllowed, loadConfig } from '../config'
import { IMsgDb } from '../db'
import { colors, formatTime, jsonOut, padRight, stripNewlines, truncate } from '../format'
import { getInt, looksLikeChatGuid, normalizeHandle } from '../parse'
import { hasRenderableContent, type Chat, type CommandContext, type Message } from '../types'

export async function handleWatch(ctx: CommandContext): Promise<void> {
  const intervalMs = getInt(ctx.flags, 'interval', 1000) ?? 1000
  const timeoutSec = getInt(ctx.flags, 'timeout')
  const target = ctx.positional[0]
  const cfg = loadConfig()
  const db = new IMsgDb()

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

  let watermark = db.watermark()
  const allowCache = new Map<string, boolean>()
  const allowed = (m: Message): boolean => {
    if (chat || !cfg?.allowlist) return true
    let ok = allowCache.get(m.chatGuid)
    if (ok === undefined) {
      const mChat = db.findChat(m.chatGuid)
      ok = mChat !== null && isChatAllowed(cfg, mChat)
      allowCache.set(m.chatGuid, ok)
    }
    return ok
  }

  const c = colors(ctx.out)
  if (!ctx.out.json) {
    const mode = timeoutSec !== undefined ? `timeout=${timeoutSec}s` : 'Ctrl+C to exit'
    console.log(c.dim(`watching from rowid=${watermark} (interval=${intervalMs}ms, ${mode})`))
  }

  const stop = () => {
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  if (timeoutSec !== undefined) {
    const deadline = Date.now() + timeoutSec * 1000
    while (Date.now() < deadline) {
      const rows = db.pollSinceRowid(watermark, chat?.guid)
      const hits: Message[] = []
      let last: Message | undefined
      for (const m of rows) {
        watermark = Math.max(watermark, m.rowid)
        last = m
        if (!allowed(m) || !hasRenderableContent(m)) continue
        hits.push(m)
      }
      if (hits.length > 0) {
        const cursor = { rowid: watermark, ts: (last?.date ?? new Date()).toISOString() }
        if (ctx.out.json) {
          console.log(jsonOut({ chat, messages: hits, cursor }))
        } else {
          for (const m of hits) printMessage(m, ctx)
        }
        db.close()
        process.exit(EXIT.OK)
      }
      await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
    }
    if (ctx.out.json) {
      console.log(jsonOut({ chat, messages: [], cursor: { rowid: watermark, ts: new Date().toISOString() } }))
    } else {
      console.error(c.dim('(timeout)'))
    }
    db.close()
    process.exit(EXIT.TIMEOUT)
  }

  while (true) {
    const newRows = db.pollSinceRowid(watermark, chat?.guid)
    for (const m of newRows) {
      watermark = Math.max(watermark, m.rowid)
      if (!allowed(m) || !hasRenderableContent(m)) continue
      printMessage(m, ctx)
    }
    await sleep(intervalMs)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function printMessage(m: Message, ctx: CommandContext): void {
  if (ctx.out.json) {
    console.log(jsonOut(m))
    return
  }
  const c = colors(ctx.out)
  const when = c.dim(formatTime(m.date))
  const who = m.isFromMe ? c.green('you') : c.cyan(truncate(m.handle ?? '?', 22))
  const arrow = m.isFromMe ? c.dim('→') : c.dim('←')
  let text = stripNewlines(m.text)
  if (!text && m.hasAttachments) text = c.dim('[attachment]')
  if (!ctx.out.noTrunc) text = truncate(text, Math.max(20, ctx.out.width - 50))
  console.log(`${when}  ${arrow} ${padRight(who, 22)} ${text}`)
}
