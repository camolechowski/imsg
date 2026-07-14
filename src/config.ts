// Opt-in safety config. No config file = fully unrestricted. An allowlist
// that is present (even empty) is enforced; invalid JSON fails closed.

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { looksLikeChatGuid, normalizeHandle } from './parse'

export interface ImsgConfig {
  allowlist?: string[]
  confirmSend?: boolean
}

export const EXIT = {
  OK: 0,
  ERROR: 1,
  BLOCKED: 2,
  NO_NEW: 3,
  TIMEOUT: 124,
} as const

export function configPath(): string {
  return process.env.IMSG_CONFIG_PATH ?? join(homedir(), '.config', 'imsg', 'config.json')
}

export function loadConfig(): ImsgConfig | null {
  const path = configPath()
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`invalid config at ${path}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid config at ${path}`)
  }
  const cfg = parsed as Record<string, unknown>
  if (cfg.allowlist !== undefined) {
    if (!Array.isArray(cfg.allowlist) || cfg.allowlist.some(e => typeof e !== 'string')) {
      throw new Error(`invalid config at ${path}`)
    }
  }
  if (cfg.confirmSend !== undefined && typeof cfg.confirmSend !== 'boolean') {
    throw new Error(`invalid config at ${path}`)
  }
  return cfg as ImsgConfig
}

function matchesEntry(target: string, entry: string): boolean {
  if (entry.toLowerCase() === target.toLowerCase()) return true
  if (looksLikeChatGuid(entry) || looksLikeChatGuid(target)) return false
  return normalizeHandle(entry).toLowerCase() === normalizeHandle(target).toLowerCase()
}

export function isRecipientAllowed(cfg: ImsgConfig | null, target: string): boolean {
  if (!cfg?.allowlist) return true
  return cfg.allowlist.some(entry => matchesEntry(target, entry))
}

export function isChatAllowed(
  cfg: ImsgConfig | null,
  chat: { guid: string; identifier: string; participants: string[] },
): boolean {
  if (!cfg?.allowlist) return true
  const candidates = [chat.guid, chat.identifier, ...chat.participants]
  return cfg.allowlist.some(entry => candidates.some(c => matchesEntry(c, entry)))
}
