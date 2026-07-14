import { expect, test } from 'bun:test'
import { FIXTURE, runCli } from './helpers'

test('send text + file dry-run reports the file and touches no osascript', () => {
  const r = runCli(['send', FIXTURE.handle1, 'hello', '--file', '/etc/hosts', '--dry-run', '--json'])
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.ok).toBe(true)
  expect(d.file).toBe('/etc/hosts')
  expect(d.chatGuid).toBe(FIXTURE.dmGuid)
  expect(r.stderr).toContain('[dry-run]')
})

test('send file-only (no text) is accepted', () => {
  const r = runCli(['send', FIXTURE.handle1, '--file', '/etc/hosts', '--dry-run', '--json'])
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.ok).toBe(true)
  expect(d.text).toBe('')
})

test('send to an unknown handle falls back to buddy mode', () => {
  const r = runCli(['send', '+19995550000', 'hi', '--dry-run', '--json'])
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.via).toBe('buddy')
})

test('missing file exits 1 before any send', () => {
  const r = runCli(['send', FIXTURE.handle1, '--file', '/no/such/file-xyz', '--dry-run'])
  expect(r.code).toBe(1)
  expect(r.stderr).toContain('file not found')
})

test('no text and no file is a usage error (exit 2)', () => {
  const r = runCli(['send', FIXTURE.handle1, '--dry-run'])
  expect(r.code).toBe(2)
  expect(r.stderr).toContain('usage')
})
