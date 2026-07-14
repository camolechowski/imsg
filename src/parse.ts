// Argv parser, duration parser, handle normalizer.

export interface ParsedArgs {
  positional: string[]
  flags: Record<string, string | boolean>
}

const SHORT_ALIASES: Record<string, string> = {
  n: 'limit',
  s: 'since',
  u: 'until',
  f: 'from',
  j: 'json',
  q: 'quiet',
  v: 'verbose',
  h: 'help',
  c: 'chat',
}

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'verbose',
  'quiet',
  'no-color',
  'no-trunc',
  'dms',
  'groups',
  'all',
  'me',
  'unread',
  'force',
  'dry-run',
  'yes',
])

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
        continue
      }
      const key = a.slice(2)
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true
        continue
      }
      const next = argv[i + 1]
      if (next === undefined || (next.startsWith('-') && next !== '-')) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
      continue
    }
    if (a.startsWith('-') && a.length > 1 && a !== '-') {
      const short = a.slice(1)
      const key = SHORT_ALIASES[short] ?? short
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true
        continue
      }
      const next = argv[i + 1]
      if (next === undefined || (next.startsWith('-') && next !== '-')) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
      continue
    }
    positional.push(a)
  }

  return { positional, flags }
}

export function getString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

export function getBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true
}

export function getInt(flags: Record<string, string | boolean>, key: string, fallback?: number): number | undefined {
  const v = flags[key]
  if (typeof v !== 'string') return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

// Accepts: 30s, 5m, 2h, 7d, 3w, 1mo, 1y, or a bare number (interpreted as ms).
// ISO-8601 dates also allowed (passed straight to Date()).
export function parseSince(input: string | undefined): Date | undefined {
  if (!input) return undefined
  const m = input.match(/^(\d+)\s*(s|m|h|d|w|mo|y)?$/i)
  if (m) {
    const n = parseInt(m[1]!, 10)
    const unit = (m[2] ?? 's').toLowerCase()
    const ms =
      unit === 's' ? n * 1000 :
      unit === 'm' ? n * 60_000 :
      unit === 'h' ? n * 3_600_000 :
      unit === 'd' ? n * 86_400_000 :
      unit === 'w' ? n * 7 * 86_400_000 :
      unit === 'mo' ? n * 30 * 86_400_000 :
      unit === 'y' ? n * 365 * 86_400_000 :
      n * 1000
    return new Date(Date.now() - ms)
  }
  const d = new Date(input)
  if (!Number.isNaN(d.getTime())) return d
  throw new Error(`could not parse duration/date: ${input}`)
}

// Normalize a phone or email to the form chat.db stores in handle.id.
// Phone -> E.164 (best effort, US default for 10 digits).
// Email -> lowercased.
export function normalizeHandle(input: string): string {
  const t = input.trim()
  if (!t) return t
  if (t.includes('@')) return t.toLowerCase()

  const hasPlus = t.startsWith('+')
  const digits = t.replace(/[^\d]/g, '')
  if (!digits) return t.toLowerCase()
  if (hasPlus) return `+${digits}`
  if (digits.length < 10) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  // Fallback: prepend + so any plus-form match works.
  return `+${digits}`
}

export function looksLikeChatGuid(s: string): boolean {
  return /^(iMessage|SMS|RCS);[+-];/.test(s)
}
