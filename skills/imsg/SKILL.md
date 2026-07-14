---
name: imsg
description: Read, search, send, poll, and wait on iMessages on macOS via the imsg CLI. Use when asked to check texts/iMessages, message someone, wait for a reply, send a file over iMessage, or monitor a conversation from a script or agent. Requires macOS with Full Disk Access granted to the terminal.
---

# imsg — iMessage CLI for agents

## When to use

- Reading, searching, or summarizing iMessage conversations on this Mac.
- Sending a text or file attachment to a handle (phone/email) or chat GUID.
- Waiting for a reply (blocking `watch --timeout` or non-blocking `poll` loop).

## When NOT to use

- Non-macOS systems (the CLI reads `~/Library/Messages/chat.db` and drives Messages.app).
- Group MMS edge cases (RCS/MMS group behavior is not guaranteed).
- Anything requiring message deletion or editing — the db is opened read-only.

## Agent rules

- Always pass `--json`. It is the stable machine contract: no ANSI, ISO dates,
  fixed field names. Never parse human output.
- Branch on exit codes:

| Code | Meaning |
|-|-|
| 0 | success / new messages |
| 1 | error (bad target, missing file, unreadable db, invalid config) |
| 2 | usage error OR blocked by safety policy (JSON has `error` + `blocked: true` when policy-blocked) |
| 3 | poll: no new messages |
| 124 | watch: timed out with no new message |

- Disambiguate exit 2 via stdout: policy blocks emit `{"error": "...", "blocked": true}`;
  usage errors print a usage line to stderr.

## Wait-for-reply loop (poll + cursor)

Bootstrap once (returns the current cursor, exit 3, no messages):

```sh
imsg poll --json
# => { "chat": null, "messages": [], "cursor": { "rowid": 48291, "ts": "..." } }
```

Then loop: sleep N seconds, poll from the saved cursor, scoped to the handle you
are waiting on:

```sh
imsg poll +14085551234 --since-rowid 48291 --json
```

- Exit 0: new messages — process `messages[]`, save the new `cursor.rowid`.
- Exit 3: nothing yet — keep waiting with the same cursor.
- The cursor never re-emits a message and never skips one; when `--limit`
  truncates, the cursor points at the last emitted message so the next call
  resumes exactly there.

Alternative single blocking wait:

```sh
imsg watch +14085551234 --timeout 300 --json
```

- Exit 0: stdout is one `{ chat, messages, cursor }` object with the new messages.
- Exit 124: timed out; `messages` is empty, `cursor` is current.

## Monitoring / waiting for messages

For agent harnesses that watch a background process's output rather than
polling a script, use `imsg stream` — a long-running NDJSON event stream
(one JSON object per stdout line, no ANSI, no human formatting):

```sh
imsg stream --from +14085551234 --max-events 1 --timeout 600
```

Run it as a background command and watch stdout for the `"type":"message"`
line: in Claude Code, the Monitor tool watching the background shell's
stdout; in other harnesses, tail the background process's output until a
matching line appears or the process exits. Exits 0 once `--max-events` is
hit, 124 on `--timeout` with no match, 2 if policy-blocked. See
[references/commands.md](references/commands.md) for the full event schema.

## Send safety

- Confirm the recipient handle with the user before any real send.
- Optional advanced config at `~/.config/imsg/config.json` can restrict imsg
  to an allowlist of handles/chats (`{ "allowlist": [...], "confirmSend": true }`);
  by default (no config file) everything is unrestricted. When a block does
  occur (exit 2, `blocked: true`), surface it to the user — do NOT retry or
  work around it.
- When `confirmSend` is enabled, sends require `--yes`.
- Use `--dry-run` to validate a send with zero side effects (works with text and files).
- Messages over 500 chars require `--force` in interactive human mode.

## Attachments

Send a file (with or without text):

```sh
imsg send +14085551234 --file /absolute/path/pic.jpg --json
imsg send +14085551234 "see attached" --file ~/Desktop/doc.pdf --json
```

Incoming attachments appear in `read`/`recent`/`poll`/`watch` JSON as:

```json
"attachments": [{ "filename": "~/Library/Messages/Attachments/...", "mimeType": "image/heic", "transferName": "IMG_0001.heic", "resolvedPath": "/Users/me/Library/Messages/Attachments/..." }]
```

`resolvedPath` is the absolute on-disk path (may be null if not downloaded).

## Troubleshooting

Run `imsg doctor --json` first. Five checks: chat.db access, osascript,
Messages.app, runtime, config.

- `chat.db access` failing = the terminal lacks Full Disk Access
  (System Settings > Privacy & Security > Full Disk Access, then restart the terminal).
- `osascript` failing or send errors = Automation permission for Messages.app
  not granted (System Settings > Privacy & Security > Automation).
- Env overrides: `IMESSAGE_DB_PATH` (alternate chat.db), `IMSG_CONFIG_PATH`
  (alternate safety config).

Full command/flag/exit-code and JSON-shape reference: [references/commands.md](references/commands.md).
