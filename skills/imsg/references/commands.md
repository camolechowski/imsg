# imsg command reference

Binary: `imsg` (npm package `imsg-cli`). Runs on node >= 22.13 or bun. macOS only.

## Exit codes

| Code | Meaning |
|-|-|
| 0 | success / new messages |
| 1 | error (chat not found, file not found, unreadable db, invalid config, failed send) |
| 2 | usage error OR blocked by safety policy (allowlist / confirmSend) |
| 3 | poll: no new messages since cursor |
| 124 | watch --timeout: deadline passed with no new message |

Policy blocks always emit `{"error": "...", "blocked": true}` on stdout in
`--json` mode and leak no message content.

## Environment variables

| Var | Effect |
|-|-|
| `IMESSAGE_DB_PATH` | Path to chat.db (default `~/Library/Messages/chat.db`) |
| `IMSG_CONFIG_PATH` | Path to safety config (default `~/.config/imsg/config.json`) |

## Global flags

| Flag | Meaning |
|-|-|
| `-j, --json` | JSON output (stable machine contract, ISO dates, no ANSI) |
| `--no-color` | Disable ANSI colors in human output |
| `--no-trunc` | Do not truncate text in lists |
| `-n, --limit N` | Result limit |
| `-s, --since DUR` | Time window: `30s`, `5m`, `2h`, `7d`, `1w`, `30d`, `1y`, or ISO date |
| `-f, --from HANDLE` | Filter by sender handle |
| `-h, --help` | Help |

## Commands

### `imsg chats` (alias `ls`)

List recent conversations. Flags: `-n/--limit` (default 25), `--groups`,
`--dms`, `--search STR` (matches name/identifier/participants/last text).

JSON: array of ChatSummary:

```json
{ "guid": "iMessage;-;+14085551234", "identifier": "+14085551234", "displayName": null,
  "style": "dm", "service": "iMessage", "participants": ["+14085551234"],
  "lastMessageAt": "2026-07-14T17:44:08.441Z", "lastText": "...", "lastFromMe": false,
  "messageCount": 812 }
```

`style` is `"dm"` or `"group"`.

### `imsg read <handle|chat-guid>` (alias `r`)

Messages from one conversation. Flags: `-n/--limit` (default 50), `-s/--since`.
Also accepts `--chat GUID` instead of the positional.

JSON: `{ "chat": Chat, "messages": Message[] }`

Message shape (shared by read/recent/poll/watch/search):

```json
{ "rowid": 48291, "guid": "...", "text": "hello", "date": "2026-07-14T17:44:08.441Z",
  "isFromMe": false, "handle": "+14085551234", "service": "iMessage",
  "chatGuid": "iMessage;-;+14085551234", "chatId": 7, "chatName": "+14085551234",
  "hasAttachments": true,
  "attachments": [{ "filename": "~/Library/Messages/Attachments/ab/cd/IMG_0001.heic",
                    "mimeType": "image/heic", "transferName": "IMG_0001.heic",
                    "resolvedPath": "/Users/me/Library/Messages/Attachments/ab/cd/IMG_0001.heic" }],
  "account": "E:me@example.com" }
```

Exit 1 with `{"error": "chat not found", "target": "..."}` if the target does not resolve.

### `imsg recent` (alias `tail`)

Recent messages across all chats. Flags: `-n/--limit` (default 30),
`-s/--since` (default 24h), `-f/--from HANDLE`, `--me` (only your own).

JSON: `Message[]`.

### `imsg search <query>` (alias `grep`)

Full-text search, last 30d by default. Flags: `-n/--limit` (default 30),
`-s/--since`, `-f/--from`.

JSON: array of SearchHit:

```json
{ "message": Message,
  "chat": { "guid": "...", "identifier": "...", "displayName": null, "style": "dm" },
  "snippet": "…text around the match…" }
```

### `imsg send <handle|chat-guid> [text]` (alias `s`)

Send a message and/or file. Flags: `--file PATH` (attachment; text becomes
optional), `--service SMS` (force SMS buddy path), `--dry-run` (no osascript,
prints `[dry-run]` notices to stderr), `--force` (bypass >500-char confirmation),
`--yes` (satisfy `confirmSend`), `--to HANDLE` / `--text STR` / `--message STR`
(flag alternatives to positionals).

JSON (SendResult + file):

```json
{ "ok": true, "chatGuid": "iMessage;-;+14085551234", "recipient": "+14085551234",
  "via": "chat-id", "text": "hello", "chunks": 1, "file": "/abs/path.jpg" }
```

`via` is `"chat-id"` (existing thread) or `"buddy"` (no existing thread; creates one).
`file` is the absolute path or null. On failure `ok: false` + `error`, exit 1.
Missing `--file` path: exit 1 before any send. Neither text nor file: exit 2 (usage).

Safety gates (in order, before anything else runs): allowlist block -> exit 2;
`confirmSend` without `--yes` -> exit 2. Both apply to `--dry-run` too.

