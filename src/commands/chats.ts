import { IMsgDb } from '../db'
import {
  colors,
  jsonOut,
  relativeTime,
  stripNewlines,
  table,
  truncate,
} from '../format'
import { getInt, getBool } from '../parse'
import type { CommandContext, ChatSummary } from '../types'

export function handleChats(ctx: CommandContext): void {
  const limit = getInt(ctx.flags, 'limit', 25) ?? 25
  const onlyGroups = getBool(ctx.flags, 'groups')
  const onlyDms = getBool(ctx.flags, 'dms')
  const search = typeof ctx.flags.search === 'string' ? ctx.flags.search : undefined

  const db = new IMsgDb()
  try {
    let chats: ChatSummary[] = db.listChats(limit * 3)
    if (onlyGroups) chats = chats.filter(c => c.style === 'group')
    if (onlyDms) chats = chats.filter(c => c.style === 'dm')
    if (search) {
      const q = search.toLowerCase()
      chats = chats.filter(c =>
        c.identifier.toLowerCase().includes(q) ||
        (c.displayName?.toLowerCase().includes(q) ?? false) ||
        c.participants.some(p => p.toLowerCase().includes(q)) ||
        (c.lastText?.toLowerCase().includes(q) ?? false),
      )
    }
    chats = chats.slice(0, limit)

    if (ctx.out.json) {
      console.log(jsonOut(chats))
      return
    }
    if (chats.length === 0) {
      console.log(colors(ctx.out).dim('(no chats)'))
      return
    }

    const c = colors(ctx.out)
    const previewWidth = Math.max(20, Math.min(60, ctx.out.width - 50))
    const rows: string[][] = chats.map(chat => {
      const when = chat.lastMessageAt ? relativeTime(chat.lastMessageAt) : '—'
      const label = chat.displayName ??
        (chat.style === 'group' ? `group(${chat.participants.length})` : chat.identifier)
      const who = chat.style === 'group' ? c.magenta('grp') : c.cyan(serviceTag(chat.service))
      const preview = chat.lastText
        ? (chat.lastFromMe ? c.dim('→ ') : '') + truncate(stripNewlines(chat.lastText), previewWidth)
        : c.dim('(no text)')
      return [
        c.dim(when.padStart(4)),
        who,
        c.bold(truncate(label, 28)),
        preview,
      ]
    })
    console.log(table(rows))
  } finally {
    db.close()
  }
}

function serviceTag(service: string): string {
  if (service === 'iMessage') return 'iM '
  if (service === 'SMS') return 'SMS'
  return service.slice(0, 3).padEnd(3)
}
