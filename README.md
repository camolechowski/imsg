# imsg

Read, search, send, poll, watch, and stream iMessages from the terminal. Zero
runtime dependencies. Runs on node >= 22.13 or bun. macOS only — installs
anywhere, but every command (except `help`) prints a warning and exits 1 on
other platforms.

## Install

```sh
npm i -g imsg-cli
# or
bun add -g imsg-cli
```

Not yet published to npm — install from a local checkout for now:

```sh
git clone <repo> imsg && cd imsg
bun install
bun run build
npm i -g .   # or: bun link
```

## Setup: Full Disk Access (required)

Reading `~/Library/Messages/chat.db` requires granting Full Disk Access to your
terminal app:

1. System Settings > Privacy & Security > Full Disk Access
2. Add your terminal (Terminal, iTerm, Ghostty, ...)
3. Restart the terminal

Sending additionally triggers a one-time Automation permission prompt for
Messages.app on your first real send.

Verify everything:

```sh
imsg doctor
```

## Usage

```sh
imsg chats -n 10                              # recent conversations
imsg read +14085551234 --since 7d             # one conversation, last week
imsg search "dinner" --since 30d              # full-text search
imsg send +14085551234 "running late"         # send a text
imsg send +14085551234 --file ~/Desktop/pic.jpg   # send a file
imsg watch                                    # tail all new messages live
imsg watch +14085551234 --timeout 300         # block up to 5m for a reply
imsg poll --since-rowid 48291 --json          # non-blocking: new since cursor
imsg stream --from +14085551234 --timeout 600 # NDJSON event stream for agent monitors
imsg doctor                                   # check permissions & environment
```

Every command takes `--json` for machine-readable output.

## Safety config (opt-in)

No config file = current unrestricted behavior. Create
`~/.config/imsg/config.json` to enable rails:

```json
{
  "allowlist": ["+14085551234", "partner@example.com"],
  "confirmSend": true
}
```

- `allowlist` restricts send recipients and poll/watch targets. Blocked
  operations exit 2 and emit no message data. An empty allowlist blocks
  everything; omit the key to disable the gate.
- `confirmSend: true` requires `--yes` on every send.

## Exit codes

| Code | Meaning |
|-|-|
| 0 | success / new messages |
| 1 | error |
| 2 | usage error or blocked by safety policy |
| 3 | poll: no new messages |
| 124 | watch/stream: timeout |

## Agent usage

AI agents should install the bundled skill (this repo's layout supports
`npx skills add camolechowski/imsg`) and follow
[skills/imsg/SKILL.md](skills/imsg/SKILL.md) — it covers the poll/cursor
wait-for-reply pattern, the JSON contracts, and the send safety rules. The full
command reference lives at
[skills/imsg/references/commands.md](skills/imsg/references/commands.md), and
copy-paste use-case recipes at
[skills/imsg/references/recipes.md](skills/imsg/references/recipes.md).

## Development

```sh
bun install
bun run typecheck
bun run test        # synthetic fixture db; never touches real messages
bun run build       # bundles to dist/cli.js (node shebang)
```

## License

MIT