### `imsg poll [handle|chat-guid]`

Non-blocking: new messages since a cursor. Flags: `--since-rowid N` (preferred
cursor; wins over `--since`), `-s/--since TS|DUR`, `-n/--limit N` (default 500).

- No cursor flag: bootstrap. Emits `messages: []` and the current watermark
  cursor, exit 3.
- Exit 0 when >= 1 message emitted, 3 when none, 2 when the scoped chat is
  blocked by allowlist, 1 on error.
- Unscoped poll with an allowlist configured silently filters to allowed chats.
- Cursor: max fetched rowid; when `--limit` truncates, the last emitted rowid
  (no loss, no re-emission).

JSON:

```json
{ "chat": Chat | null, "messages": Message[], "cursor": { "rowid": 48291, "ts": "2026-07-14T17:50:14.764Z" } }
```

### `imsg watch [handle|chat-guid]` (alias `w`)

Tail new messages. Flags: `--interval MS` (default 1000), `--timeout SECS`.

- Without `--timeout`: runs forever, prints each renderable message
  (JSON mode: one Message object per line). Ctrl+C to exit.
- With `--timeout SECS`: single-shot wait. First batch with >= 1 renderable
  message -> prints poll-shaped `{ chat, messages, cursor }` (JSON mode) and
  exits 0. Deadline passed -> `{ chat, messages: [], cursor }` and exit 124.
- Scoped target failing the allowlist exits 2 immediately; unscoped watch with
  an allowlist skips non-allowed chats.

### `imsg stream [handle|chat-guid]` (alias `st`)

Long-running NDJSON event stream on stdout for agent harness monitors
(Claude Code Monitor tool, Codex shell loops, or anything that tails a
background process's output). Stdout carries only event lines — no ANSI, no
human formatting, `--json` is implied/no-op. Logs and errors go to stderr.

Flags:

| Flag | Meaning |
|-|-|
| `--interval MS` | Poll interval (default 1000) |
| `--timeout SECS` | Exit 124 if the deadline passes (checked independently of `--max-events`) |
| `--max-events N` | Exit 0 after N `"message"` events |
| `--from HANDLE` | Filter by sender; repeatable and/or comma-separated, any match. Use `me` to match your own outbound messages. |
| `--chat-id N` | Filter to one chat by its numeric chat id (see the `chatId` field below) |
| `--contains STR` | Case-insensitive substring filter on message text |

Outbound (`is_from_me`) messages are included by default when no `--from`
filter is given.

On start, emits one `ready` line at the current watermark, then polls for
new messages using the same rowid-cursor machinery as `poll`/`watch`.

Event schema (one JSON object per line):

```json
{"type":"ready","cursor":{"rowid":48291,"ts":"2026-07-14T17:50:14.764Z"}}
{"type":"message","rowid":48292,"ts":"2026-07-14T17:50:20.111Z","chatId":7,
 "chat":"+14085551234","from":"+14085551234","isFromMe":false,"text":"on my way",
 "attachments":[]}
```

`chat` is the chat's display name or identifier; `from` is the sender handle
or the literal string `"me"` for your own messages.

Exit codes: `0` — `--max-events` reached, or clean exit (Ctrl+C/SIGTERM);
`1` — error (chat not found, unreadable db); `2` — blocked by allowlist;
`124` — `--timeout` deadline passed with no qualifying event.

Without `--max-events` or `--timeout`, runs until killed.

### `imsg info`

DB status. JSON: `{ "dbPath": "...", "watermark": 277250, "chatCount": 877, "selfAddresses": ["..."], "error": null }`.

### `imsg doctor`

Environment checks. Exit 0 when all pass, 1 otherwise.

JSON:

```json
{ "ok": true, "checks": [
  { "name": "chat.db access", "ok": true, "detail": "readable, watermark 277250" },
  { "name": "osascript", "ok": true, "detail": "available (first real send may prompt for Automation permission)" },
  { "name": "Messages.app", "ok": true, "detail": "present" },
  { "name": "runtime", "ok": true, "detail": "node 25.9.0 (node:sqlite available)" },
  { "name": "config", "ok": true, "detail": "no config (unrestricted) — /Users/me/.config/imsg/config.json" } ] }
```

### `imsg help`

Print usage.

## Safety config

`~/.config/imsg/config.json` (override with `IMSG_CONFIG_PATH`). Absent file =
fully unrestricted. Invalid JSON = every gated command exits 1 (fail closed).

```json
{ "allowlist": ["+14085551234", "partner@example.com", "iMessage;-;+14085551234"], "confirmSend": true }
```

- `allowlist`: handles (normalized: US 10-digit -> +1 E.164, emails lowercased)
  and/or chat GUIDs. Present-but-empty blocks everything. Gates `send` targets,
  scoped `poll`/`watch` targets, and filters unscoped `poll`/`watch` output.
  A group chat is allowed if its GUID, identifier, or any participant matches.
- `confirmSend`: when true, every send requires `--yes`.
