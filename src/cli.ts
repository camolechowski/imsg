#!/usr/bin/env node
// imsg — iMessage CLI for macOS. Reads ~/Library/Messages/chat.db and sends
// via osascript. Requires Full Disk Access for the running terminal.
// Runs on node >= 22.13 or bun.

import { handleChats } from './commands/chats'
import { handleDoctor } from './commands/doctor'
import { handleInfo } from './commands/info'
import { handlePoll } from './commands/poll'
import { handleRead } from './commands/read'
import { handleRecent } from './commands/recent'
import { handleSearch } from './commands/search'
import { handleSend } from './commands/send'
import { handleStream } from './commands/stream'
import { handleWatch } from './commands/watch'
import { makeOut } from './format'
import { getBool, parseArgs } from './parse'
import type { CommandContext } from './types'

const HELP = `imsg — iMessage CLI

Usage:
  imsg <command> [args] [flags]

Commands:
  chats                  List recent conversations
  read <handle|guid>     Read messages from a conversation
  recent                 Recent messages across all chats
  search <query>         Full-text search (last 30d by default)
  send <handle> <text>   Send a message
  watch                  Tail new messages live
  poll [handle|guid]     New messages since a cursor (non-blocking)
  stream                 NDJSON event stream for agent harness monitors
  info                   Show DB status, self addresses
  doctor                 Check permissions & environment
  help                   This screen

Flags:
  -n, --limit N          Result limit
  -s, --since DUR        Time window (e.g. 30s, 5m, 2h, 7d, 1w, 30d, 1y)
  -f, --from HANDLE      Filter by sender handle
      --service iM|SMS   Service filter / send via specific service
      --groups           Only group chats (chats command)
      --dms              Only DM chats (chats command)
      --me               Only my own messages (recent)
      --search STR       Filter chats by name/identifier/last text
      --since-rowid N    Poll cursor (message ROWID)
      --interval MS      Watch/stream poll interval (default 1000)
      --timeout SECS     Watch/stream: exit 124 if no new message in time
      --max-events N     Stream: exit 0 after N message events
      --chat-id N        Stream: filter to one chat (numeric chat id)
      --contains STR     Stream: case-insensitive substring filter on text
      --file PATH        Send a file attachment
      --yes              Confirm send when confirmSend is enabled
      --force            Bypass long-message confirmation on send
      --dry-run          Send commands print but don't execute
  -j, --json             JSON output
      --no-color         Disable ANSI colors
      --no-trunc         Don't truncate text in lists
  -h, --help             Show help

Examples:
  imsg chats -n 10
  imsg read +14085089981 --since 7d
  imsg search "meeting" --since 14d --from cam@example.com
  imsg send +14085089981 "running 5m late"
  imsg send +14085089981 --file ~/Desktop/pic.jpg
  imsg watch +14085089981 --timeout 300 --json
  imsg poll --since-rowid 48291 --json
  imsg stream --from +14085089981 --max-events 1 --timeout 600
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    process.stdout.write(HELP)
    return
  }

  if (process.platform !== 'darwin') {
    console.error(
      'imsg only works on macOS — it reads ~/Library/Messages/chat.db and drives Messages.app via osascript.',
    )
    process.exit(1)
  }

  const parsed = parseArgs(argv.slice(1))
  if (getBool(parsed.flags, 'help')) {
    process.stdout.write(HELP)
    return
  }

  const ctx: CommandContext = {
    argv,
    flags: parsed.flags,
    positional: parsed.positional,
    out: makeOut(
      getBool(parsed.flags, 'json'),
      getBool(parsed.flags, 'no-color'),
      getBool(parsed.flags, 'no-trunc'),
    ),
  }

  try {
    switch (cmd) {
      case 'chats':
      case 'ls':
        handleChats(ctx)
        break
      case 'read':
      case 'r':
        handleRead(ctx)
        break
      case 'recent':
      case 'tail':
        handleRecent(ctx)
        break
      case 'search':
      case 'grep':
        handleSearch(ctx)
        break
      case 'send':
      case 's':
        handleSend(ctx)
        break
      case 'watch':
      case 'w':
        await handleWatch(ctx)
        break
      case 'poll':
        await handlePoll(ctx)
        break
      case 'stream':
      case 'st':
        await handleStream(ctx)
        break
      case 'info':
        handleInfo(ctx)
        break
      case 'doctor':
        await handleDoctor(ctx)
        break
      default:
        console.error(`unknown command: ${cmd}\n`)
        process.stdout.write(HELP)
        process.exit(2)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (ctx.out.json) {
      console.log(JSON.stringify({ error: msg }))
    } else {
      console.error(`imsg: ${msg}`)
    }
    process.exit(1)
  }
}

main()
