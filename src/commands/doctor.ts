import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { configPath, EXIT, loadConfig } from '../config'
import { IMsgDb } from '../db'
import { colors, jsonOut } from '../format'
import type { CommandContext } from '../types'

interface Check {
  name: string
  ok: boolean
  detail: string
}

export async function handleDoctor(ctx: CommandContext): Promise<void> {
  const checks: Check[] = []

  try {
    const db = new IMsgDb()
    const watermark = db.watermark()
    db.close()
    checks.push({ name: 'chat.db access', ok: true, detail: `readable, watermark ${watermark}` })
  } catch {
    checks.push({
      name: 'chat.db access',
      ok: false,
      detail:
        'cannot read chat.db — grant Full Disk Access to your terminal in ' +
        'System Settings > Privacy & Security > Full Disk Access',
    })
  }

  const osa = spawnSync('osascript', ['-e', 'return 1'], { encoding: 'utf8' })
  if (osa.status === 0) {
    checks.push({ name: 'osascript', ok: true, detail: 'available (first real send may prompt for Automation permission)' })
  } else {
    checks.push({
      name: 'osascript',
      ok: false,
      detail:
        'osascript failed — check Automation permission for Messages in ' +
        'System Settings > Privacy & Security > Automation',
    })
  }

  const messagesApp =
    existsSync('/System/Applications/Messages.app') || existsSync('/Applications/Messages.app')
  checks.push({
    name: 'Messages.app',
    ok: messagesApp,
    detail: messagesApp ? 'present' : 'not found — sending requires Messages.app',
  })

  if (process.versions.bun) {
    checks.push({ name: 'runtime', ok: true, detail: `bun ${process.versions.bun}` })
  } else {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
    const ok = major > 22 || (major === 22 && minor >= 13)
    checks.push({
      name: 'runtime',
      ok,
      detail: ok
        ? `node ${process.versions.node} (node:sqlite available)`
        : `node ${process.versions.node} — need node >= 22.13 for node:sqlite`,
    })
  }

  try {
    const cfg = loadConfig()
    if (cfg === null) {
      checks.push({ name: 'config', ok: true, detail: `no config (unrestricted) — ${configPath()}` })
    } else {
      checks.push({
        name: 'config',
        ok: true,
        detail: `allowlist: ${cfg.allowlist ? `${cfg.allowlist.length} entries` : 'off'}, confirmSend: ${cfg.confirmSend === true}`,
      })
    }
  } catch {
    checks.push({ name: 'config', ok: false, detail: `invalid JSON at ${configPath()}` })
  }

  const allOk = checks.every(c => c.ok)

  if (ctx.out.json) {
    console.log(jsonOut({ ok: allOk, checks }))
  } else {
    const c = colors(ctx.out)
    for (const check of checks) {
      const status = check.ok ? c.green('ok  ') : c.red('FAIL')
      console.log(`  ${status} ${check.name.padEnd(16)} ${c.dim(check.detail)}`)
    }
  }
  process.exit(allOk ? EXIT.OK : EXIT.ERROR)
}
