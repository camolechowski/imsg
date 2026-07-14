import { IMsgDb } from '../db'
import {
  colors,
  formatDateTime,
  highlight,
  jsonOut,
  snippet,
  truncate,
} from '../format'
import { getInt, getString, normalizeHandle, parseSince } from '../parse'
import type { CommandContext, SearchHit, ChatStyle } from '../types'

export function handleSearch(ctx: CommandContext): void {
  const query = ctx.positional[0]
  if (!query) {
    console.error('usage: imsg search <query> [--from HANDLE] [--since 30d] [--limit N]')
    process.exit(2)
  }
  const limit = getInt(ctx.flags, 'limit', 30) ?? 30
  const since = parseSince(getString(ctx.flags, 'since'))
  const fromRaw = getString(ctx.flags, 'from')
  const fromHandle = fromRaw ? normalizeHandle(fromRaw) : undefined

  const db = new IMsgDb()
  try {
    const messages = db.search(query, { limit, since, fromHandle })
    const chatCache = new Map<string, ReturnType<typeof db.findChat>>()
    const hits: SearchHit[] = messages.map(m => {
      let chat = chatCache.get(m.chatGuid)
      if (chat === undefined) {
        chat = db.findChat(m.chatGuid)
        chatCache.set(m.chatGuid, chat)
      }
      const style: ChatStyle = chat?.style ?? 'dm'
      return {
        message: m,
        chat: {
          guid: m.chatGuid,
          identifier: chat?.identifier ?? m.chatGuid,
          displayName: chat?.displayName ?? null,
          style,
        },
        snippet: snippet(m.text, query),
      }
    })

    if (ctx.out.json) {
      console.log(jsonOut(hits))
      return
    }

    const c = colors(ctx.out)
    if (hits.length === 0) {
      console.log(c.dim(`(no matches for "${query}")`))
      return
    }
    console.log(c.dim(`${hits.length} match${hits.length === 1 ? '' : 'es'} for "${query}"`))
    console.log()

    for (const hit of hits) {
      const when = c.dim(formatDateTime(hit.message.date))
      const who = hit.message.isFromMe
        ? c.green('you')
        : c.cyan(truncate(hit.message.handle ?? '?', 22))
      const where = hit.chat.style === 'group'
        ? c.magenta(hit.chat.displayName ?? `group(${hit.chat.guid.slice(-8)})`)
        : c.cyan(hit.chat.identifier)
      const text = highlight(hit.snippet, query, c.yellow)
      console.log(`${when}  ${where}  ${who}: ${text}`)
    }
  } finally {
    db.close()
  }
}
