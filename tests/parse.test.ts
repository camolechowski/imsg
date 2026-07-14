import { expect, test } from 'bun:test'
import { normalizeHandle, parseArgs, parseSince } from '../src/parse'

test('parseSince durations produce past dates', () => {
  const now = Date.now()
  for (const [input, ms] of [
    ['30s', 30_000],
    ['5m', 300_000],
    ['2h', 7_200_000],
    ['7d', 7 * 86_400_000],
  ] as const) {
    const d = parseSince(input)!
    expect(Math.abs(now - ms - d.getTime())).toBeLessThan(2000)
  }
})

test('parseSince accepts ISO dates', () => {
  expect(parseSince('2026-01-02T03:04:05Z')!.toISOString()).toBe('2026-01-02T03:04:05.000Z')
})

test('parseSince throws on garbage', () => {
  expect(() => parseSince('not-a-date-xyz')).toThrow()
})

test('normalizeHandle phones and emails', () => {
  expect(normalizeHandle('4085550001')).toBe('+14085550001')
  expect(normalizeHandle('(408) 555-0001')).toBe('+14085550001')
  expect(normalizeHandle('14085550001')).toBe('+14085550001')
  expect(normalizeHandle('+14085550001')).toBe('+14085550001')
  expect(normalizeHandle('Cam@X.COM')).toBe('cam@x.com')
})

test('parseArgs flag forms', () => {
  const p = parseArgs(['read', '--limit=5', '-n', '7', '--json', '--', '--not-a-flag'])
  expect(p.positional).toEqual(['read', '--not-a-flag'])
  expect(p.flags.limit).toBe('7')
  expect(p.flags.json).toBe(true)
})

test('parseArgs value flags take the next token', () => {
  const p = parseArgs(['send', '+15550001111', '--file', '/tmp/x.png', '--yes', '--timeout', '30'])
  expect(p.flags.file).toBe('/tmp/x.png')
  expect(p.flags.yes).toBe(true)
  expect(p.flags.timeout).toBe('30')
})
