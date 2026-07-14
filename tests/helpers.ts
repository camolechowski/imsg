import { join } from 'path'

// Mirrors the constants seeded by scripts/make-fixture.ts.
export const FIXTURE = {
  handle1: '+15550001111',
  handle2: '+15550002222',
  dmGuid: 'iMessage;-;+15550001111',
  groupGuid: 'iMessage;+;chat9999',
  groupName: 'Test Group',
  attributedText: 'decoded from attributedBody',
  attachmentSuffix: 'ab/cd/IMG_0001.heic',
  maxRowid: 8,
  dmMessageCount: 5,
}

export const repoRoot = join(import.meta.dir, '..')
export const fixtureDb = join(import.meta.dir, 'fixtures', 'chat.db')

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

export function runCli(args: string[], env: Record<string, string> = {}): CliResult {
  const res = Bun.spawnSync(['node', 'dist/cli.js', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      IMESSAGE_DB_PATH: fixtureDb,
      IMSG_CONFIG_PATH: '/nonexistent/imsg-config.json',
      NO_COLOR: '1',
      ...env,
    },
  })
  return {
    code: res.exitCode,
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString(),
  }
}
