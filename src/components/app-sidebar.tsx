import { CirclePlus, MessageCircle, Trash, Pencil, Check, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ACTIVE_CONVERSATION_CHANGED_EVENT,
  ACTIVE_CONVERSATION_STORAGE_KEY,
  useConversationIdFromUrl,
} from '@/hooks/useConversationIdFromUrl'
import { cn } from '@/lib/utils'
import { SECTIONS, roleAtLeast, routesBySection } from '@/lib/nav-registry'
import { useIdentity } from '@/lib/auth'
import { deleteConversationEntry, renameConversationEntry, useConversations } from '@/lib/chat-store'
import type { ConversationEntry } from '@/types'
import { ModeToggle } from './mode-toggle'

function doLocalNavigation(e: React.MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey) {
    return
  }
  const url = new URL((e.currentTarget as HTMLAnchorElement).href)
  window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)

  window.dispatchEvent(new Event('history-state-changed'))
  e.preventDefault()
}

function deleteConversation(userKey: string, conversationId: string) {
  deleteConversationEntry(userKey, conversationId)

  if (window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) === conversationId) {
    window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY)
    window.dispatchEvent(new Event(ACTIVE_CONVERSATION_CHANGED_EVENT))
  }

  const url = new URL(window.location.toString())
  const requestedConversation = url.searchParams.get('conversation')
  if (url.pathname === conversationId || (url.pathname === '/chat' && requestedConversation === conversationId)) {
    window.history.pushState({}, '', '/chat')
    window.dispatchEvent(new Event('history-state-changed'))
  }
}

