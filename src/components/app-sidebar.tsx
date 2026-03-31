import { CirclePlus, MessageCircle, Trash, Files, Zap, Book, Calendar, Settings, Pencil, Check, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState, useMemo } from 'react'
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
import { useConversationIdFromUrl } from '@/hooks/useConversationIdFromUrl'
import { cn } from '@/lib/utils'
import type { ConversationEntry } from '@/types'
import { ModeToggle } from './mode-toggle'

function useConversations(): ConversationEntry[] {
  const [localConversations, setLocalConversations] = useState<ConversationEntry[]>(() => {
    const stored = window.localStorage.getItem('conversationIds')
    return stored ? (JSON.parse(stored) as ConversationEntry[]) : []
  })
  const [remoteConversations, setRemoteConversations] = useState<ConversationEntry[]>([])

  useEffect(() => {
    const fetchRemote = async () => {
      try {
        const res = await fetch('/api/enhanced/chats')
        if (res.ok) {
          const data = (await res.json()) as ConversationEntry[]

          setRemoteConversations(
            data.map((c) => ({
              ...c,
              timestamp:
                typeof c.timestamp === 'string' || typeof c.timestamp === 'number'
                  ? new Date(c.timestamp).getTime()
                  : Date.now(),
            })),
          )
        }
      } catch (err) {
        console.error('Failed to fetch remote conversations', err)
      }
    }
    void fetchRemote()
  }, [])

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'conversationIds' && e.newValue) {
        setLocalConversations(JSON.parse(e.newValue) as ConversationEntry[])
      }
    }

    const handleCustomStorageChange = () => {
      const stored = window.localStorage.getItem('conversationIds')
      setLocalConversations(stored ? (JSON.parse(stored) as ConversationEntry[]) : [])
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('local-storage-change', handleCustomStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('local-storage-change', handleCustomStorageChange)
    }
  }, [])

  const allConversations = useMemo(() => {
    const map = new Map<string, ConversationEntry>()

    localConversations.forEach((c) => map.set(c.id, c))

    remoteConversations.forEach((c) => map.set(c.id, c))

    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp)
  }, [localConversations, remoteConversations])

  return allConversations
}

function doLocalNavigation(e: React.MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey) {
    return
  }
  const path = new URL((e.currentTarget as HTMLAnchorElement).href).pathname
  window.history.pushState({}, '', path)

  window.dispatchEvent(new Event('history-state-changed'))
  e.preventDefault()
}

function deleteConversation(conversationId: string) {
  const stored = window.localStorage.getItem('conversationIds')
  if (stored) {
    const conversations = JSON.parse(stored) as ConversationEntry[]
    const updated = conversations.filter((conv) => conv.id !== conversationId)
    window.localStorage.setItem('conversationIds', JSON.stringify(updated))

    window.dispatchEvent(new Event('local-storage-change'))
  }

  window.localStorage.removeItem(conversationId)

  const currentPath = window.location.pathname
  if (currentPath === conversationId) {
    window.history.pushState({}, '', '/')
    window.dispatchEvent(new Event('history-state-changed'))
  }
}

export function AppSidebar() {
  const conversations = useConversations()
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
      deleteConversation(conversationToDelete.id)
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
      const stored = window.localStorage.getItem('conversationIds')
      if (stored) {
        const conversations = JSON.parse(stored) as ConversationEntry[]
        const updated = conversations.map((conv) =>
          conv.id === id ? { ...conv, firstMessage: editValue.trim() } : conv,
        )
        window.localStorage.setItem('conversationIds', JSON.stringify(updated))
        window.dispatchEvent(new Event('local-storage-change'))
        toast.success('Chat renamed')
      }
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
          <SidebarGroup>
            <SidebarGroupLabel>Workspace Management</SidebarGroupLabel>
            <SidebarMenu className="mb-4">
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="View and manage workspace files">
                  <a
                    href="/files"
                    onClick={(e) => {
                      doLocalNavigation(e)
                    }}
                  >
                    <Files />
                    <span>Files</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Manage agent skills and capabilities">
                  <a
                    href="/skills"
                    onClick={(e) => {
                      doLocalNavigation(e)
                    }}
                  >
                    <Zap />
                    <span>Skills</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Access the agent's knowledge base and documentation">
                  <a
                    href="/knowledge"
                    onClick={(e) => {
                      doLocalNavigation(e)
                    }}
                  >
                    <Book />
                    <span>Knowledge</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="View and manage scheduled tasks">
                  <a
                    href="/scheduling"
                    onClick={(e) => {
                      doLocalNavigation(e)
                    }}
                  >
                    <Calendar />
                    <span>Scheduling</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Edit agent configuration files">
                  <a
                    href="/configuration"
                    onClick={(e) => {
                      doLocalNavigation(e)
                    }}
                  >
                    <Settings />
                    <span>Configuration</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <SidebarGroupLabel>Chat</SidebarGroupLabel>
            <SidebarMenu className="mb-2">
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Start a new conversation">
                  <a
                    href="/"
                    onClick={(e) => {
                      doLocalNavigation(e)
                    }}
                  >
                    <CirclePlus />
                    <span>New conversation</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

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
                            href={conversation.id}
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
