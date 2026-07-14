import { IMsgDb } from '../db'
import {
  colors,
  formatDateShort,
  formatTime,
  jsonOut,
  padRight,
  stripNewlines,
  truncate,
} from '../format'
import { getInt, getString, looksLikeChatGuid, normalizeHandle, parseSince } from '../parse'
import { hasRenderableContent, type CommandContext, type Message } from '../types'

export function handleRead(ctx: CommandContext): void {
  const target = ctx.positional[0] ?? getString(ctx.flags, 'chat')
  if (!target) {
    console.error('usage: imsg read <handle|chat-guid> [--limit N] [--since 7d]')
    process.exit(2)
  }
  const limit = getInt(ctx.flags, 'limit', 50) ?? 50
  const since = parseSince(getString(ctx.flags, 'since'))

  const db = new IMsgDb()
  try {
    const lookup = looksLikeChatGuid(target) ? target : normalizeHandle(target)
    const chat = db.findChat(lookup)
    if (!chat) {
      if (ctx.out.json) {
        console.log(jsonOut({ error: 'chat not found', target: lookup }))
      } else {
        console.error(`no chat found for: ${lookup}`)
      }
      process.exit(1)
    }
    const messages = db
      .messages(chat.guid, Math.max(limit * 3, limit), since)
      .filter(hasRenderableContent)
      .slice(-limit)

    if (ctx.out.json) {
      console.log(jsonOut({ chat, messages }))
      return
    }

    const c = colors(ctx.out)
    const header = chat.style === 'group'
      ? `Group ${chat.displayName ? `"${chat.displayName}" ` : ''}(${chat.participants.join(', ')})`
      : `DM with ${chat.participants[0] ?? chat.identifier}`
    console.log(c.bold(header))
    console.log(c.dim(`${chat.guid}  ·  ${chat.service}`))
    console.log()

    if (messages.length === 0) {
      console.log(c.dim('(no visible messages)'))
      return
    }

    let lastDay = ''
    for (const m of messages) {
      const day = m.date.toDateString()
      if (day !== lastDay) {
        console.log(c.dim(`── ${formatDateShort(m.date)} ──`))
        lastDay = day
      }
      printMessage(m, chat.style === 'group', ctx)
    }
  } finally {
    db.close()
  }
}

function printMessage(m: Message, showSender: boolean, ctx: CommandContext): void {
  const c = colors(ctx.out)
  const time = c.dim(formatTime(m.date).padStart(6))
  const who = m.isFromMe
    ? c.green('you')
    : showSender
      ? c.cyan(truncate(m.handle ?? '?', 22))
      : c.cyan('them')
  const arrow = m.isFromMe ? c.dim('→') : c.dim('←')
  let text = stripNewlines(m.text)
  if (!text && m.hasAttachments) text = c.dim('[attachment]')
  if (m.hasAttachments && text) text = `${text}  ${c.dim(`[+${m.attachments.length} att]`)}`
  if (!ctx.out.noTrunc && text.length > ctx.out.width - 30) {
    text = truncate(text, ctx.out.width - 30)
  }
  console.log(`${time}  ${arrow} ${padRight(who, showSender ? 22 : 4)}  ${text}`)
}
