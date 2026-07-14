// NDJSON event stream for agent harness monitors. Stdout carries only event
// lines (one JSON object per line); logs/errors go to stderr, no ANSI ever.

import { EXIT, isChatAllowed, loadConfig } from '../config'
import { IMsgDb } from '../db'
import { getInt, getString, looksLikeChatGuid, normalizeHandle } from '../parse'
import { hasRenderableContent, type Chat, type CommandContext, type Message } from '../types'

export async function handleStream(ctx: CommandContext): Promise<void> {
  const intervalMs = getInt(ctx.flags, 'interval', 1000) ?? 1000
  const timeoutSec = getInt(ctx.flags, 'timeout')
  const maxEvents = getInt(ctx.flags, 'max-events')
  const chatId = getInt(ctx.flags, 'chat-id')
  const contains = getString(ctx.flags, 'contains')?.toLowerCase()
  const fromFilter = getRepeatable(ctx.argv, 'from', '-f').map(h => normalizeFrom(h))
  const target = ctx.positional[0]
  const cfg = loadConfig()
  const db = new IMsgDb()

  let chat: Chat | null = null
  if (target) {
    const lookup = looksLikeChatGuid(target) ? target : normalizeHandle(target)
    chat = db.findChat(lookup)
    if (!chat) {
      console.error(`no chat found for: ${lookup}`)
      db.close()
      process.exit(EXIT.ERROR)
    }
    if (!isChatAllowed(cfg, chat)) {
      console.error('imsg: chat blocked by allowlist')
      db.close()
      process.exit(EXIT.BLOCKED)
    }
  }

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

  const matchesFilters = (m: Message): boolean => {
    if (!allowed(m) || !hasRenderableContent(m)) return false
    if (chatId !== undefined && m.chatId !== chatId) return false
    if (contains && !m.text.toLowerCase().includes(contains)) return false
    if (fromFilter.length > 0) {
      const from = normalizeFrom(m.isFromMe ? 'me' : (m.handle ?? ''))
      if (!fromFilter.includes(from)) return false
    }
    return true
  }

  let watermark = db.watermark()
  console.log(JSON.stringify({ type: 'ready', cursor: { rowid: watermark, ts: new Date().toISOString() } }))

  const stop = (code: number) => {
    db.close()
    process.exit(code)
  }
  process.on('SIGINT', () => stop(EXIT.OK))
  process.on('SIGTERM', () => stop(EXIT.OK))

  const deadline = timeoutSec !== undefined ? Date.now() + timeoutSec * 1000 : undefined
  let emitted = 0

  while (true) {
    const rows = db.pollSinceRowid(watermark, chat?.guid)
    for (const m of rows) {
      watermark = Math.max(watermark, m.rowid)
      if (!matchesFilters(m)) continue
      emitMessage(m)
      emitted++
      if (maxEvents !== undefined && emitted >= maxEvents) {
        db.close()
        process.exit(EXIT.OK)
      }
    }
    if (deadline !== undefined && Date.now() >= deadline) {
      db.close()
      process.exit(EXIT.TIMEOUT)
    }
    const wait = deadline !== undefined ? Math.min(intervalMs, Math.max(0, deadline - Date.now())) : intervalMs
    await sleep(wait)
  }
}

function emitMessage(m: Message): void {
  console.log(
    JSON.stringify({
      type: 'message',
      rowid: m.rowid,
      ts: m.date.toISOString(),
      chatId: m.chatId,
      chat: m.chatName,
      from: m.isFromMe ? 'me' : (m.handle ?? '?'),
      isFromMe: m.isFromMe,
      text: m.text,
      attachments: m.attachments,
    }),
  )
}

function normalizeFrom(v: string): string {
  return v.toLowerCase() === 'me' ? 'me' : normalizeHandle(v).toLowerCase()
}

function getRepeatable(argv: string[], key: string, shortAlias?: string): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === `--${key}` || a === shortAlias) {
      const v = argv[i + 1]
      if (v !== undefined && !v.startsWith('-')) {
        out.push(v)
        i++
      }
    } else if (a.startsWith(`--${key}=`)) {
      out.push(a.slice(key.length + 3))
    }
  }
  return out.flatMap(s => s.split(',').map(x => x.trim()).filter(Boolean))
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
