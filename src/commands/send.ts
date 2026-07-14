import { IMsgDb } from '../db'
import { colors, jsonOut } from '../format'
import { getBool, getString, looksLikeChatGuid, normalizeHandle } from '../parse'
import { sendByBuddy, sendByChat } from '../send'
import type { CommandContext, SendResult } from '../types'

export function handleSend(ctx: CommandContext): SendResult {
  const target = ctx.positional[0] ?? getString(ctx.flags, 'to') ?? getString(ctx.flags, 'chat')
  // Text can be remaining positionals (joined with spaces) or --text/--message flag.
  const textFromArgs = ctx.positional.slice(1).join(' ')
  const text =
    textFromArgs ||
    (typeof ctx.flags.text === 'string' ? ctx.flags.text : '') ||
    (typeof ctx.flags.message === 'string' ? ctx.flags.message : '')
  const dryRun = getBool(ctx.flags, 'dry-run')
  const force = getBool(ctx.flags, 'force')
  const serviceFlag = getString(ctx.flags, 'service')
  const wantSMS = serviceFlag?.toUpperCase() === 'SMS'

  if (!target || !text) {
    console.error('usage: imsg send <handle|chat-guid> <text>  (or --to / --text)')
    process.exit(2)
  }

  // Confirmation gate: pasted long messages or unfamiliar destinations should
  // not fire silently. Skip with --force.
  if (!force && !ctx.out.json && process.stdout.isTTY && text.length > 500) {
    const c = colors(ctx.out)
    console.error(c.yellow(`Message is ${text.length} chars. Re-run with --force to send.`))
    process.exit(1)
  }

  let chatGuid: string | undefined
  let recipient = target
  let via: SendResult['via'] = 'chat-id'

  if (looksLikeChatGuid(target)) {
    chatGuid = target
  } else {
    const handle = normalizeHandle(target)
    recipient = handle
    // Best-effort chat lookup. If chat.db is unreadable (no FDA), fall back to
    // buddy mode — Messages.app Automation permission is the only requirement
    // for sending, separate from FDA on chat.db.
    try {
      const db = new IMsgDb()
      try {
        const chat = db.findChat(handle)
        if (chat) chatGuid = chat.guid
      } finally {
        db.close()
      }
    } catch {
      // FDA missing or db locked; proceed via buddy.
    }
    if (!chatGuid) via = 'buddy'
  }

  const result = chatGuid
    ? sendByChat(chatGuid, text, { dryRun })
    : sendByBuddy(recipient, text, wantSMS ? 'SMS' : 'iMessage', { dryRun })

  const out: SendResult = {
    ok: result.ok,
    chatGuid,
    recipient,
    via: result.via,
    text,
    chunks: result.chunks,
    error: result.error,
  }

  if (ctx.out.json) {
    console.log(jsonOut(out))
  } else {
    const c = colors(ctx.out)
    if (result.ok) {
      const tag = via === 'chat-id' ? c.dim(`(chat ${chatGuid?.slice(-8)})`) : c.dim('(new buddy)')
      console.log(`${c.green('✓')} sent to ${c.bold(recipient)} ${tag}  ${c.dim(`${result.chunks} chunk${result.chunks === 1 ? '' : 's'}`)}`)
    } else {
      console.log(`${c.red('✗')} failed: ${result.error ?? '(unknown)'}`)
    }
  }

  if (!result.ok) process.exit(1)
  return out
}