export function AppSidebar() {
  const { identity } = useIdentity()
  const conversations = useConversations(identity.userKey)
  const [conversationId] = useConversationIdFromUrl()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [conversationToDelete, setConversationToDelete] = useState<ConversationEntry | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [agentInfo, setAgentInfo] = useState<{ name: string; description: string; emoji: string } | null>(null)

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const res = await fetch('/api/enhanced/info')
        const data = (await res.json()) as { name: string; description: string; emoji: string }
        setAgentInfo(data)
      } catch (err) {
        console.error('Failed to fetch agent info', err)
      }
    }
    void fetchInfo()
  }, [])

  const handleDeleteClick = (e: React.MouseEvent, conversation: ConversationEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setConversationToDelete(conversation)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (conversationToDelete) {
      deleteConversation(identity.userKey, conversationToDelete.id)
      setDeleteDialogOpen(false)
      setConversationToDelete(null)
      toast.success('Chat deleted successfully')
    }
  }

  const handleRenameClick = (e: React.MouseEvent, conversation: ConversationEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(conversation.id)
    setEditValue(conversation.firstMessage ?? '')
  }

  const handleSaveRename = (e: React.SyntheticEvent | React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (editValue.trim()) {
      renameConversationEntry(identity.userKey, id, editValue.trim())
      toast.success('Chat renamed')
    }
    setEditingId(null)
  }

  const handleCancelRename = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(null)
  }

  return (
    <TooltipProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarTrigger className="ml-auto" />
          <div className="ml-2 flex flex-col gap-1.5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">{agentInfo?.emoji ?? '🤖'}</span>
              <h1 className="text-base font-bold truncate group-data-[state=collapsed]:hidden">
                {agentInfo?.name ?? 'Agent Web Dashboard'}
              </h1>
            </div>
            {agentInfo?.description && (
              <p className="text-xs text-muted-foreground line-clamp-6 px-1 leading-normal group-data-[state=collapsed]:hidden max-w-[220px]">
                {agentInfo.description}
              </p>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent>
          {/* Every section and page below is derived from src/lib/nav-registry.ts — there
              is no second place in this file that declares what pages exist. Routes below
              `identity.role` are filtered out here (R9): this is the UI half of role
              enforcement, decoration on its own — `WebUIAuthorizationMiddleware` on the
              server enforces the same `minRole` ladder for the routes it can attribute to
              an API surface, so a hidden nav item is never the ONLY thing standing between
              a caller and a page. */}
          {SECTIONS.map((section) => {
            const routes = routesBySection(section.id).filter((route) => roleAtLeast(identity.role, route.minRole))
            if (routes.length === 0) return null
            return (
              <SidebarGroup key={section.id}>
                <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                <SidebarMenu className="mb-2">
                  {routes.map((route) => {
                    const Icon = route.icon
                    return (
                      <SidebarMenuItem key={route.id}>
                        <SidebarMenuButton asChild tooltip={route.blurb}>
                          <a
                            href={route.path}
                            onClick={(e) => {
                              doLocalNavigation(e)
                            }}
                          >
                            <Icon />
                            <span>{route.label}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                  {section.id === 'chat' && (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild tooltip="Start a new conversation session">
                        <a
                          href="/chat"
                          onClick={(e) => {
                            window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY)
                            doLocalNavigation(e)
                          }}
                        >
                          <CirclePlus className="text-emerald-500" />
                          <span>New Conversation</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroup>
            )
          })}

          <SidebarGroup>
            <SidebarGroupLabel>Active Chats</SidebarGroupLabel>

            <SidebarGroupContent>
              <SidebarMenu>
                {conversations.map((conversation, index) => (
                  <SidebarMenuItem key={index} className="group/sidebar-menu-item">
                    <div className="flex items-center gap-1 h-auto">
                      <SidebarMenuButton asChild tooltip={conversation.firstMessage} className="flex-1">
                        {editingId === conversation.id ? (
                          <div
                            className="flex items-center gap-1 w-full pr-2 h-9 p-2"
                            onClick={(e) => {
                              e.stopPropagation()
                            }}
                          >
                            <MessageCircle className="size-3 shrink-0" />
                            <input
                              autoFocus
                              className="bg-background border-primary/30 border rounded px-2 text-sm w-full py-1 outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm h-7"
                              value={editValue}
                              onChange={(e) => {
                                setEditValue(e.target.value)
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation()
                              }}
                              onDragStart={(e) => {
                                e.preventDefault()
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSaveRename(e, conversation.id)
                                }
                                if (e.key === 'Escape') {
                                  setEditingId(null)
                                }
                              }}
                            />
                            <div className="flex items-center gap-0.5 ml-1 shrink-0">
                              <button
                                onClick={(e) => {
                                  handleSaveRename(e, conversation.id)
                                }}
                                className="p-1 hover:bg-green-500/10 hover:text-green-600 rounded-sm transition-colors"
                                title="Save"
                              >
                                <Check className="size-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  handleCancelRename(e)
                                }}
                                className="p-1 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors"
                                title="Cancel"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <a
                            href={`/chat?conversation=${encodeURIComponent(conversation.id)}`}
                            onClick={(e) => {
                              doLocalNavigation(e)
                            }}
                            className={cn('h-auto flex items-start gap-2', {
                              'bg-accent pointer-events-none': conversation.id === conversationId,
                            })}
                          >
                            <MessageCircle className="size-3 mt-1" />
                            <span className="flex flex-col items-start w-full">
                              <span className="truncate max-w-44">{conversation.firstMessage}</span>
                              <span className="text-xs opacity-30">
                                {new Date(conversation.timestamp).toLocaleString()}
                              </span>
                            </span>
                          </a>
                        )}
                      </SidebarMenuButton>
                      <div
                        className={cn(
                          'flex flex-col gap-0.5 opacity-0 group-hover/sidebar-menu-item:opacity-100 transition-opacity group-data-[state=collapsed]:hidden absolute right-0 self-start',
                          editingId === conversation.id && 'hidden',
                        )}
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1.5"
                              onClick={(e) => {
                                handleRenameClick(e, conversation)
                              }}
                            >
                              <Pencil className="size-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Rename conversation</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1.5"
                              onClick={(e) => {
                                handleDeleteClick(e, conversation)
                              }}
                            >
                              <Trash className="size-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete conversation</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <ModeToggle />
        </SidebarFooter>

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleConfirmDelete()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Delete conversation?</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this chat? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false)
                }}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmDelete} autoFocus>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Sidebar>
    </TooltipProvider>
  )
}
