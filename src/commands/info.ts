import { IMsgDb } from '../db'
import { colors, jsonOut } from '../format'
import type { CommandContext } from '../types'
import { homedir } from 'os'
import { join } from 'path'

export function handleInfo(ctx: CommandContext): void {
  const dbPath = process.env.IMESSAGE_DB_PATH ?? join(homedir(), 'Library', 'Messages', 'chat.db')
  const c = colors(ctx.out)

  let selfAddrs: string[] = []
  let watermark = 0
  let chatCount = 0
  let error: string | null = null

  try {
    const db = new IMsgDb(dbPath)
    selfAddrs = db.selfAddresses()
    watermark = db.watermark()
    chatCount = db.listChats(10_000).length
    db.close()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  if (ctx.out.json) {
    console.log(jsonOut({ dbPath, watermark, chatCount, selfAddresses: selfAddrs, error }))
    return
  }

  if (error) {
    console.log(c.red('error:'), error)
    return
  }

  console.log(c.bold('imsg'))
  console.log(`  ${c.dim('db:')}        ${dbPath}`)
  console.log(`  ${c.dim('chats:')}     ${chatCount}`)
  console.log(`  ${c.dim('watermark:')} ${watermark}`)
  console.log(`  ${c.dim('self:')}      ${selfAddrs.length === 0 ? c.dim('(none yet)') : selfAddrs.join(', ')}`)
  console.log(`  ${c.dim('color:')}     ${ctx.out.color ? 'on' : 'off'}`)
}
