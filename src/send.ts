// Outbound send via osascript → Messages.app. Two modes:
//   - chat: send to an existing chat by GUID (most reliable)
//   - buddy: send to a handle (phone/email) on a specific service (creates or
//            reuses the buddy's existing thread)
// Both pass user content through argv, never interpolated into the script.

import { spawnSync } from 'child_process'

const SCRIPT_BY_CHAT = `on run argv
  tell application "Messages" to send (item 1 of argv) to chat id (item 2 of argv)
end run`

const SCRIPT_BY_BUDDY = `on run argv
  set targetText to item 1 of argv
  set targetHandle to item 2 of argv
  set serviceType to item 3 of argv
  tell application "Messages"
    if serviceType is "SMS" then
      set targetService to 1st service whose service type is SMS
    else
      set targetService to 1st service whose service type is iMessage
    end if
    set targetBuddy to buddy targetHandle of targetService
    send targetText to targetBuddy
  end tell
end run`

const SCRIPT_FILE_BY_CHAT = `on run argv
  tell application "Messages" to send (POSIX file (item 1 of argv)) to chat id (item 2 of argv)
end run`

const SCRIPT_FILE_BY_BUDDY = `on run argv
  set targetFile to POSIX file (item 1 of argv)
  set targetHandle to item 2 of argv
  set serviceType to item 3 of argv
  tell application "Messages"
    if serviceType is "SMS" then
      set targetService to 1st service whose service type is SMS
    else
      set targetService to 1st service whose service type is iMessage
    end if
    set targetBuddy to buddy targetHandle of targetService
    send targetFile to targetBuddy
  end tell
end run`

export interface SendOptions {
  /** Chunk size cap; long texts are split before sending. */
  chunkLimit?: number
  /** Prefer breaking on whitespace boundaries instead of hard cutoff. */
  chunkOnNewline?: boolean
  /** Optional dry run: format the AppleScript invocation but don't run it. */
  dryRun?: boolean
}

export interface SendOutcome {
  ok: boolean
  via: 'chat-id' | 'buddy'
  chunks: number
  error?: string
}

export function sendByChat(chatGuid: string, text: string, opts: SendOptions = {}): SendOutcome {
  const limit = opts.chunkLimit ?? 8000
  const chunks = chunk(text, limit, opts.chunkOnNewline ?? true)
  if (opts.dryRun) {
    process.stderr.write(`[dry-run] chat=${chatGuid} chunks=${chunks.length}\n`)
    return { ok: true, via: 'chat-id', chunks: chunks.length }
  }
  for (const part of chunks) {
    const res = spawnSync('osascript', ['-', part, chatGuid], {
      input: SCRIPT_BY_CHAT,
      encoding: 'utf8',
    })
    if (res.status !== 0) {
      return {
        ok: false,
        via: 'chat-id',
        chunks: chunks.length,
        error: res.stderr.trim() || `osascript exit ${res.status}`,
      }
    }
  }
  return { ok: true, via: 'chat-id', chunks: chunks.length }
}

export function sendByBuddy(
  handle: string,
  text: string,
  service: 'iMessage' | 'SMS' = 'iMessage',
  opts: SendOptions = {},
): SendOutcome {
  const limit = opts.chunkLimit ?? 8000
  const chunks = chunk(text, limit, opts.chunkOnNewline ?? true)
  if (opts.dryRun) {
    process.stderr.write(`[dry-run] buddy=${handle} service=${service} chunks=${chunks.length}\n`)
    return { ok: true, via: 'buddy', chunks: chunks.length }
  }
  for (const part of chunks) {
    const res = spawnSync('osascript', ['-', part, handle, service], {
      input: SCRIPT_BY_BUDDY,
      encoding: 'utf8',
    })
    if (res.status !== 0) {
      return {
        ok: false,
        via: 'buddy',
        chunks: chunks.length,
        error: res.stderr.trim() || `osascript exit ${res.status}`,
      }
    }
  }
  return { ok: true, via: 'buddy', chunks: chunks.length }
}

export function sendFileByChat(chatGuid: string, filePath: string, opts: SendOptions = {}): SendOutcome {
  if (opts.dryRun) {
    process.stderr.write(`[dry-run] file=${filePath} chat=${chatGuid}\n`)
    return { ok: true, via: 'chat-id', chunks: 1 }
  }
  const res = spawnSync('osascript', ['-', filePath, chatGuid], {
    input: SCRIPT_FILE_BY_CHAT,
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    return {
      ok: false,
      via: 'chat-id',
      chunks: 1,
      error: res.stderr.trim() || `osascript exit ${res.status}`,
    }
  }
  return { ok: true, via: 'chat-id', chunks: 1 }
}

export function sendFileByBuddy(
  handle: string,
  filePath: string,
  service: 'iMessage' | 'SMS' = 'iMessage',
  opts: SendOptions = {},
): SendOutcome {
  if (opts.dryRun) {
    process.stderr.write(`[dry-run] file=${filePath} buddy=${handle} service=${service}\n`)
    return { ok: true, via: 'buddy', chunks: 1 }
  }
  const res = spawnSync('osascript', ['-', filePath, handle, service], {
    input: SCRIPT_FILE_BY_BUDDY,
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    return {
      ok: false,
      via: 'buddy',
      chunks: 1,
      error: res.stderr.trim() || `osascript exit ${res.status}`,
    }
  }
  return { ok: true, via: 'buddy', chunks: 1 }
}

function chunk(text: string, limit: number, onNewline: boolean): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = limit
    if (onNewline) {
      const para = rest.lastIndexOf('\n\n', limit)
      const line = rest.lastIndexOf('\n', limit)
      const space = rest.lastIndexOf(' ', limit)
      cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit
    }
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}
