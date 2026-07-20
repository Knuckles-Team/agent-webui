/**
 * @file BrokerView.tsx
 * @description Message-broker / queue inspector over the gateway `/graph/broker`
 * route (with a fallback to the canonical `/graph/bus` action tool).
 *
 * Lists topics/queues with their depth + consumer counts, shows recent
 * messages for the selected topic, and lets an operator publish a test message.
 * Degrades to a "capability not yet activated" notice when neither route serves.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Inbox, Loader2, RefreshCw, Send } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { gatewayPost } from '@/lib/gateway'

interface TopicInfo {
  name: string
  depth?: number
  consumers?: number
  subscribers?: number
}

interface BrokerMessage {
  id?: string
  topic?: string
  payload?: unknown
  sender?: string
  timestamp?: number | string
}

/** Try the dedicated broker route, then fall back to the canonical bus tool. */
async function brokerCall<T>(action: string, extra: Record<string, unknown> = {}) {
  const primary = await gatewayPost<T>('/broker', { action, ...extra })
  if (primary.ok || !primary.unavailable) return primary
  // Fallback: the canonical graph_bus action tool (enveloped as {status,result}).
  return gatewayPost<T>('/bus', { action, ...extra })
}

function asStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

function adaptTopics(raw: unknown): TopicInfo[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const list = (Array.isArray(obj) ? obj : (obj.topics ?? obj.queues ?? [])) as unknown[]
  return list.map((t) => {
    if (typeof t === 'string') return { name: t }
    const r = (t ?? {}) as Record<string, unknown>
    return {
      name: asStr(r.name) || asStr(r.topic) || asStr(r.id, 'topic'),
      depth: typeof r.depth === 'number' ? r.depth : typeof r.pending === 'number' ? r.pending : undefined,
      consumers: typeof r.consumers === 'number' ? r.consumers : undefined,
      subscribers: typeof r.subscribers === 'number' ? r.subscribers : undefined,
    }
  })
}

function adaptMessages(raw: unknown): BrokerMessage[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const list = (Array.isArray(obj) ? obj : (obj.messages ?? [])) as Record<string, unknown>[]
  return list.map((m) => ({
    id: typeof m.id === 'string' ? m.id : undefined,
    topic: typeof m.topic === 'string' ? m.topic : undefined,
    payload: m.payload ?? m.body ?? m.content,
    sender: typeof m.sender === 'string' ? m.sender : typeof m.from === 'string' ? m.from : undefined,
    timestamp: typeof m.timestamp === 'number' || typeof m.timestamp === 'string' ? m.timestamp : undefined,
  }))
}

export default function BrokerView() {
  const [topics, setTopics] = useState<TopicInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<BrokerMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [publishTopic, setPublishTopic] = useState('')
  const [publishBody, setPublishBody] = useState('')
  const [publishing, setPublishing] = useState(false)

  const loadTopics = async () => {
    setLoading(true)
    const r = await brokerCall<unknown>('topics')
    setUnavailable(r.unavailable)
    if (r.ok) {
      const parsed = adaptTopics(r.data)
      setTopics(parsed)
      if (!selected && parsed[0]) setSelected(parsed[0].name)
    } else {
      setTopics([])
    }
    setLoading(false)
  }

  const loadMessages = async (topic: string) => {
    const r = await brokerCall<unknown>('messages', { topic, limit: 25 })
    if (r.ok) setMessages(adaptMessages(r.data))
    else setMessages([])
  }

  useEffect(() => {
    void loadTopics()
  }, [])

  useEffect(() => {
    if (selected) void loadMessages(selected)
  }, [selected])

  const publish = async () => {
    const topic = publishTopic.trim() || selected
    if (!topic) {
      toast.warning('Choose or enter a topic to publish to.')
      return
    }
    setPublishing(true)
    let payload: unknown = publishBody
    try {
      payload = JSON.parse(publishBody)
    } catch {
      // Not JSON — publish the raw string.
    }
    const r = await brokerCall<unknown>('publish', { topic, payload })
    if (r.ok) {
      toast.success(`Published to ${topic}`)
      setPublishBody('')
      if (topic === selected) void loadMessages(topic)
      void loadTopics()
    } else if (r.unavailable) {
      toast.error('Broker route not activated on this backend.')
    } else {
      toast.error(`Publish failed: ${r.error ?? 'unknown error'}`)
    }
    setPublishing(false)
  }

  return (
    <div className="space-y-6" data-testid="broker-view">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="size-6" />
            Message Broker
          </h1>
          <p className="text-muted-foreground text-sm">Topics, queue depth, and message flow over the agent bus.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void loadTopics()
          }}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {unavailable && (
        <div className="rounded-md border border-amber-500/50 bg-amber-50/50 dark:bg-amber-500/10 p-3 flex items-start gap-2 text-sm">
          <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-muted-foreground">
            Neither <span className="font-mono">/graph/broker</span> nor <span className="font-mono">/graph/bus</span>{' '}
            is serving on this backend yet.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Topics</CardTitle>
            <CardDescription>{topics.length} topic(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {topics.length === 0 ? (
              <p className="text-muted-foreground text-sm">No topics reported.</p>
            ) : (
              <div className="space-y-1">
                {topics.map((t) => (
                  <button
                    type="button"
                    key={t.name}
                    onClick={() => {
                      setSelected(t.name)
                    }}
                    className={
                      'w-full text-left rounded border p-2 hover:bg-muted/50 transition-colors ' +
                      (t.name === selected ? 'bg-accent' : '')
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">{t.name}</span>
                      {t.depth !== undefined && <Badge variant="outline">{t.depth}</Badge>}
                    </div>
                    {(t.consumers !== undefined || t.subscribers !== undefined) && (
                      <span className="text-xs text-muted-foreground">{t.consumers ?? t.subscribers} consumer(s)</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Messages{selected ? ` · ${selected}` : ''}</CardTitle>
              <CardDescription>{messages.length} recent message(s)</CardDescription>
            </CardHeader>
            <CardContent>
              {messages.length === 0 ? (
                <p className="text-muted-foreground text-sm">No messages.</p>
              ) : (
                <div className="space-y-2">
                  {messages.map((m, i) => (
                    <div key={m.id ?? `msg-${String(i)}`} className="rounded border p-2 text-sm">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>{m.sender ?? 'unknown'}</span>
                        <span>{m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}</span>
                      </div>
                      <pre className="font-mono text-xs whitespace-pre-wrap break-words">
                        {typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publish</CardTitle>
              <CardDescription>Send a test message (JSON or raw string).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                aria-label="Publish topic"
                placeholder={selected ?? 'topic'}
                value={publishTopic}
                onChange={(e) => {
                  setPublishTopic(e.target.value)
                }}
              />
              <Textarea
                aria-label="Publish body"
                placeholder='{"hello": "world"}'
                value={publishBody}
                onChange={(e) => {
                  setPublishBody(e.target.value)
                }}
                rows={3}
                className="font-mono text-sm"
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    void publish()
                  }}
                  disabled={publishing || !publishBody.trim()}
                >
                  {publishing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />}
                  Publish
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
