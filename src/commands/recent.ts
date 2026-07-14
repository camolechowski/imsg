import { IMsgDb } from '../db'
import {
  colors,
  formatDateTime,
  jsonOut,
  padRight,
  stripNewlines,
  truncate,
} from '../format'
import { getInt, getString, normalizeHandle, parseSince } from '../parse'
import { hasRenderableContent, type CommandContext } from '../types'

export function handleRecent(ctx: CommandContext): void {
  const limit = getInt(ctx.flags, 'limit', 30) ?? 30
  const since = parseSince(getString(ctx.flags, 'since')) ?? new Date(Date.now() - 24 * 3_600_000)
  const fromRaw = getString(ctx.flags, 'from')
  const fromHandle = fromRaw ? normalizeHandle(fromRaw) : undefined
  const meOnly = ctx.flags.me === true

  const db = new IMsgDb()
  try {
    const messages = db.recent({ limit: limit * 2, since, fromHandle })
    const filtered = (meOnly ? messages.filter(m => m.isFromMe) : messages).filter(hasRenderableContent)
    const out = filtered.slice(0, limit)

    if (ctx.out.json) {
      console.log(jsonOut(out))
      return
    }
    const c = colors(ctx.out)
    if (out.length === 0) {
      console.log(c.dim('(no recent messages)'))
      return
    }
    for (const m of out) {
      const when = c.dim(formatDateTime(m.date).padEnd(12))
      const who = m.isFromMe ? c.green('you') : c.cyan(truncate(m.handle ?? '?', 22))
      const arrow = m.isFromMe ? c.dim('→') : c.dim('←')
      let text = stripNewlines(m.text)
      if (!text && m.hasAttachments) text = c.dim('[attachment]')
      if (!ctx.out.noTrunc) text = truncate(text, Math.max(20, ctx.out.width - 50))
      console.log(`${when} ${arrow} ${padRight(who, 22)} ${text}`)
    }
  } finally {
    db.close()
  }
}
