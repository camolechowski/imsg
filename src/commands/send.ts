import { existsSync } from 'fs'
import { homedir } from 'os'
import { basename, resolve } from 'path'
import { IMsgDb } from '../db'
import { colors, jsonOut } from '../format'
import { getBool, getString, looksLikeChatGuid, normalizeHandle } from '../parse'
import { sendByBuddy, sendByChat, sendFileByBuddy, sendFileByChat, type SendOutcome } from '../send'
import type { CommandContext, SendResult } from '../types'

export function handleSend(ctx: CommandContext): SendResult {
  const target = ctx.positional[0] ?? getString(ctx.flags, 'to') ?? getString(ctx.flags, 'chat')
  // Text can be remaining positionals (joined with spaces) or --text/--message flag.
  const textFromArgs = ctx.positional.slice(1).join(' ')
  const text =
    textFromArgs ||
    (typeof ctx.flags.text === 'string' ? ctx.flags.text : '') ||
    (typeof ctx.flags.message === 'string' ? ctx.flags.message : '')
  const fileFlag = getString(ctx.flags, 'file')
  const dryRun = getBool(ctx.flags, 'dry-run')
  const force = getBool(ctx.flags, 'force')
  const serviceFlag = getString(ctx.flags, 'service')
  const wantSMS = serviceFlag?.toUpperCase() === 'SMS'

  if (!target || (!text && !fileFlag)) {
    console.error('usage: imsg send <handle|chat-guid> [text] [--file PATH]  (or --to / --text)')
    process.exit(2)
  }

  let filePath: string | undefined
  if (fileFlag) {
    filePath = resolve(fileFlag.startsWith('~/') ? homedir() + fileFlag.slice(1) : fileFlag)
    if (!existsSync(filePath)) {
      if (ctx.out.json) {
        console.log(JSON.stringify({ error: 'file not found', file: filePath }))
      } else {
        console.error(`imsg: file not found: ${filePath}`)
      }
      process.exit(1)
    }
  }

  // Confirmation gate: pasted long messages or unfamiliar destinations should
  // not fire silently. Skip with --force. Applies to text only, not file sends.
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

  // Text first (if any), then the file. First failure wins.
  let result: SendOutcome | undefined
  if (text) {
    result = chatGuid
      ? sendByChat(chatGuid, text, { dryRun })
      : sendByBuddy(recipient, text, wantSMS ? 'SMS' : 'iMessage', { dryRun })
  }
  let fileResult: SendOutcome | undefined
  if (filePath && (result?.ok ?? true)) {
    fileResult = chatGuid
      ? sendFileByChat(chatGuid, filePath, { dryRun })
      : sendFileByBuddy(recipient, filePath, wantSMS ? 'SMS' : 'iMessage', { dryRun })
  }
  const combined: SendOutcome = {
    ok: (result?.ok ?? true) && (fileResult?.ok ?? true),
    via: (result ?? fileResult)?.via ?? via,
    chunks: result?.chunks ?? 0,
    error: result?.error ?? fileResult?.error,
  }

  const out: SendResult = {
    ok: combined.ok,
    chatGuid,
    recipient,
    via: combined.via,
    text,
    chunks: combined.chunks,
    error: combined.error,
  }

  if (ctx.out.json) {
    console.log(jsonOut({ ...out, file: filePath ?? null }))
  } else {
    const c = colors(ctx.out)
    if (combined.ok) {
      const tag = combined.via === 'chat-id' ? c.dim(`(chat ${chatGuid?.slice(-8)})`) : c.dim('(new buddy)')
      const fileTag = fileResult?.ok && filePath ? `  ${c.dim(`[+file ${basename(filePath)}]`)}` : ''
      console.log(`${c.green('✓')} sent to ${c.bold(recipient)} ${tag}  ${c.dim(`${combined.chunks} chunk${combined.chunks === 1 ? '' : 's'}`)}${fileTag}`)
    } else {
      console.log(`${c.red('✗')} failed: ${combined.error ?? '(unknown)'}`)
    }
  }

  if (!combined.ok) process.exit(1)
  return out
}
