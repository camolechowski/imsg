import { IMsgDb } from '../db'
import { colors, formatTime, jsonOut, padRight, stripNewlines, truncate } from '../format'
import { getInt } from '../parse'
import { hasRenderableContent, type CommandContext, type Message } from '../types'

export async function handleWatch(ctx: CommandContext): Promise<void> {
  const intervalMs = getInt(ctx.flags, 'interval', 1000) ?? 1000
  const db = new IMsgDb()
  let watermark = db.watermark()

  const c = colors(ctx.out)
  if (!ctx.out.json) {
    console.log(c.dim(`watching from rowid=${watermark} (interval=${intervalMs}ms, Ctrl+C to exit)`))
  }

  const stop = () => {
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  while (true) {
    const newRows = db.pollSince(watermark)
    for (const m of newRows) {
      watermark = Math.max(watermark, m.rowid)
      if (!hasRenderableContent(m)) continue
      printMessage(m, ctx)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
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
