---
spec: ad-hoc — bounded `imsg stream --lookback` improvement requested during live Soldi/Zak collaboration
status: shipped
created: 2026-07-15
last_updated: 2026-07-15
related: []
---

# Stream lookback

## Summary

This workstream adds an opt-in bounded historical replay phase to `imsg stream`. `--lookback DUR` captures matching historical messages at or below one startup ROWID boundary, emits them oldest first with an additive `replay: true` field, and then continues live strictly above that boundary. The existing no-flag path stays live-only; final verification passed using only the synthetic fixture database.

## Current open questions

- [x] ~~Confirm through fixture tests that a snapshot upper bound prevents both a startup gap and a duplicate at the replay/live boundary.~~ → Verified by `tests/stream.test.ts`, 2026-07-15.

## Sessions

### 2026-07-15 — session `20260715-01bea05-vfy` (agent: codex; generated session ID)
**Branch / working tree:** `codex/stream-lookback` at `01bea05734ccd25f5015b468940635e8ec7090b1`
**Spec ref:** User-requested final bounded-lane verification and handoff
**Files touched:** `docs/implementation-notes/README.md`, `docs/implementation-notes/stream-lookback.md`

#### Context loaded

Read the prior shipped note: there were no unresolved questions and the branch was clean.

#### Design decisions

- **Verification-only closeout:** Retained the verified source and added final evidence only.

#### Deviations from spec

- None.

#### Tradeoffs considered

- **Repeat full suite:** Re-ran the complete synthetic suite for final handoff evidence.

#### Open questions

- None.

#### Footguns and gotchas

- `bun run test` regenerates and uses `tests/fixtures/chat.db`; no real Messages data was read.
- No deploy, npm publish, pull request creation, or merge was performed.

#### What shipped this session

- Re-ran `bun run test`: 45 passing tests.
- Re-ran `bun run typecheck`, `bun run build`, and `git diff --check`: all passed.
- Updated the implementation note/index with final verification and closeout state.

#### What's next

- No further action is required. An authorized maintainer may review or merge the branch; do not deploy or publish npm in this lane.

### 2026-07-15 — session `20260715-0961122-lbk` (agent: codex; generated session ID)
**Branch / working tree:** `codex/stream-lookback` at `096112271ba4906f93a2a87f21ae58155a6d4f17` in `/Users/cameronolechowski/code/play/imsg-wrkts/stream-lookback`
**Spec ref:** User request: explicit short-lookback mode for `imsg stream`
**Files touched:** `src/commands/stream.ts`, `src/db.ts`, `src/cli.ts`, `tests/stream.test.ts`, `README.md`, `skills/imsg/`, `docs/implementation-notes/`

#### Context loaded

Read `README.md`, `skills/imsg/SKILL.md`, `skills/imsg/references/commands.md`, `skills/imsg/references/recipes.md`, `src/commands/stream.ts`, `src/db.ts`, `src/parse.ts`, `src/cli.ts`, and the synthetic fixture stream/database tests before implementation. There was no existing `docs/implementation-notes/` directory or adjacent workstream note.

#### Design decisions

- **Snapshot-bounded replay:** The planned replay query will be bounded by the startup watermark and the parsed lookback cutoff. The stream will then poll strictly above that watermark, which ensures a message cannot be omitted between replay setup and the live cursor or emitted twice across the boundary.
- **Additive replay marker:** Replay events will carry an additive `replay: true` property while live events retain the existing event shape. Existing consumers that read known message fields remain compatible.
- **Filter and safety parity:** Both replay and live rows go through the existing `matchesFilters` function, which preserves positional-chat, `--chat-id`, repeatable `--from`, `--contains`, allowlist, and renderable-content behavior without a second policy path.

#### Deviations from spec

- None.

#### Tradeoffs considered

- **Date versus cursor ordering:** Replay will use ascending message date with ROWID as a tie-breaker to provide chronological historical output. The live handoff remains ROWID-based because the existing cursor contract relies on it for exact-once continuation.

#### Open questions

- [x] ~~Confirm through fixture tests that a snapshot upper bound prevents both a startup gap and a duplicate at the replay/live boundary.~~ → Verified by `tests/stream.test.ts`, 2026-07-15.

#### Footguns and gotchas

- `IMESSAGE_DB_PATH` is used only by tests to point at `tests/fixtures/chat.db`; no command in this task may access real Messages data.
- The duration parser is `parseSince`; it returns a cutoff `Date` and can throw for invalid values, which the CLI converts to its existing exit-1 error path.

#### What shipped this session

- Created the required implementation-notes index and started this workstream record before source edits.
- Added `imsg stream --lookback DUR`, using the existing `parseSince` duration parser and a startup-watermark-bounded database query.
- Added chronological replay, exact once-at-boundary live handoff, and additive `replay: true` event metadata.
- Added synthetic fixture coverage for setup-gap capture, boundary duplication, direct-chat filter isolation, historical ordering, max-events, allowlist filtering, invalid duration, and default live-only behavior.
- Updated the README, CLI help, agent skill, command reference, and monitor recipe with `imsg stream --chat-id 12 --from +17739974600 --lookback 2m`.
- Verified with `bun test tests/stream.test.ts` (13 passing), `bun run typecheck`, and `bun run build`; the final full suite passed with 45 tests.

#### What's next

- No follow-up implementation is required for this bounded change. Future event consumers may branch on optional `replay: true` if replay provenance matters to them.
