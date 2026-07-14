// Domain types for imsg. Plain TS; no runtime validation needed since chat.db
// shapes are fixed by macOS and CLI inputs are owned by us.

export type Service = 'iMessage' | 'SMS' | 'RCS'

// chat.style: 45 = direct message, 43 = group chat. Anything else is unknown
// and we drop it rather than guess.
export type ChatStyle = 'dm' | 'group'

export interface Message {
  rowid: number
  guid: string
  text: string
  date: Date
  isFromMe: boolean
  /** Sender handle (phone/email). For is_from_me rows this is null. */
  handle: string | null
  service: string
  chatGuid: string
  hasAttachments: boolean
  attachments: AttachmentInfo[]
  /** account field on message — your own sending address (e.g. "E:cam@..."). */
  account: string | null
}

export interface AttachmentInfo {
  filename: string | null
  mimeType: string | null
  transferName: string | null
  /** filename with ~ expanded to an absolute on-disk path. */
  resolvedPath: string | null
}

export interface Chat {
  guid: string
  identifier: string
  displayName: string | null
  style: ChatStyle
  service: string
  participants: string[]
}

export interface ChatSummary extends Chat {
  lastMessageAt: Date | null
  lastText: string | null
  lastFromMe: boolean
  messageCount: number
}

export interface SearchHit {
  message: Message
  chat: { guid: string; identifier: string; displayName: string | null; style: ChatStyle }
  /** Highlighted snippet around the match. */
  snippet: string
}

export interface QueryFilter {
  since?: Date
  until?: Date
  fromHandle?: string
  service?: Service
  text?: string
  limit?: number
  includeGroups?: boolean
  includeDms?: boolean
}

export interface OutputOptions {
  json: boolean
  color: boolean
  noTrunc: boolean
  width: number
}

export interface SendResult {
  ok: boolean
  chatGuid?: string
  recipient: string
  via: 'chat-id' | 'buddy'
  text: string
  chunks: number
  error?: string
}

export interface CommandContext {
  argv: string[]
  flags: Record<string, string | boolean>
  positional: string[]
  out: OutputOptions
}

export function hasRenderableContent(message: Pick<Message, 'text' | 'hasAttachments'>): boolean {
  return message.hasAttachments || message.text.trim().length > 0
}
