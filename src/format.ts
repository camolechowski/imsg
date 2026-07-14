// Output helpers: ANSI color, time formatting, table layout.

import type { OutputOptions } from './types'

const supportsColor =
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

export function makeOut(jsonFlag: boolean, noColor: boolean, noTrunc: boolean): OutputOptions {
  return {
    json: jsonFlag,
    color: supportsColor && !noColor && !jsonFlag,
    noTrunc,
    width: process.stdout.columns ?? 100,
  }
}

type Painter = (s: string) => string
const wrap = (open: string, close: string): Painter => s => `\x1b[${open}m${s}\x1b[${close}m`

export interface Colorizer {
  bold: Painter
  dim: Painter
  red: Painter
  green: Painter
  yellow: Painter
  blue: Painter
  magenta: Painter
  cyan: Painter
  gray: Painter
  inverse: Painter
}

const noop: Painter = s => s
const COLORED: Colorizer = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  magenta: wrap('35', '39'),
  cyan: wrap('36', '39'),
  gray: wrap('90', '39'),
  inverse: wrap('7', '27'),
}
const PLAIN: Colorizer = {
  bold: noop, dim: noop, red: noop, green: noop, yellow: noop,
  blue: noop, magenta: noop, cyan: noop, gray: noop, inverse: noop,
}

export function colors(out: OutputOptions): Colorizer {
  return out.color ? COLORED : PLAIN
}

// "5m", "2h", "yesterday", "Mar 14" — chosen for compactness in dense lists.
export function relativeTime(d: Date, now: Date = new Date()): string {
  const diff = now.getTime() - d.getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 0) return 'now'
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d`
  if (day < 30) return `${Math.round(day / 7)}w`
  if (day < 365) return `${Math.round(day / 30)}mo`
  return `${Math.round(day / 365)}y`
}

export function formatTime(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, '0')}${ampm}`
}

export function formatDateShort(d: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]} ${d.getDate()}`
}

export function formatDateTime(d: Date): string {
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? formatTime(d) : `${formatDateShort(d)} ${formatTime(d)}`
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '…'
}

export function stripNewlines(s: string): string {
  return s.replace(/\s*\n+\s*/g, ' ⏎ ')
}

// Width-aware: pads display string but ANSI codes don't count toward width.
const ANSI_RE = /\x1b\[[0-9;]*m/g
export function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length
}

export function padRight(s: string, width: number): string {
  const len = visibleLength(s)
  return len >= width ? s : s + ' '.repeat(width - len)
}

export function table(rows: string[][], opts: { gap?: number } = {}): string {
  if (rows.length === 0) return ''
  const gap = opts.gap ?? 2
  const cols = Math.max(...rows.map(r => r.length))
  const widths: number[] = []
  for (let c = 0; c < cols; c++) {
    let w = 0
    for (const row of rows) {
      const cell = row[c] ?? ''
      const len = visibleLength(cell)
      if (len > w) w = len
    }
    widths[c] = w
  }
  return rows
    .map(row =>
      row
        .map((cell, c) => (c === row.length - 1 ? cell : padRight(cell, widths[c] ?? 0)))
        .join(' '.repeat(gap))
        .trimEnd(),
    )
    .join('\n')
}

export function jsonOut(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2)
}

// Highlight a substring match. Used by search.
export function highlight(haystack: string, needle: string, paint: Painter): string {
  if (!needle) return haystack
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return haystack
  return (
    haystack.slice(0, idx) +
    paint(haystack.slice(idx, idx + needle.length)) +
    haystack.slice(idx + needle.length)
  )
}

export function snippet(text: string, needle: string, span = 80): string {
  if (!needle) return truncate(stripNewlines(text), span)
  const flat = stripNewlines(text)
  const idx = flat.toLowerCase().indexOf(needle.toLowerCase())
  if (idx < 0) return truncate(flat, span)
  const half = Math.floor((span - needle.length) / 2)
  const start = Math.max(0, idx - half)
  const end = Math.min(flat.length, idx + needle.length + half)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < flat.length ? '…' : ''
  return prefix + flat.slice(start, end) + suffix
}
