import React, { useState, useEffect, useMemo } from 'react'
import {
  Calendar as CalendarIcon,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  MessageCircle,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

interface CronTask {
  id: string
  name: string
  schedule: string
  last_run?: string
  next_run?: string
  status?: 'success' | 'failure' | 'idle'
}

interface CronLog {
  timestamp: string
  task_id: string
  task_name: string
  output: string
  status: 'success' | 'error'
  chat_id?: string
}

export default function SchedulingView() {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const [logs, setLogs] = useState<CronLog[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')

  useEffect(() => {
    void fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [tasksRes, logsRes] = await Promise.all([
        fetch('/api/enhanced/cron/calendar'),
        fetch('/api/enhanced/cron/logs'),
      ])

      const tasksData = (await tasksRes.json()) as CronTask[]
      const logsData = (await logsRes.json()) as CronLog[]

      setTasks(tasksData)
      setLogs(logsData)
    } catch (_err) {
      toast.error('Failed to load scheduling data')
    } finally {
      setLoading(false)
    }
  }

  const weekDays = useMemo(() => {
    const startOfWeek = new Date(currentDate)
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay())

    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(startOfWeek)
      day.setDate(startOfWeek.getDate() + i)
      return day
    })
  }, [currentDate])

  const monthDays = useMemo(() => {
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const startDay = startOfMonth.getDay()
    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()

    const days = []

    for (let i = 0; i < startDay; i++) {
      const day = new Date(startOfMonth)
      day.setDate(startOfMonth.getDate() - (startDay - i))
      days.push(day)
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), i))
    }

    const remaining = 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      const day = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, i)
      days.push(day)
    }
    return days
  }, [currentDate])

  const hours = Array.from({ length: 24 }, (_, i) => i)

  const getTasksForTime = (day: Date, hour: number) => {
    return tasks.filter((task) => {
      const interval = parseInt(task.schedule)
      if (isNaN(interval)) return false

      const dayStart = new Date(day)
      dayStart.setHours(hour, 0, 0, 0)

      const totalMinutes = (dayStart.getTime() - new Date(dayStart.getFullYear(), 0, 1).getTime()) / 1000 / 60
      return Math.floor(totalMinutes) % interval < 60
    })
  }

  const getTasksForDay = (_day: Date) => {
    return tasks.filter((task) => {
      const interval = parseInt(task.schedule)
      if (isNaN(interval)) return false

      return interval <= 1440
    })
  }

  return (
    <TooltipProvider>
      <div className="space-y-6 flex flex-col h-[calc(100vh-10rem)]">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Card className="xl:col-span-1">
            <CardHeader className="pb-3 border-b bg-muted/5 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="size-4 text-primary" />
                  Active Tasks
                </CardTitle>
                <CardDescription>Cron jobs from CRON.md</CardDescription>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {tasks.length} total
              </Badge>
            </CardHeader>
            <CardContent className="p-4">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-4">No tasks found.</p>
              ) : (
                <ScrollArea className="h-[340px]">
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="p-3 border border-border/60 rounded-lg flex items-center justify-between hover:bg-muted/30 transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 p-2 rounded-full group-hover:bg-primary/20 transition-colors">
                            <Clock className="size-3.5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold leading-none mb-1">{task.name || task.id}</p>
                            <p className="text-[10px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded w-fit">
                              {task.schedule} min
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-normal h-5 border-primary/20 bg-primary/5 text-primary"
                        >
                          Active
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-2 flex flex-col overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/5 flex flex-row items-center justify-between">
              <div className="flex items-center gap-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CalendarIcon className="size-4 text-primary" />
                  Forecast
                </CardTitle>
                <Tabs
                  value={viewMode}
                  onValueChange={(v: string) => {
                    setViewMode(v as 'week' | 'month')
                  }}
                >
                  <TabsList className="h-8 bg-muted/50 p-0.5">
                    <TabsTrigger value="week" className="h-7 text-xs px-3">
                      Week
                    </TabsTrigger>
                    <TabsTrigger value="month" className="h-7 text-xs px-3">
                      Month
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    const d = new Date(currentDate)
                    if (viewMode === 'week') d.setDate(d.getDate() - 7)
                    else d.setMonth(d.getMonth() - 1)
                    setCurrentDate(d)
                  }}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-xs font-semibold min-w-36 text-center">
                  {viewMode === 'week'
                    ? `${weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${weekDays[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    const d = new Date(currentDate)
                    if (viewMode === 'week') d.setDate(d.getDate() + 7)
                    else d.setMonth(d.getMonth() + 1)
                    setCurrentDate(d)
                  }}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden">
              {viewMode === 'week' ? (
                <>
                  <div className="grid grid-cols-8 border-b text-[10px] font-bold text-muted-foreground bg-muted/20">
                    <div className="p-2 border-r text-center">TIME</div>
                    {weekDays.map((day, i) => (
                      <div
                        key={i}
                        className={cn(
                          'p-2 text-center border-r last:border-0',
                          day.toDateString() === new Date().toDateString() && 'bg-primary/10 text-primary',
                        )}
                      >
                        {day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}
                        <br />
                        <span className="text-xs">{day.getDate()}</span>
                      </div>
                    ))}
                  </div>
                  <ScrollArea className="h-[340px]">
                    <div className="grid grid-cols-8">
                      {hours.map((hour) => (
                        <React.Fragment key={hour}>
                          <div className="p-2 border-r border-b text-[10px] font-mono text-center text-muted-foreground bg-muted/5">
                            {hour.toString().padStart(2, '0')}:00
                          </div>
                          {weekDays.map((day, i) => {
                            const scheduledTasks = getTasksForTime(day, hour)
                            return (
                              <div
                                key={i}
                                className="border-r border-b min-h-12 relative last:border-r-0 group hover:bg-muted/20 transition-colors"
                              >
                                {scheduledTasks.length > 0 && (
                                  <div className="absolute inset-px flex flex-col gap-0.5 p-0.5 overflow-hidden">
                                    {scheduledTasks.slice(0, 3).map((task, idx) => (
                                      <Tooltip key={idx}>
                                        <TooltipTrigger asChild>
                                          <div className="bg-primary/15 border border-primary/30 rounded-[2px] text-[8px] px-1 py-0.5 truncate cursor-help hover:bg-primary/25 transition-colors">
                                            <span className="font-bold text-primary">{task.name || task.id}</span>
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="right"
                                          className="w-64 p-3 bg-slate-900 text-slate-50 border-slate-800 shadow-2xl"
                                        >
                                          <div className="space-y-2">
                                            <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                                              <span className="font-bold text-sm text-white">
                                                {task.name || task.id}
                                              </span>
                                              <Badge className="text-[9px] bg-slate-800 text-slate-300 border-none">
                                                Recurring
                                              </Badge>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                              <div className="text-slate-400 flex items-center gap-1.5">
                                                <Clock className="size-3" /> Interval:
                                              </div>
                                              <div className="font-mono text-slate-200">{task.schedule} min</div>
                                            </div>
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    ))}
                                    {scheduledTasks.length > 3 && (
                                      <div className="text-[7px] text-center text-muted-foreground leading-none">
                                        +{scheduledTasks.length - 3} more
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <div className="p-4 grid grid-cols-7 gap-1 h-full">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="text-center text-[10px] font-bold text-muted-foreground pb-2">
                      {d.toUpperCase()}
                    </div>
                  ))}
                  {monthDays.map((day, i) => {
                    const isCurrentMonth = day.getMonth() === currentDate.getMonth()
                    const isToday = day.toDateString() === new Date().toDateString()
                    const dailyTasks = getTasksForDay(day)

                    return (
                      <div
                        key={i}
                        className={cn(
                          'border min-h-16 p-1 rounded-md transition-colors',
                          !isCurrentMonth && 'bg-muted/30 opacity-40',
                          isCurrentMonth && 'hover:bg-muted/10',
                          isToday && 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-inner',
                        )}
                      >
                        <div
                          className={cn(
                            'text-[10px] font-bold mb-1 w-5 h-5 flex items-center justify-center rounded-full',
                            isToday && 'bg-primary text-white',
                          )}
                        >
                          {day.getDate()}
                        </div>
                        <div className="space-y-0.5">
                          {dailyTasks.slice(0, 2).map((task, idx) => (
                            <div
                              key={idx}
                              className="bg-primary/10 border border-primary/20 rounded-[2px] text-[7px] px-1 truncate text-primary font-medium"
                            >
                              {task.name || task.id}
                            </div>
                          ))}
                          {dailyTasks.length > 2 && (
                            <div className="text-[7px] text-muted-foreground pl-1">+{dailyTasks.length - 2} tasks</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="flex-1 overflow-hidden flex flex-col border-border/40 shadow-sm">
          <CardHeader className="pb-3 border-b bg-muted/5 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="size-4 text-green-500" />
                Execution History
              </CardTitle>
              <CardDescription>Recent records from CRON_LOG.md</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                void fetchData()
              }}
            >
              <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full">
              <div className="p-4">
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 bg-muted animate-pulse rounded-md" />
                    ))}
                  </div>
                ) : logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/40 space-y-3">
                    <div className="bg-muted/40 p-4 rounded-full">
                      <XCircle className="size-10" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">No History Found</p>
                      <p className="text-xs">CRON_LOG.md appears to be empty or misformatted.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 max-w-4xl mx-auto">
                    {logs.map((log, i) => (
                      <div
                        key={i}
                        className="group border border-border/60 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-250 bg-card"
                      >
                        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/5 group-hover:bg-muted/10 transition-colors border-green-500/10">
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-full ring-2 ring-background bg-green-500/10 text-green-600">
                              <CheckCircle2 className="size-3" />
                            </div>
                            <span className="text-xs font-black uppercase tracking-wider">
                              {log.task_name || log.task_id}
                            </span>
                            {log.chat_id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] gap-1 text-primary hover:text-primary hover:bg-primary/10"
                                onClick={() => {
                                  window.history.pushState({}, '', `/${log.chat_id}`)
                                  window.dispatchEvent(new Event('history-state-changed'))
                                }}
                              >
                                <MessageCircle className="size-3" />
                                View Chat
                              </Button>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[9px] font-mono tracking-tighter bg-background shadow-xs"
                          >
                            {log.timestamp}
                          </Badge>
                        </div>
                        <div className="p-4 bg-muted/2 font-mono text-[11px] leading-relaxed">
                          <pre className="whitespace-pre-wrap max-h-64 overflow-y-auto custom-scrollbar pr-4 text-muted-foreground/90 selection:bg-primary/20">
                            {log.output || 'No output generated.'}
                          </pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
