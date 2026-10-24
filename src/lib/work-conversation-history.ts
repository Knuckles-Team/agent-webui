import { z } from 'zod'
import {
  deleteConversationEntry,
  readConversationMessages,
  readLocalConversationEntry,
  renameConversationEntry,
} from './chat-store'

export const LocalConversationLabel = z.string().trim().min(1).max(120)
export function localConversationSnapshot(owner: string, id: string) {
  return { entry: readLocalConversationEntry(owner, id), cached: readConversationMessages(owner, id) !== null }
}
export function renameLocalConversation(owner: string, id: string, value: string) {
  const label = LocalConversationLabel.parse(value)
  if (!readLocalConversationEntry(owner, id)) throw new Error('No local index entry is available to rename.')
  renameConversationEntry(owner, id, label)
  if (readLocalConversationEntry(owner, id)?.firstMessage !== label)
    throw new Error('The local label could not be saved.')
}
export function removeLocalConversation(owner: string, id: string) {
  const before = localConversationSnapshot(owner, id)
  if (!before.entry && !before.cached) throw new Error('No local copy is available to remove.')
  deleteConversationEntry(owner, id)
  const after = localConversationSnapshot(owner, id)
  if (after.entry || after.cached) throw new Error('The local copy could not be fully removed. Check browser storage.')
}
