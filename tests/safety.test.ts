import { expect, test } from 'bun:test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { FIXTURE, runCli } from './helpers'

const fixturesDir = join(import.meta.dir, 'fixtures')
const allowCfg = join(fixturesDir, 'cfg-allowlist.json')
const groupOnlyCfg = join(fixturesDir, 'cfg-group-only.json')
const nobodyCfg = join(fixturesDir, 'cfg-nobody.json')
const confirmCfg = join(fixturesDir, 'cfg-confirm.json')
const invalidCfg = join(fixturesDir, 'cfg-invalid.json')

writeFileSync(allowCfg, JSON.stringify({ allowlist: [FIXTURE.handle1] }))
// handle2 only appears in the group chat, so this allowlist excludes the DM.
writeFileSync(groupOnlyCfg, JSON.stringify({ allowlist: [FIXTURE.handle2] }))
writeFileSync(nobodyCfg, JSON.stringify({ allowlist: ['+16665554444'] }))
writeFileSync(confirmCfg, JSON.stringify({ allowlist: [FIXTURE.handle1], confirmSend: true }))
writeFileSync(invalidCfg, '{not json')

test('send to non-allowlisted handle exits 2 and leaks nothing', () => {
  const r = runCli(['send', FIXTURE.handle2, 'topsecret', '--dry-run', '--json'], {
    IMSG_CONFIG_PATH: allowCfg,
  })
  expect(r.code).toBe(2)
  expect(r.stdout).not.toContain('topsecret')
  expect(r.stderr).not.toContain('topsecret')
  const d = JSON.parse(r.stdout)
  expect(d.blocked).toBe(true)
})

test('send to allowlisted handle passes', () => {
  const r = runCli(['send', FIXTURE.handle1, 'hi', '--dry-run', '--json'], {
    IMSG_CONFIG_PATH: allowCfg,
  })
  expect(r.code).toBe(0)
  expect(JSON.parse(r.stdout).ok).toBe(true)
})

test('poll scoped to a blocked chat exits 2 with no message data', () => {
  const r = runCli(['poll', FIXTURE.groupGuid, '--since-rowid', '0', '--json'], {
    IMSG_CONFIG_PATH: nobodyCfg,
  })
  expect(r.code).toBe(2)
  const d = JSON.parse(r.stdout)
  expect(d.error).toContain('allowlist')
  expect(d.messages).toBeUndefined()
})

test('unscoped poll with allowlist filters to allowed chats only', () => {
  const r = runCli(['poll', '--since-rowid', '0', '--json'], { IMSG_CONFIG_PATH: groupOnlyCfg })
  expect(r.code).toBe(0)
  const d = JSON.parse(r.stdout)
  expect(d.messages.length).toBeGreaterThan(0)
  for (const m of d.messages) expect(m.chatGuid).toBe(FIXTURE.groupGuid)
})

test('confirmSend blocks without --yes and passes with it', () => {
  const blocked = runCli(['send', FIXTURE.handle1, 'hi', '--dry-run', '--json'], {
    IMSG_CONFIG_PATH: confirmCfg,
  })
  expect(blocked.code).toBe(2)
  expect(JSON.parse(blocked.stdout).blocked).toBe(true)

  const ok = runCli(['send', FIXTURE.handle1, 'hi', '--dry-run', '--yes', '--json'], {
    IMSG_CONFIG_PATH: confirmCfg,
  })
  expect(ok.code).toBe(0)
})

test('no config file means unrestricted', () => {
  const r = runCli(['send', FIXTURE.handle2, 'hi', '--dry-run', '--json'])
  expect(r.code).toBe(0)
})

test('invalid config JSON fails closed with exit 1', () => {
  const r = runCli(['send', FIXTURE.handle1, 'hi', '--dry-run', '--json'], {
    IMSG_CONFIG_PATH: invalidCfg,
  })
  expect(r.code).toBe(1)
  expect(r.stdout + r.stderr).toContain('invalid config')
})
