import { expect, test } from 'bun:test'
import { runCli } from './helpers'

test('doctor --json reports five checks and readable fixture db', () => {
  const r = runCli(['doctor', '--json'])
  expect([0, 1]).toContain(r.code)
  const d = JSON.parse(r.stdout)
  expect(typeof d.ok).toBe('boolean')
  expect(d.checks.length).toBe(5)
  const dbCheck = d.checks.find((c: { name: string }) => c.name === 'chat.db access')
  expect(dbCheck.ok).toBe(true)
  expect(dbCheck.detail).toContain('watermark')
  for (const c of d.checks) {
    expect(typeof c.name).toBe('string')
    expect(typeof c.ok).toBe('boolean')
    expect(typeof c.detail).toBe('string')
  }
})

test('doctor human output prints one line per check', () => {
  const r = runCli(['doctor'])
  const lines = r.stdout.trim().split('\n')
  expect(lines.length).toBe(5)
})
