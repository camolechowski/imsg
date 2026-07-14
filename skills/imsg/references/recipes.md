# imsg recipes

Copy-paste patterns for common agent and scripting use cases. Flag/schema
details live in [commands.md](commands.md).

## Wait for a reply from one person (blocking, single shot)

```sh
imsg watch +14085551234 --timeout 300 --json
```

- Exit 0: stdout is `{ chat, messages, cursor }` with the new message(s).
- Exit 124: 5 minutes passed with no reply; `messages` is empty.

## Wait for a reply (non-blocking poll loop)

Bootstrap once to get the current cursor (exit 3, no messages):

```sh
imsg poll --json
# => { "chat": null, "messages": [], "cursor": { "rowid": 48291, "ts": "..." } }
```

Then loop — sleep, poll from the saved cursor, scoped to the handle:

```sh
imsg poll +14085551234 --since-rowid 48291 --json
```

Exit 0 = new messages (save the new `cursor.rowid`); exit 3 = nothing yet
(keep the same cursor). The cursor never re-emits or skips a message.

## Monitor a conversation in the background (harness monitor)

For harnesses that watch a background process's stdout (Claude Code's Monitor
tool, Codex shell loops):

```sh
imsg stream --from +14085551234 --max-events 1 --timeout 600
```

Run as a background command; watch stdout for a `"type":"message"` line.
Emits one `"type":"ready"` line at start, then one NDJSON object per matching
message. Exit 0 when `--max-events` is reached, 124 on timeout.

Variants:

```sh
imsg stream --from +14085551234,+17739974600        # multiple senders
imsg stream --chat-id 7 --contains "approved"        # one chat, keyword match
imsg stream --from me                                # only your own outbound
imsg stream                                          # firehose: everything, runs until killed
```

## Send a text, safely

```sh
imsg send +14085551234 "running late" --dry-run --json   # validate, zero side effects
imsg send +14085551234 "running late" --json             # real send
```

Confirm the recipient with the user before a real send. If exit 2 with
`"blocked": true`, the opt-in safety config blocked it — surface to the user,
do not retry.

## Send a file

```sh
imsg send +14085551234 --file /absolute/path/pic.jpg --json
imsg send +14085551234 "see attached" --file ~/Desktop/doc.pdf --json
```

## Read incoming attachments

Attachments appear in `read`/`recent`/`poll`/`watch` message JSON; use
`resolvedPath` (absolute on-disk path, null if not yet downloaded):

```sh
imsg read +14085551234 -n 5 --json | jq -r '.messages[].attachments[]?.resolvedPath'
```

## Summarize a conversation

```sh
imsg read +14085551234 --since 7d --json     # one thread, last week
imsg recent --since 24h --json               # everything, last day
imsg search "dinner plans" --since 30d --json
```

## Cron / scheduled check for new messages

Persist the cursor between runs; branch on exit code:

```sh
cursor=$(cat ~/.cache/imsg-cursor 2>/dev/null)
out=$(imsg poll ${cursor:+--since-rowid $cursor} --json)
case $? in
  0) echo "$out" | jq -r '.cursor.rowid' > ~/.cache/imsg-cursor
     # process $out messages...
     ;;
  3) ;;                       # nothing new
  *) echo "imsg poll failed" >&2 ;;
esac
```

## Enable safety rails (advanced, opt-in)

Off by default — no config file means fully unrestricted. To restrict:

```sh
mkdir -p ~/.config/imsg
cat > ~/.config/imsg/config.json <<'EOF'
{ "allowlist": ["+14085551234", "partner@example.com"], "confirmSend": true }
EOF
```

With `confirmSend`, every send needs `--yes`. The allowlist gates send
targets and scoped poll/watch/stream targets, and filters unscoped
poll/watch/stream output.

## First-run diagnosis

```sh
imsg doctor --json
```

Five checks: chat.db access (Full Disk Access), osascript, Messages.app,
runtime, config. Fix the first failing check before anything else.
