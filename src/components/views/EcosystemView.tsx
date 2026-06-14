import { useState, useEffect, type SyntheticEvent } from 'react'
import {
  Network,
  Server,
  Cpu,
  HardDrive,
  Play,
  Square,
  RotateCcw,
  Terminal,
  X,
  GitPullRequest,
  RefreshCw,
  BarChart2,
  Flame,
  Heart,
  Plus,
  Check,
  Calendar,
  Activity,
  Database,
  LayoutGrid,
  Layers,
  GitBranch,
  GitMerge,
  Sliders,
  Mail,
  Download,
  Compass,
  Search,
  FileText,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Host {
  alias: string
  hostname: string
  user: string
  port: number
  identity_file?: string
  status: string
}

interface SystemResources {
  cpu_percent: number
  memory: {
    percent: number
    used_gb: number
    total_gb: number
  }
  disk: {
    percent: number
    used_gb: number
    total_gb: number
  }
}

interface ProcessInfo {
  pid: number
  name: string
  user: string
  cpu: number
  memory: number
}

interface ContainerInfo {
  id: string
  name: string
  state: string
  status: string
  image: string
}

interface RepoInfo {
  name: string
  branch: string
  modified_count: number
  path: string
  status: string
}

// Additional Interfaces for the 14 new services
interface KanbanIssue {
  id: string
  title: string
  priority: string
  assignee: string
}

interface KanbanColumn {
  id: string
  title: string
  issues: KanbanIssue[]
}

interface GithubPr {
  id: number
  title: string
  author: string
  branch: string
  status: string
  checks: string
}

interface GithubWorkflow {
  name: string
  status: string
  conclusion: string
  run_number: number
}

interface GitlabMr {
  id: number
  title: string
  author: string
  target_branch: string
  status: string
}

interface GitlabPipeline {
  id: number
  ref: string
  status: string
  duration: string
}

interface PortainerStack {
  name: string
  services: number
  status: string
  type: string
}

interface LossData {
  epoch: number
  loss: number
  val_loss: number
}

interface TrainingMetrics {
  model_name: string
  hyperparameters: {
    learning_rate: number
    batch_size: number
    epochs: number
    optimizer: string
  }
  metrics: {
    current_epoch: number
    loss: number
    val_loss: number
    accuracy: number
  }
  loss_curve: LossData[]
}

interface ScholarxPaper {
  id: string
  title: string
  author: string
  category: string
  status: string
}

interface UptimeMonitor {
  name: string
  url: string
  status: string
  uptime_24h: number
  latency: number
}

interface SearxngResult {
  title: string
  url: string
  score: number
  engine: string
}

interface HaDevice {
  entity_id: string
  friendly_name: string
  state: string
  brightness?: number
  temperature?: number
  target_temp?: number
}

interface NextcloudEvent {
  id: string
  title: string
  start: string
  end: string
  type: string
}

interface NextcloudTask {
  id: string
  title: string
  completed: boolean
}

interface MicrosoftEmail {
  id: string
  subject: string
  from: string
  received: string
  importance: string
}

interface MediaDownload {
  id: string
  url: string
  title: string
  progress: number
  speed: string
  status: string
}

interface QbittorrentTorrent {
  name: string
  size: string
  progress: number
  dl_speed: string
  ul_speed: string
  status: string
}

interface StirlingJob {
  id: string
  filename: string
  action: string
  status: string
  timestamp: string
}

export default function EcosystemView() {
  const [activeDomain, setActiveDomain] = useState<'devops' | 'research' | 'infra' | 'lifestyle' | 'media'>('devops')
  const [loading, setLoading] = useState(false)

  // Core Hosts & Systems States
  const [hosts, setHosts] = useState<Host[]>([])
  const [newHost, setNewHost] = useState({ alias: '', hostname: '', user: '', port: 22 })
  const [selectedHost, setSelectedHost] = useState('')
  const [remoteCommand, setRemoteCommand] = useState('')
  const [terminalOutput, setTerminalOutput] = useState<string[]>([])
  const [runningRemote, setRunningRemote] = useState(false)
  const [addHostOpen, setAddHostOpen] = useState(false)

  const [resources, setResources] = useState<SystemResources | null>(null)
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [searchProcess, setSearchProcess] = useState('')

  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [containerActionId, setContainerActionId] = useState<string | null>(null)

  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<string[]>([])
  const [bulkActionRunning, setBulkActionRunning] = useState(false)

  // 14 Services States
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([])
  const [githubPrs, setGithubPrs] = useState<GithubPr[]>([])
  const [githubWorkflows, setGithubWorkflows] = useState<GithubWorkflow[]>([])
  const [gitlabMrs, setGitlabMrs] = useState<GitlabMr[]>([])
  const [gitlabPipelines, setGitlabPipelines] = useState<GitlabPipeline[]>([])
  const [portainerStacks, setPortainerStacks] = useState<PortainerStack[]>([])

  const [trainingData, setTrainingData] = useState<TrainingMetrics | null>(null)
  const [scholarxPapers, setScholarxPapers] = useState<ScholarxPaper[]>([])
  const [uptimeMonitors, setUptimeMonitors] = useState<UptimeMonitor[]>([])
  const [searxngQuery, setSearxngQuery] = useState('agent-utilities')
  const [searxngResults, setSearxngResults] = useState<SearxngResult[]>([])
  const [searxngLoading, setSearxngLoading] = useState(false)

  const [haDevices, setHaDevices] = useState<HaDevice[]>([])
  const [nextcloudEvents, setNextcloudEvents] = useState<NextcloudEvent[]>([])
  const [nextcloudTasks, setNextcloudTasks] = useState<NextcloudTask[]>([])
  const [microsoftEmails, setMicrosoftEmails] = useState<MicrosoftEmail[]>([])

  const [mediaDownloads, setMediaDownloads] = useState<MediaDownload[]>([])
  const [mediaUrl, setMediaUrl] = useState('')
  const [qbittorrentTorrents, setQbittorrentTorrents] = useState<QbittorrentTorrent[]>([])
  const [stirlingJobs, setStirlingJobs] = useState<StirlingJob[]>([])

  // Culinary / Workout multipliers and states
  const [mealMultiplier, setMealMultiplier] = useState(2)
  const [workoutMuscle, setWorkoutMuscle] = useState('All')
  const [mealPlan] = useState([
    { day: 'Monday', meal: 'Protein Power Salmon & Quinoa', cal: 650, protein: '45g' },
    { day: 'Tuesday', meal: 'Avocado Cobb Salad with Turkey', cal: 520, protein: '38g' },
    { day: 'Wednesday', meal: 'Garlic Butter Grass-fed Ribeye', cal: 850, protein: '55g' },
    { day: 'Thursday', meal: 'Lemon Zest Chicken Breast & Asparagus', cal: 490, protein: '42g' },
    { day: 'Friday', meal: 'Spicy Baked Cod with Roasted Sweets', cal: 580, protein: '39g' },
  ])
  const [workoutRoutines] = useState([
    { name: 'Dumbbell Incline Bench Press', muscle: 'Chest', sets: 4, reps: '8-10' },
    { name: 'Standard Cable Chest Flyes', muscle: 'Chest', sets: 3, reps: '12-15' },
    { name: 'Alternating Hammer Dumbbell Curls', muscle: 'Biceps', sets: 4, reps: '10' },
    { name: 'Concentrated Barbell Spider Curls', muscle: 'Biceps', sets: 3, reps: '12' },
    { name: 'Standard Barbell Back Squats', muscle: 'Quads', sets: 4, reps: '8' },
    { name: 'Barbell Romanian Deadlifts', muscle: 'Hamstrings', sets: 4, reps: '10' },
  ])

  // Latency analytics static model representation
  const [latencyData] = useState([
    {
      id: 'tr-9a1b',
      route: 'POST /api/enhanced/agent/chat',
      agent: 'ECO-Agent',
      latency: 450,
      tokens: 1204,
      status: 'success',
    },
    {
      id: 'tr-7f2e',
      route: 'GET /api/enhanced/graph/magma',
      agent: 'KG-Orchestrator',
      latency: 180,
      tokens: 450,
      status: 'success',
    },
    {
      id: 'tr-3d5c',
      route: 'POST /api/enhanced/tunnel-manager/remote',
      agent: 'Tunnel-Server',
      latency: 980,
      tokens: 890,
      status: 'success',
    },
    {
      id: 'tr-1e8b',
      route: 'PUT /api/enhanced/config',
      agent: 'Settings-Agent',
      latency: 120,
      tokens: 120,
      status: 'success',
    },
    {
      id: 'tr-8d4a',
      route: 'POST /api/enhanced/voice/transcribe',
      agent: 'Speech-Agent',
      latency: 1200,
      tokens: 2100,
      status: 'success',
    },
  ])

  // Core functions
  const fetchHosts = async () => {
    try {
      const res = await fetch('/api/enhanced/tunnel-manager/hosts')
      if (res.ok) {
        const data = (await res.json()) as { hosts?: Host[] }
        setHosts(data.hosts ?? [])
        if (data.hosts && data.hosts.length > 0) {
          setSelectedHost(data.hosts[0].alias)
        }
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleAddHost = async (e: SyntheticEvent) => {
    e.preventDefault()
    if (!newHost.alias || !newHost.hostname || !newHost.user) {
      toast.error('Please complete all required host parameters')
      return
    }
    try {
      const res = await fetch('/api/enhanced/tunnel-manager/hosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHost),
      })
      if (res.ok) {
        toast.success(`Host ${newHost.alias} added successfully`)
        setNewHost({ alias: '', hostname: '', user: '', port: 22 })
        setAddHostOpen(false)
        void fetchHosts()
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to save host configuration')
    }
  }

  const runSshCommand = async () => {
    if (!selectedHost || !remoteCommand.trim()) return
    setRunningRemote(true)
    setTerminalOutput((prev) => [...prev, `genius@antigravity:~$ ssh ${selectedHost} "${remoteCommand}"`])
    try {
      const res = await fetch('/api/enhanced/tunnel-manager/remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: selectedHost, cmd: remoteCommand }),
      })
      if (res.ok) {
        const data = (await res.json()) as { stdout?: string; stderr?: string }
        if (data.stdout) {
          const out = data.stdout
          setTerminalOutput((prev) => [...prev, out])
        }
        if (data.stderr) {
          setTerminalOutput((prev) => [...prev, `[stderr]: ${data.stderr}`])
        }
        setRemoteCommand('')
      }
    } catch (err) {
      console.error(err)
      setTerminalOutput((prev) => [...prev, `ssh connection failed to ${selectedHost}`])
    } finally {
      setRunningRemote(false)
    }
  }

  const fetchSystems = async () => {
    try {
      const [resRes, procRes] = await Promise.all([
        fetch('/api/enhanced/systems-manager/resources'),
        fetch('/api/enhanced/systems-manager/processes'),
      ])
      if (resRes.ok) {
        setResources((await resRes.json()) as SystemResources)
      }
      if (procRes.ok) {
        setProcesses((await procRes.json()) as ProcessInfo[])
      }
    } catch (err) {
      console.error(err)
    }
  }

  const killProcess = async (pid: number) => {
    try {
      const res = await fetch('/api/enhanced/systems-manager/processes/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      })
      if (res.ok) {
        toast.success(`Sent SIGKILL to process ${pid}`)
        void fetchSystems()
      }
    } catch (err) {
      console.error(err)
    }
  }

  const fetchContainers = async () => {
    try {
      const res = await fetch('/api/enhanced/container-manager/containers')
      if (res.ok) {
        setContainers((await res.json()) as ContainerInfo[])
      }
    } catch (err) {
      console.error(err)
    }
  }

  const triggerContainerAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setContainerActionId(id)
    try {
      const res = await fetch(`/api/enhanced/container-manager/containers/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        toast.success(`Container ${id} action '${action}' completed`)
        void fetchContainers()
      }
    } catch (err) {
      console.error(err)
      toast.error('Docker socket command failed')
    } finally {
      setContainerActionId(null)
    }
  }

  const fetchRepos = async () => {
    try {
      const res = await fetch('/api/enhanced/repository-manager/repos')
      if (res.ok) {
        setRepos((await res.json()) as RepoInfo[])
      }
    } catch (err) {
      console.error(err)
    }
  }

  const runBulkRepoAction = async (action: 'pull' | 'build') => {
    if (selectedRepos.length === 0) {
      toast.warning('Please select at least one target repository')
      return
    }
    setBulkActionRunning(true)
    try {
      const res = await fetch('/api/enhanced/repository-manager/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, targets: selectedRepos }),
      })
      if (res.ok) {
        toast.success(`Bulk ${action} triggered successfully across ${selectedRepos.length} repos`)
        setTimeout(() => {
          setBulkActionRunning(false)
          void fetchRepos()
        }, 2000)
      }
    } catch (err) {
      console.error(err)
      setBulkActionRunning(false)
    }
  }

  // Load the 14 new services endpoints dynamically
  const loadEcosystemData = async () => {
    setLoading(true)
    try {
      // 1. DevOps Services
      const [atlassianRes, githubRes, gitlabRes, portainerRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/atlassian/kanban'),
        fetch('/api/enhanced/ecosystem/github/prs'),
        fetch('/api/enhanced/ecosystem/gitlab/mrs'),
        fetch('/api/enhanced/ecosystem/portainer/stacks'),
      ])

      if (atlassianRes.ok) {
        const d = (await atlassianRes.json()) as { columns?: KanbanColumn[] }
        setKanbanColumns(d.columns ?? [])
      }
      if (githubRes.ok) {
        const d = (await githubRes.json()) as { prs?: GithubPr[]; workflows?: GithubWorkflow[] }
        setGithubPrs(d.prs ?? [])
        setGithubWorkflows(d.workflows ?? [])
      }
      if (gitlabRes.ok) {
        const d = (await gitlabRes.json()) as { mrs?: GitlabMr[]; pipelines?: GitlabPipeline[] }
        setGitlabMrs(d.mrs ?? [])
        setGitlabPipelines(d.pipelines ?? [])
      }
      if (portainerRes.ok) {
        const d = (await portainerRes.json()) as { stacks?: PortainerStack[] }
        setPortainerStacks(d.stacks ?? [])
      }

      // 2. Data & Research Services
      const [dsRes, scholarRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/datascience/training'),
        fetch('/api/enhanced/ecosystem/scholarx/papers'),
      ])

      if (dsRes.ok) {
        setTrainingData((await dsRes.json()) as TrainingMetrics)
      }
      if (scholarRes.ok) {
        const d = (await scholarRes.json()) as { papers?: ScholarxPaper[] }
        setScholarxPapers(d.papers ?? [])
      }

      // 3. Infrastructure Hub Services
      const uptimeRes = await fetch('/api/enhanced/ecosystem/uptime/status')
      if (uptimeRes.ok) {
        const d = (await uptimeRes.json()) as { monitors?: UptimeMonitor[] }
        setUptimeMonitors(d.monitors ?? [])
      }

      // 4. Lifestyle & Productivity Services
      const [haRes, ncRes, msRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/homeassistant/devices'),
        fetch('/api/enhanced/ecosystem/nextcloud/events'),
        fetch('/api/enhanced/ecosystem/microsoft/emails'),
      ])

      if (haRes.ok) {
        const d = (await haRes.json()) as { devices?: HaDevice[] }
        setHaDevices(d.devices ?? [])
      }
      if (ncRes.ok) {
        const d = (await ncRes.json()) as { events?: NextcloudEvent[]; tasks?: NextcloudTask[] }
        setNextcloudEvents(d.events ?? [])
        setNextcloudTasks(d.tasks ?? [])
      }
      if (msRes.ok) {
        const d = (await msRes.json()) as { emails?: MicrosoftEmail[] }
        setMicrosoftEmails(d.emails ?? [])
      }

      // 5. Media & Utilities Services
      const [dlRes, qbtRes, stirlingRes] = await Promise.all([
        fetch('/api/enhanced/ecosystem/mediadownloader/downloads'),
        fetch('/api/enhanced/ecosystem/qbittorrent/torrents'),
        fetch('/api/enhanced/ecosystem/stirlingpdf/jobs'),
      ])

      if (dlRes.ok) {
        const d = (await dlRes.json()) as { queue?: MediaDownload[] }
        setMediaDownloads(d.queue ?? [])
      }
      if (qbtRes.ok) {
        const d = (await qbtRes.json()) as { torrents?: QbittorrentTorrent[] }
        setQbittorrentTorrents(d.torrents ?? [])
      }
      if (stirlingRes.ok) {
        const d = (await stirlingRes.json()) as { jobs?: StirlingJob[] }
        setStirlingJobs(d.jobs ?? [])
      }
    } catch (err) {
      console.error('Failed to load full ecosystem payloads', err)
    } finally {
      setLoading(false)
    }
  }

  // SearXNG Search action
  const runSearxngSearch = async () => {
    if (!searxngQuery.trim()) return
    setSearxngLoading(true)
    try {
      const res = await fetch(`/api/enhanced/ecosystem/searxng/search?q=${encodeURIComponent(searxngQuery)}`)
      if (res.ok) {
        const data = (await res.json()) as { results?: SearxngResult[] }
        setSearxngResults(data.results ?? [])
        toast.success(`Retrieved ${data.results?.length ?? 0} search rankings from SearXNG`)
      }
    } catch (err) {
      console.error(err)
      toast.error('SearXNG lookup failed')
    } finally {
      setSearxngLoading(false)
    }
  }

  // IoT Dimmer and switch actions simulated
  const updateDeviceState = (entityId: string, value: string | number) => {
    setHaDevices((prev) =>
      prev.map((d) => {
        if (d.entity_id === entityId) {
          if (typeof value === 'number') {
            return { ...d, brightness: value, state: value > 0 ? 'on' : 'off' }
          }
          return { ...d, state: value }
        }
        return d
      }),
    )
    toast.success(`IoT command dispatched to ${entityId}`)
  }

  const updateThermostatTemp = (entityId: string, diff: number) => {
    setHaDevices((prev) =>
      prev.map((d) => {
        if (d.entity_id === entityId && d.target_temp !== undefined) {
          const n = parseFloat((d.target_temp + diff).toFixed(1))
          return { ...d, target_temp: n }
        }
        return d
      }),
    )
  }

  // Stirling PDF simulated job dispatch
  const submitStirlingPdf = (action: string) => {
    const newJob: StirlingJob = {
      id: `pdf-${Math.floor(Math.random() * 1000)}`,
      filename: `processed_${action}_doc.pdf`,
      action,
      status: 'running',
      timestamp: 'Just now',
    }
    setStirlingJobs((prev) => [newJob, ...prev])
    toast.success(`Stirling PDF job launched successfully`)
    setTimeout(() => {
      setStirlingJobs((prev) => prev.map((j) => (j.id === newJob.id ? { ...j, status: 'completed' } : j)))
      toast.info(`PDF Action ${action} successfully completed.`)
    }, 3000)
  }

  // yt-dlp submit
  const addMediaDownload = (e: SyntheticEvent) => {
    e.preventDefault()
    if (!mediaUrl.trim()) return
    const newDl: MediaDownload = {
      id: `dl-${Math.floor(Math.random() * 1000)}`,
      url: mediaUrl,
      title: 'Parsing target streaming metadata...',
      progress: 0,
      speed: '0 B/s',
      status: 'queued',
    }
    setMediaDownloads((prev) => [newDl, ...prev])
    setMediaUrl('')
    toast.success('yt-dlp stream queued')
    setTimeout(() => {
      setMediaDownloads((prev) =>
        prev.map((d) =>
          d.id === newDl.id
            ? {
                ...d,
                title: 'Self-driven coding agents presentation',
                progress: 45.2,
                speed: '5.8 MB/s',
                status: 'downloading',
              }
            : d,
        ),
      )
    }, 2000)
  }

  useEffect(() => {
    void fetchHosts()
    void fetchSystems()
    void fetchContainers()
    void fetchRepos()
    void loadEcosystemData()
    // Periodic refresh
    const interval = setInterval(() => {
      void fetchSystems()
      void fetchContainers()
    }, 15000)
    return () => {
      clearInterval(interval)
    }
  }, [])

  const filteredProcesses = processes.filter(
    (p) => p.name.toLowerCase().includes(searchProcess.toLowerCase()) || p.pid.toString().includes(searchProcess),
  )

  return (
    <div className="w-full h-full flex flex-col gap-6 text-foreground bg-background">
      {/* Premium Glassmorphic Domain Selection Navbar */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-accent/30 rounded-lg border border-border shadow-sm items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setActiveDomain('devops')
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeDomain === 'devops'
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitPullRequest className="size-4" />
            DevOps & Tasks
          </button>
          <button
            onClick={() => {
              setActiveDomain('research')
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeDomain === 'research'
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            <BarChart2 className="size-4" />
            Data & Research
          </button>
          <button
            onClick={() => {
              setActiveDomain('infra')
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeDomain === 'infra'
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Network className="size-4" />
            Infrastructure Hub
          </button>
          <button
            onClick={() => {
              setActiveDomain('lifestyle')
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeDomain === 'lifestyle'
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Heart className="size-4" />
            Lifestyle & Home
          </button>
          <button
            onClick={() => {
              setActiveDomain('media')
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeDomain === 'media'
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'hover:bg-accent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Download className="size-4" />
            Media & Utilities
          </button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void loadEcosystemData()
            void fetchHosts()
            void fetchSystems()
            void fetchContainers()
            void fetchRepos()
          }}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={cn('size-3.5', { 'animate-spin': loading })} />
          Refresh
        </Button>
      </div>

      {/* Primary content areas rendering */}
      <div className="flex-1 min-h-[600px] space-y-6">
        {/* 1. DEVOPS & TASKS DOMAIN */}
        {activeDomain === 'devops' && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            {/* Jira / Atlassian Kanban board */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <LayoutGrid className="text-primary size-5" /> Agile Scrum Board (Atlassian-Agent)
                    </CardTitle>
                    <CardDescription>Visual Sprint logs and backlog mapping inside Atlassian APIs</CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
                    Active Sprint
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {kanbanColumns.map((col) => (
                    <div key={col.id} className="bg-accent/15 p-4 rounded-lg border border-border/40 space-y-3">
                      <div className="flex justify-between items-center border-b pb-2">
                        <span className="font-bold text-xs uppercase tracking-wide text-muted-foreground">
                          {col.title}
                        </span>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {col.issues.length}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {col.issues.map((iss) => (
                          <div
                            key={iss.id}
                            className="p-3 bg-background border rounded-md hover:border-primary/30 transition-all shadow-sm space-y-2"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-mono text-[10px] font-bold text-primary">{iss.id}</span>
                              <Badge
                                className="text-[9px] uppercase tracking-wide scale-90"
                                variant={
                                  iss.priority === 'Highest' || iss.priority === 'High' ? 'destructive' : 'secondary'
                                }
                              >
                                {iss.priority}
                              </Badge>
                            </div>
                            <h4 className="text-xs font-semibold text-foreground leading-snug">{iss.title}</h4>
                            <div className="flex justify-end pt-1">
                              <span className="size-5 rounded-full bg-accent text-[9px] font-extrabold flex items-center justify-center border uppercase text-muted-foreground">
                                {iss.assignee.substring(0, 2)}
                              </span>
                            </div>
                          </div>
                        ))}
                        {col.issues.length === 0 && (
                          <div className="text-center py-6 text-xs text-muted-foreground font-mono">Column Empty</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* GitHub Actions & GitLab Pipelines */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border border-border/80 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <GitBranch className="text-purple-500 size-4.5" /> Pull Requests & Workflows (GitHub-Agent)
                  </CardTitle>
                  <CardDescription>Live actions CI execution streams</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2.5">
                    {githubPrs.map((pr) => (
                      <div
                        key={pr.id}
                        className="flex items-center justify-between p-2.5 border rounded-md bg-accent/5"
                      >
                        <div className="space-y-1 truncate pr-2">
                          <h4 className="text-xs font-bold text-foreground truncate flex items-center gap-1.5">
                            #{pr.id} {pr.title}
                          </h4>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">
                            by {pr.author} | branch: <span className="text-primary font-semibold">{pr.branch}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Badge
                            variant="outline"
                            className="capitalize text-[10px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20"
                          >
                            {pr.status}
                          </Badge>
                          <Badge variant="secondary" className="text-[9px] uppercase">
                            {pr.checks}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-4 space-y-2">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      CI Actions Runs
                    </h5>
                    <div className="space-y-1.5 text-xs">
                      {githubWorkflows.map((wf, idx) => (
                        <div key={idx} className="flex justify-between items-center font-mono">
                          <span className="text-foreground">
                            Run #{wf.run_number} - {wf.name}
                          </span>
                          <Badge variant="default" className="text-[9px] px-1 py-0">
                            {wf.conclusion}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border/80 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <GitMerge className="text-orange-500 size-4.5" /> Merge Requests & Pipelines (GitLab-API)
                  </CardTitle>
                  <CardDescription>GitLab server integration logs</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2.5">
                    {gitlabMrs.map((mr) => (
                      <div
                        key={mr.id}
                        className="flex items-center justify-between p-2.5 border rounded-md bg-accent/5"
                      >
                        <div className="space-y-1 truncate pr-2">
                          <h4 className="text-xs font-bold text-foreground truncate">
                            !{mr.id} {mr.title}
                          </h4>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            by {mr.author} | target: {mr.target_branch}
                          </p>
                        </div>
                        <Badge className="text-[9px] uppercase">{mr.status}</Badge>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-4 space-y-2">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Pipelines Runs</h5>
                    <div className="space-y-1.5 text-xs">
                      {gitlabPipelines.map((p) => (
                        <div key={p.id} className="flex justify-between items-center font-mono">
                          <span className="text-foreground">
                            Pipeline #{p.id} ({p.ref})
                          </span>
                          <span className="text-muted-foreground text-[10px]">{p.duration}</span>
                          <Badge variant="secondary" className="text-[9px]">
                            {p.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Portainer stack list */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="text-primary size-5" /> Docker Compose Stacks (Portainer-Agent)
                </CardTitle>
                <CardDescription>
                  Multi-host service stacks loaded dynamically from Portainer environments
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {portainerStacks.map((stack) => (
                    <Card
                      key={stack.name}
                      className="p-4 bg-accent/5 hover:border-primary/30 transition-all flex flex-col justify-between"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-sm text-foreground leading-snug">{stack.name}</h4>
                          <p className="text-xs text-muted-foreground pt-1">{stack.services} services configured</p>
                        </div>
                        <Badge
                          variant="outline"
                          className="capitalize scale-90 bg-emerald-500/10 text-emerald-600 border-emerald-500/25"
                        >
                          {stack.status}
                        </Badge>
                      </div>
                      <div className="pt-4 flex justify-between items-center text-[10px] font-mono text-muted-foreground border-t mt-3">
                        <span>Deploy Type:</span>
                        <span className="font-bold text-foreground">{stack.type}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 2. DATA & RESEARCH DOMAIN */}
        {activeDomain === 'research' && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            {/* Systems telemetry gauges CPU/RAM/Disk */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border border-border/85 shadow-sm hover:border-primary/20 transition-all">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                      <Cpu className="text-primary size-4" /> CPU Workload
                    </CardTitle>
                    <Activity className="size-4 text-emerald-500 animate-pulse" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-extrabold tracking-tight mb-2">{resources?.cpu_percent ?? 24.5}%</div>
                  <div className="w-full bg-accent h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-500"
                      style={{ width: `${resources?.cpu_percent ?? 24.5}%` }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border/85 shadow-sm hover:border-primary/20 transition-all">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                    <Server className="text-primary size-4" /> RAM Utilization
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-extrabold tracking-tight mb-2">
                    {resources?.memory.percent ?? 42.1}%
                  </div>
                  <div className="w-full bg-accent h-2.5 rounded-full overflow-hidden mb-1">
                    <div
                      className="bg-purple-500 h-full transition-all duration-500"
                      style={{ width: `${resources?.memory.percent ?? 42.1}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span>Used: {resources?.memory.used_gb ?? 6.7} GB</span>
                    <span>Total: {resources?.memory.total_gb ?? 16.0} GB</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border/85 shadow-sm hover:border-primary/20 transition-all">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                    <HardDrive className="text-primary size-4" /> Disk Capacity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-extrabold tracking-tight mb-2">{resources?.disk.percent ?? 68.3}%</div>
                  <div className="w-full bg-accent h-2.5 rounded-full overflow-hidden mb-1">
                    <div
                      className="bg-blue-500 h-full transition-all duration-500"
                      style={{ width: `${resources?.disk.percent ?? 68.3}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span>Used: {resources?.disk.used_gb ?? 341.5} GB</span>
                    <span>Total: {resources?.disk.total_gb ?? 500.0} GB</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Model training parameters and visual loss curves */}
            {trainingData && (
              <Card className="border border-border/80 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sliders className="text-primary size-5" /> iModel Training Loop Analytics (Data-Science-MCP)
                  </CardTitle>
                  <CardDescription>Live epoch progress, accuracy vectors, and hyperparameter metrics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Hyperparameters Card */}
                    <div className="space-y-3 p-4 bg-accent/5 rounded-lg border">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Model Parameters: {trainingData.model_name}
                      </h4>
                      <div className="grid grid-cols-2 gap-3 text-xs pt-1.5">
                        <div>
                          <span className="text-muted-foreground">Learning Rate:</span>
                          <p className="font-mono font-bold text-primary">
                            {trainingData.hyperparameters.learning_rate}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Batch Size:</span>
                          <p className="font-mono font-bold text-foreground">
                            {trainingData.hyperparameters.batch_size}
                          </p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Epochs Target:</span>
                          <p className="font-mono font-bold text-foreground">{trainingData.hyperparameters.epochs}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Optimizer:</span>
                          <p className="font-mono font-bold text-foreground">
                            {trainingData.hyperparameters.optimizer}
                          </p>
                        </div>
                      </div>
                      <div className="border-t pt-3 space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span>Accuracy score:</span>
                          <span className="font-bold text-emerald-500">{trainingData.metrics.accuracy}%</span>
                        </div>
                        <div className="w-full bg-accent h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full"
                            style={{ width: `${trainingData.metrics.accuracy}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Mini SVG Loss Curve */}
                    <div className="flex flex-col justify-between p-4 bg-accent/5 rounded-lg border">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Epoch Loss Curves (Simulated Convergence)
                        </h4>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          Epoch {trainingData.metrics.current_epoch} / {trainingData.hyperparameters.epochs}
                        </Badge>
                      </div>
                      <div className="h-28 w-full flex items-end gap-1.5 pt-4">
                        {trainingData.loss_curve.map((l, idx) => (
                          <div
                            key={idx}
                            className="flex-1 flex flex-col items-center justify-end h-full group relative"
                          >
                            {/* Bar representing val_loss */}
                            <div
                              className="w-full bg-red-500/25 rounded-t group-hover:bg-red-500/40 transition-colors"
                              style={{ height: `${l.val_loss * 100}%` }}
                            />
                            {/* Bar representing train loss */}
                            <div
                              className="w-full bg-primary rounded-t group-hover:bg-primary/80 transition-colors -mt-1"
                              style={{ height: `${l.loss * 100}%` }}
                            />
                            <span className="text-[8px] font-mono text-muted-foreground pt-1.5">E{l.epoch}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ScholarX Research Scientific literature */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Compass className="text-primary size-5" /> Scientific Publications database (ScholarX)
                </CardTitle>
                <CardDescription>
                  Scientific paper metadata registries downloaded locally for Offline Graph training
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {scholarxPapers.map((paper) => (
                    <Card
                      key={paper.id}
                      className="p-4 bg-accent/5 border hover:border-primary/20 transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold font-mono text-primary uppercase">{paper.id}</span>
                          <Badge variant="secondary" className="text-[9px] uppercase">
                            {paper.category}
                          </Badge>
                        </div>
                        <h4 className="font-bold text-xs text-foreground tracking-tight pt-2 leading-snug line-clamp-2">
                          {paper.title}
                        </h4>
                        <p className="text-[10px] text-muted-foreground pt-1">Author: {paper.author}</p>
                      </div>
                      <div className="pt-3 border-t mt-3 flex justify-between items-center text-[10px] text-emerald-500 font-bold">
                        <span className="flex items-center gap-1">
                          <Check className="size-3" /> Ready
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[9px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20"
                        >
                          {paper.status}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Agent Latency Traces Table */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="text-primary size-5" /> Agent API Execution Latency Traces (Langfuse-Agent)
                </CardTitle>
                <CardDescription>Live call spans, execution times, and token cost tracking logs</CardDescription>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-accent/40 border-b">
                    <tr>
                      <th className="p-3.5 font-semibold text-muted-foreground w-28">Trace ID</th>
                      <th className="p-3.5 font-semibold text-muted-foreground">API Gateway Route</th>
                      <th className="p-3.5 font-semibold text-muted-foreground w-40">Agent Name</th>
                      <th className="p-3.5 font-semibold text-muted-foreground text-right w-28">Latency</th>
                      <th className="p-3.5 font-semibold text-muted-foreground text-right w-24">Tokens</th>
                      <th className="p-3.5 font-semibold text-muted-foreground text-center w-24">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    {latencyData.map((trace) => (
                      <tr key={trace.id} className="hover:bg-accent/10 transition-colors">
                        <td className="p-3.5 font-bold text-primary">{trace.id}</td>
                        <td className="p-3.5 text-foreground font-semibold">{trace.route}</td>
                        <td className="p-3.5 text-muted-foreground">{trace.agent}</td>
                        <td className="p-3.5 text-right text-orange-500 font-bold">{trace.latency} ms</td>
                        <td className="p-3.5 text-right text-foreground">{trace.tokens}</td>
                        <td className="p-3.5 text-center">
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          >
                            {trace.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 3. INFRASTRUCTURE HUB DOMAIN */}
        {activeDomain === 'infra' && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            {/* Uptime Kuma monitors */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="text-emerald-500 size-5 animate-pulse" /> Service Uptime timelines
                  (Uptime-Kuma-Agent)
                </CardTitle>
                <CardDescription>Active health checks on gateways, DNS databases and storage streams</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {uptimeMonitors.map((m) => (
                    <Card
                      key={m.name}
                      className="p-4 bg-accent/5 hover:border-primary/20 transition-all flex flex-col justify-between"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-xs text-foreground truncate">{m.name}</h4>
                          <span className="text-[10px] font-mono text-muted-foreground truncate block">{m.url}</span>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn('capitalize scale-90 font-semibold px-2 py-0.5 rounded-full border', {
                            'bg-emerald-500/10 border-emerald-500/25 text-emerald-600': m.status === 'up',
                            'bg-red-500/10 border-red-500/25 text-red-600': m.status === 'down',
                          })}
                        >
                          {m.status}
                        </Badge>
                      </div>
                      <div className="pt-4 space-y-1 border-t mt-3">
                        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                          <span>Uptime 24h:</span>
                          <span className="font-bold text-foreground">{m.uptime_24h}%</span>
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                          <span>Latency:</span>
                          <span className="font-bold text-primary">{m.latency}ms</span>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* SearXNG searchranks and keyword plotting */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader className="flex flex-col md:flex-row md:items-center justify-between pb-3 gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="text-primary size-5" /> Metasearch Aggregation & Ranks (SearXNG-MCP)
                  </CardTitle>
                  <CardDescription>
                    Aggregate web query rankings parsed across google, duckduckgo and github engines
                  </CardDescription>
                </div>
                <div className="flex gap-2 max-w-sm w-full">
                  <Input
                    placeholder="Search keywords..."
                    value={searxngQuery}
                    onChange={(e) => {
                      setSearxngQuery(e.target.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearxngSearch()
                    }}
                  />
                  <Button
                    onClick={() => {
                      void runSearxngSearch()
                    }}
                    disabled={searxngLoading}
                  >
                    {searxngLoading ? <RefreshCw className="size-4 animate-spin" /> : 'Search'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {searxngResults.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground font-mono border rounded-md">
                    Search something to load results
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {searxngResults.map((r, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center p-3 border rounded-md bg-accent/5 hover:border-primary/30 transition-all"
                      >
                        <div className="space-y-0.5 truncate pr-2">
                          <h4 className="text-xs font-bold text-foreground truncate">{r.title}</h4>
                          <span className="text-[10px] font-mono text-muted-foreground truncate block">{r.url}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge
                            variant="outline"
                            className="font-mono text-[9px] uppercase tracking-wide bg-primary/5 text-primary border-primary/20"
                          >
                            {r.engine}
                          </Badge>
                          <Badge variant="secondary" className="font-mono text-xs font-bold">
                            Score: {r.score}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Docker socket container grids */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="text-primary size-5" /> Docker Daemon Containers
                  </CardTitle>
                  <CardDescription>Direct unix-socket queries to /var/run/docker.sock</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    void fetchContainers()
                  }}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {containers.map((c) => (
                    <Card
                      key={c.id}
                      className="bg-accent/5 border hover:border-primary/20 transition-all flex flex-col justify-between"
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm font-bold truncate tracking-tight text-primary">
                            {c.name}
                          </CardTitle>
                          <Badge
                            variant="outline"
                            className={cn('capitalize px-2 py-0.5 text-xs font-semibold rounded-full border', {
                              'bg-emerald-500/10 border-emerald-500/25 text-emerald-600': c.state === 'running',
                              'bg-red-500/10 border-red-500/25 text-red-600': c.state === 'exited',
                              'bg-amber-500/10 border-amber-500/25 text-amber-600': c.state === 'paused',
                            })}
                          >
                            {c.state}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs truncate font-mono text-muted-foreground pt-1">
                          ID: {c.id} | Image: {c.image}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pb-3 text-xs leading-relaxed text-muted-foreground flex-1 flex flex-col justify-end">
                        <p>
                          <strong className="text-foreground">Status:</strong> {c.status}
                        </p>
                      </CardContent>
                      <CardFooter className="pt-2 pb-4 flex justify-between gap-2 border-t bg-muted/20">
                        {c.state !== 'running' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-xs gap-1.5"
                            onClick={() => {
                              void triggerContainerAction(c.id, 'start')
                            }}
                            disabled={containerActionId === c.id}
                          >
                            <Play className="size-3 text-emerald-600" /> Start
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-xs gap-1.5"
                            onClick={() => {
                              void triggerContainerAction(c.id, 'stop')
                            }}
                            disabled={containerActionId === c.id}
                          >
                            <Square className="size-3 text-red-600" /> Stop
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs gap-1.5"
                          onClick={() => {
                            void triggerContainerAction(c.id, 'restart')
                          }}
                          disabled={containerActionId === c.id}
                        >
                          <RotateCcw className="size-3 text-blue-600" /> Restart
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Active processes tree and SSH tunnel console */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 flex flex-col gap-6">
                <Card className="border border-border/80 shadow-md">
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Network className="text-primary size-5" /> Host Aliases Inventory
                      </CardTitle>
                      <CardDescription>Ansible configurations loaded via tunnel-manager</CardDescription>
                    </div>
                    <Dialog open={addHostOpen} onOpenChange={setAddHostOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" className="gap-1.5">
                          <Plus className="size-4" /> Add Host
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <form
                          onSubmit={(e) => {
                            void handleAddHost(e)
                          }}
                        >
                          <DialogHeader>
                            <DialogTitle>Add SSH Host Alias</DialogTitle>
                            <DialogDescription>
                              Input new node configurations for SSH command forwarding.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                              <label className="text-right text-sm font-medium">Alias</label>
                              <Input
                                className="col-span-3"
                                placeholder="production-node"
                                value={newHost.alias}
                                onChange={(e) => {
                                  setNewHost({ ...newHost, alias: e.target.value })
                                }}
                              />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <label className="text-right text-sm font-medium">IP/Host</label>
                              <Input
                                className="col-span-3"
                                placeholder="10.0.0.12"
                                value={newHost.hostname}
                                onChange={(e) => {
                                  setNewHost({ ...newHost, hostname: e.target.value })
                                }}
                              />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <label className="text-right text-sm font-medium">User</label>
                              <Input
                                className="col-span-3"
                                placeholder="ubuntu"
                                value={newHost.user}
                                onChange={(e) => {
                                  setNewHost({ ...newHost, user: e.target.value })
                                }}
                              />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <label className="text-right text-sm font-medium">Port</label>
                              <Input
                                type="number"
                                className="col-span-3"
                                value={newHost.port}
                                onChange={(e) => {
                                  setNewHost({ ...newHost, port: parseInt(e.target.value) || 22 })
                                }}
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button type="submit">Register Host</Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {hosts.map((h) => (
                        <div
                          key={h.alias}
                          className="flex flex-col gap-3 p-4 bg-accent/10 border rounded-lg hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="font-bold text-sm tracking-wide text-primary">{h.alias}</h3>
                            <Badge variant={h.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                              {h.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>
                              <strong className="text-foreground">Hostname:</strong> {h.hostname}
                            </p>
                            <p>
                              <strong className="text-foreground">Credential:</strong> {h.user}@{h.port}
                            </p>
                            {h.identity_file && (
                              <p>
                                <strong className="text-foreground">Identity:</strong> {h.identity_file}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* SSH Remote Command shell */}
                <Card className="border border-border/80 shadow-md">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="text-green-500 size-5" /> Interactive Remote Executor
                    </CardTitle>
                    <CardDescription>Dispatch secure remote shell scripts on selected inventory node</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-4">
                      <div className="w-1/3">
                        <select
                          value={selectedHost}
                          onChange={(e) => {
                            setSelectedHost(e.target.value)
                          }}
                          className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                          {hosts.map((h) => (
                            <option key={h.alias} value={h.alias}>
                              {h.alias}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1 flex gap-2">
                        <Input
                          placeholder="Type remote shell command (e.g. docker ps, uname -a)..."
                          value={remoteCommand}
                          onChange={(e) => {
                            setRemoteCommand(e.target.value)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void runSshCommand()
                          }}
                        />
                        <Button
                          onClick={() => {
                            void runSshCommand()
                          }}
                          disabled={runningRemote || !remoteCommand.trim()}
                        >
                          {runningRemote ? <RefreshCw className="size-4 animate-spin" /> : 'Run Command'}
                        </Button>
                      </div>
                    </div>
                    <div className="bg-zinc-950 text-green-400 font-mono text-xs p-4 rounded-md border h-60 overflow-y-auto space-y-2.5">
                      {terminalOutput.map((line, idx) => (
                        <div key={idx} className="whitespace-pre-wrap leading-relaxed">
                          {line}
                        </div>
                      ))}
                      {runningRemote && (
                        <div className="text-muted-foreground animate-pulse">
                          Running secure remote tunnel connection...
                        </div>
                      )}
                      {terminalOutput.length === 0 && (
                        <div className="text-muted-foreground">Terminal ready. Output will stream here.</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Active Process tree */}
              <Card className="border border-border/80 shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                      <Terminal className="text-primary size-4.5" /> Process Workloads
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => {
                        void fetchSystems()
                      }}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Search process..."
                    className="h-8 text-xs mt-2"
                    value={searchProcess}
                    onChange={(e) => {
                      setSearchProcess(e.target.value)
                    }}
                  />
                </CardHeader>
                <CardContent className="p-0 border-t max-h-[380px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-accent/40 sticky top-0 border-b">
                      <tr>
                        <th className="p-2 font-semibold text-muted-foreground">PID</th>
                        <th className="p-2 font-semibold text-muted-foreground">Name</th>
                        <th className="p-2 font-semibold text-muted-foreground text-right">CPU</th>
                        <th className="p-2 font-semibold text-muted-foreground text-right w-16">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono">
                      {filteredProcesses.map((p) => (
                        <tr key={p.pid} className="hover:bg-accent/10 transition-colors">
                          <td className="p-2 text-muted-foreground font-bold">{p.pid}</td>
                          <td className="p-2 truncate max-w-[100px] font-semibold text-foreground" title={p.name}>
                            {p.name}
                          </td>
                          <td className="p-2 text-right text-green-500 font-bold">{p.cpu}%</td>
                          <td className="p-2 text-right">
                            <Button
                              variant="ghost"
                              className="h-5 px-1.5 text-[10px] text-red-500 hover:text-red-700 hover:bg-red-500/10 font-sans"
                              onClick={() => {
                                void killProcess(p.pid)
                              }}
                            >
                              Kill
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* 4. LIFESTYLE & AUTOMATION DOMAIN */}
        {activeDomain === 'lifestyle' && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            {/* IoT Device sliders (Home-Assistant-Agent) */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sliders className="text-primary size-5" /> IoT Home automation controls (Home-Assistant-Agent)
                </CardTitle>
                <CardDescription>
                  Visual dials, thermostats, and lights controls loaded from local Home Assistant server
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {haDevices.map((d) => (
                    <Card
                      key={d.entity_id}
                      className="p-4 bg-accent/5 flex flex-col justify-between hover:border-primary/20 transition-all"
                    >
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <h4 className="font-bold text-xs text-foreground truncate">{d.friendly_name}</h4>
                          <Badge
                            variant={d.state === 'on' || d.state === 'heat' ? 'default' : 'secondary'}
                            className="capitalize text-[9px]"
                          >
                            {d.state}
                          </Badge>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground">{d.entity_id}</span>
                      </div>

                      {/* Display dimmer sliders for lights */}
                      {d.brightness !== undefined && (
                        <div className="pt-4 space-y-2">
                          <div className="flex justify-between text-[10px] font-mono">
                            <span>Brightness:</span>
                            <span className="font-bold">{d.brightness}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={d.brightness}
                            onChange={(e) => {
                              updateDeviceState(d.entity_id, parseInt(e.target.value))
                            }}
                            className="w-full accent-primary h-1.5 bg-accent rounded-lg cursor-pointer"
                          />
                        </div>
                      )}

                      {/* Climate Thermostat temperature controls */}
                      {d.temperature !== undefined && d.target_temp !== undefined && (
                        <div className="pt-4 space-y-3">
                          <div className="flex justify-between text-xs font-mono">
                            <span>
                              Room: <strong className="text-foreground">{d.temperature}°C</strong>
                            </span>
                            <span>
                              Target: <strong className="text-primary">{d.target_temp}°C</strong>
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 font-bold flex-1"
                              onClick={() => {
                                updateThermostatTemp(d.entity_id, -0.5)
                              }}
                            >
                              -0.5°
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 font-bold flex-1"
                              onClick={() => {
                                updateThermostatTemp(d.entity_id, 0.5)
                              }}
                            >
                              +0.5°
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* General toggles for generic smart switches */}
                      {d.brightness === undefined && d.temperature === undefined && (
                        <div className="pt-4">
                          <Button
                            variant={d.state === 'on' ? 'destructive' : 'default'}
                            size="sm"
                            className="w-full text-xs h-8"
                            onClick={() => {
                              updateDeviceState(d.entity_id, d.state === 'on' ? 'off' : 'on')
                            }}
                          >
                            {d.state === 'on' ? 'Power OFF' : 'Power ON'}
                          </Button>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Nextcloud Tasks / Calendars & MS Outlook Inbox */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Calendars Nextcloud */}
              <Card className="border border-border/80 shadow-md lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="text-primary size-5" /> Calendar & Tasks Agenda (Nextcloud-Agent)
                  </CardTitle>
                  <CardDescription>
                    Productivity synchronizer wiring personal schedule with CalDAV servers
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      Upcoming Calendars
                    </h5>
                    <div className="space-y-2">
                      {nextcloudEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center justify-between p-2 border rounded-md bg-accent/5"
                        >
                          <div className="space-y-0.5">
                            <h4 className="text-xs font-semibold text-foreground">{ev.title}</h4>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {new Date(ev.start).toLocaleString()}
                            </span>
                          </div>
                          <Badge variant="secondary" className="text-[9px] uppercase tracking-wide">
                            {ev.type}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pt-4 space-y-2">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Pending Tasks</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {nextcloudTasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 p-2 border rounded-md bg-accent/5">
                          <div
                            className={cn(
                              'size-4 rounded-full border flex items-center justify-center flex-shrink-0',
                              {
                                'bg-emerald-500 border-emerald-500 text-white': t.completed,
                                'border-input': !t.completed,
                              },
                            )}
                          >
                            {t.completed && <Check className="size-3" />}
                          </div>
                          <span className={cn('truncate', { 'line-through text-muted-foreground': t.completed })}>
                            {t.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* MS Exchange / Outlook */}
              <Card className="border border-border/80 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Mail className="text-blue-500 size-4.5" /> Outlook Graph Inbox (Microsoft-Agent)
                  </CardTitle>
                  <CardDescription>Synced MS Exchange emails summaries</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2.5">
                    {microsoftEmails.map((mail) => (
                      <div
                        key={mail.id}
                        className="p-3 border rounded-md hover:border-primary/20 transition-all bg-accent/5 space-y-1 relative"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-primary truncate max-w-[120px]">
                            {mail.from}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground">{mail.received}</span>
                        </div>
                        <h4 className="text-xs font-bold text-foreground leading-snug truncate pr-6">
                          {mail.subject}
                        </h4>
                        {mail.importance === 'high' && (
                          <span
                            className="absolute top-3 right-3 text-red-500 font-extrabold text-[10px]"
                            title="High Importance"
                          >
                            !
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Existing Mealie planner & Wger workouts */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 flex flex-col gap-6">
                <Card className="border border-border/80 shadow-md">
                  <CardHeader className="flex flex-col md:flex-row md:items-center justify-between pb-3 gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="text-primary size-5" /> Culinary Meal Planner (Mealie-MCP)
                      </CardTitle>
                      <CardDescription>Scale ingredients and recipes dynamically</CardDescription>
                    </div>
                    <div className="flex items-center gap-2.5 bg-accent/30 p-1 rounded-md border text-xs">
                      <span className="font-bold text-muted-foreground px-2">Servings:</span>
                      <button
                        className="size-7 flex items-center justify-center font-bold bg-background border rounded hover:bg-accent"
                        onClick={() => {
                          setMealMultiplier(Math.max(1, mealMultiplier - 1))
                        }}
                      >
                        -
                      </button>
                      <span className="font-extrabold w-4 text-center">{mealMultiplier}</span>
                      <button
                        className="size-7 flex items-center justify-center font-bold bg-background border rounded hover:bg-accent"
                        onClick={() => {
                          setMealMultiplier(mealMultiplier + 1)
                        }}
                      >
                        +
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 border-t">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="bg-accent/40 border-b">
                        <tr>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-28">
                            Day
                          </th>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                            Planned Recipe
                          </th>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right w-24">
                            Calories
                          </th>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-right w-24">
                            Protein
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {mealPlan.map((m) => (
                          <tr key={m.day} className="hover:bg-accent/10 transition-colors">
                            <td className="p-3.5 font-bold text-xs text-muted-foreground uppercase">{m.day}</td>
                            <td className="p-3.5 font-semibold text-foreground tracking-tight">{m.meal}</td>
                            <td className="p-3.5 text-right font-mono font-bold text-xs text-orange-500">
                              {m.cal * mealMultiplier} kcal
                            </td>
                            <td className="p-3.5 text-right font-mono font-bold text-xs text-blue-500">
                              {parseInt(m.protein) * mealMultiplier}g
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <Card className="border border-border/80 shadow-md">
                  <CardHeader className="flex flex-col md:flex-row md:items-center justify-between pb-3 gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Flame className="text-orange-500 size-5" /> Workout Splits Builder (Wger-Agent)
                      </CardTitle>
                      <CardDescription>Tailor strength splits and reps counters</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {['All', 'Chest', 'Biceps', 'Quads'].map((muscle) => (
                        <Button
                          key={muscle}
                          variant={workoutMuscle === muscle ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => {
                            setWorkoutMuscle(muscle)
                          }}
                        >
                          {muscle}
                        </Button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 border-t">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="bg-accent/40 border-b">
                        <tr>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                            Exercise Name
                          </th>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-32">
                            Target Muscle
                          </th>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center w-24">
                            Sets
                          </th>
                          <th className="p-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground text-center w-24">
                            Reps Split
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {workoutRoutines
                          .filter((w) => workoutMuscle === 'All' || w.muscle === workoutMuscle)
                          .map((w) => (
                            <tr key={w.name} className="hover:bg-accent/10 transition-colors">
                              <td className="p-3.5 font-semibold text-foreground tracking-tight">{w.name}</td>
                              <td className="p-3.5 font-semibold text-xs">
                                <Badge variant="secondary">{w.muscle}</Badge>
                              </td>
                              <td className="p-3.5 text-center font-mono font-bold text-xs text-primary">
                                {w.sets} sets
                              </td>
                              <td className="p-3.5 text-center font-mono text-xs text-muted-foreground">
                                {w.reps} reps
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-col gap-6">
                <Card className="border border-border/80 shadow-md">
                  <CardHeader>
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <Heart className="text-red-500 size-4.5" /> Biometrics & Meal Calibration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3.5 text-xs text-muted-foreground leading-relaxed">
                    <p>
                      Connecting Mealie and Wger directly allows dynamic ingredient calculations based on target daily
                      caloric expenditure.
                    </p>
                    <p>
                      When you complete a chest and biceps session, the recipe serving weights scale up automatically
                      to guarantee optimal protein synthesis.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* 5. MEDIA & UTILITIES DOMAIN */}
        {activeDomain === 'media' && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            {/* qBittorrent downloads list displaying speed limits */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="text-primary size-5" /> Active Torrents Download speedometers
                  (qBittorrent-Agent)
                </CardTitle>
                <CardDescription>Network traffic speed limiters and seed ratio checks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {qbittorrentTorrents.map((t) => (
                    <Card key={t.name} className="p-4 bg-accent/5 hover:border-primary/20 transition-all space-y-4">
                      <div className="flex justify-between items-start gap-2">
                        <div className="truncate">
                          <h4 className="font-bold text-xs text-foreground truncate" title={t.name}>
                            {t.name}
                          </h4>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            Size: {t.size} | Status: <strong className="capitalize">{t.status}</strong>
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[9px] uppercase tracking-wide bg-primary/5 text-primary border-primary/20"
                        >
                          {t.progress}%
                        </Badge>
                      </div>

                      <div className="space-y-1.5">
                        <div className="w-full bg-accent h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-primary h-full transition-all duration-300"
                            style={{ width: `${t.progress}%` }}
                          />
                        </div>
                        <div className="grid grid-cols-2 text-[10px] font-mono text-muted-foreground pt-0.5">
                          <div>
                            DL Speed: <span className="font-bold text-green-500">{t.dl_speed}</span>
                          </div>
                          <div className="text-right">
                            UL Speed: <span className="font-bold text-blue-500">{t.ul_speed}</span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Video downloader yt-dlp form and task list */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="border border-border/80 shadow-md lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Download className="text-primary size-5" /> yt-dlp Video Downloader queue (Media-Downloader)
                  </CardTitle>
                  <CardDescription>Submit streaming video URLs to download as local MP3/MP4 files</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={addMediaDownload} className="flex gap-2">
                    <Input
                      placeholder="Enter streaming video URL (YouTube, Vimeo, etc)..."
                      value={mediaUrl}
                      onChange={(e) => {
                        setMediaUrl(e.target.value)
                      }}
                    />
                    <Button type="submit" className="gap-1.5">
                      <Plus className="size-4" /> Queue Download
                    </Button>
                  </form>

                  <div className="border-t pt-4 space-y-2">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Queue Status</h5>
                    <div className="space-y-2.5">
                      {mediaDownloads.map((dl) => (
                        <div
                          key={dl.id}
                          className="p-3 border rounded-md bg-accent/5 hover:border-primary/20 transition-all space-y-2"
                        >
                          <div className="flex justify-between items-center text-xs">
                            <h4 className="font-bold text-foreground truncate max-w-[280px]" title={dl.title}>
                              {dl.title}
                            </h4>
                            <span className="font-mono font-bold text-primary">{dl.progress}%</span>
                          </div>
                          <div className="w-full bg-accent h-1.5 rounded-full overflow-hidden">
                            <div className="bg-primary h-full transition-all" style={{ width: `${dl.progress}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] font-mono text-muted-foreground pt-0.5">
                            <span>
                              Status: <strong className="capitalize text-foreground">{dl.status}</strong>
                            </span>
                            <span>Speed: {dl.speed}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Stirling PDF action split/merge/compress triggers */}
              <Card className="border border-border/80 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <FileText className="text-red-500 size-4.5" /> Stirling PDF Actions (StirlingPDF-Agent)
                  </CardTitle>
                  <CardDescription>Convert, split, or merge files</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => {
                        submitStirlingPdf('merge')
                      }}
                    >
                      <Plus className="size-3 text-red-500" /> Merge PDFs
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => {
                        submitStirlingPdf('split')
                      }}
                    >
                      <X className="size-3 text-red-500" /> Split PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => {
                        submitStirlingPdf('compress')
                      }}
                    >
                      <BarChart2 className="size-3 text-red-500" /> Compress PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={() => {
                        submitStirlingPdf('ocr')
                      }}
                    >
                      <Search className="size-3 text-red-500" /> OCR PDF
                    </Button>
                  </div>

                  <div className="border-t pt-4 space-y-2">
                    <h5 className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Jobs Status</h5>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {stirlingJobs.map((job) => (
                        <div
                          key={job.id}
                          className="flex justify-between items-center p-2 border rounded-md text-xs bg-accent/5"
                        >
                          <div className="truncate max-w-[120px] pr-2">
                            <span className="font-bold block truncate" title={job.filename}>
                              {job.filename}
                            </span>
                            <span className="text-[9px] font-mono text-muted-foreground uppercase">
                              {job.action} | {job.timestamp}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn('capitalize scale-90', {
                              'bg-emerald-500/10 text-emerald-600 border-emerald-500/25': job.status === 'completed',
                              'bg-amber-500/10 text-amber-600 border-amber-500/25': job.status === 'running',
                            })}
                          >
                            {job.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Cloned git repositories branches */}
            <Card className="border border-border/80 shadow-md">
              <CardHeader className="flex flex-col md:flex-row md:items-center justify-between pb-3 gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GitPullRequest className="text-primary size-5" /> Repositories Workspace Matrix
                  </CardTitle>
                  <CardDescription>Monitor branches, structural drift, and staging modifications</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      void runBulkRepoAction('pull')
                    }}
                    disabled={bulkActionRunning || selectedRepos.length === 0}
                  >
                    <RefreshCw className={cn('size-4', { 'animate-spin': bulkActionRunning })} />
                    Bulk Pull ({selectedRepos.length})
                  </Button>
                  <Button
                    variant="default"
                    className="gap-1.5"
                    onClick={() => {
                      void runBulkRepoAction('build')
                    }}
                    disabled={bulkActionRunning || selectedRepos.length === 0}
                  >
                    <Plus className="size-4" />
                    Bulk Build ({selectedRepos.length})
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 border-t">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-accent/40 border-b">
                    <tr>
                      <th className="p-4 w-12 text-center">
                        <input
                          type="checkbox"
                          checked={selectedRepos.length === repos.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRepos(repos.map((r) => r.name))
                            } else {
                              setSelectedRepos([])
                            }
                          }}
                          className="rounded border-gray-300 focus:ring-primary size-4 cursor-pointer"
                        />
                      </th>
                      <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                        Repository Name
                      </th>
                      <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                        Active Branch
                      </th>
                      <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                        Local Drift
                      </th>
                      <th className="p-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                        Sync status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {repos.map((r) => (
                      <tr key={r.name} className="hover:bg-accent/10 transition-colors">
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedRepos.includes(r.name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedRepos((prev) => [...prev, r.name])
                              } else {
                                setSelectedRepos((prev) => prev.filter((n) => n !== r.name))
                              }
                            }}
                            className="rounded border-gray-300 focus:ring-primary size-4 cursor-pointer"
                          />
                        </td>
                        <td className="p-4 font-bold text-foreground tracking-tight flex flex-col pt-3 pb-3">
                          <span>{r.name}</span>
                          <span className="text-xs font-mono text-muted-foreground pt-0.5">{r.path}</span>
                        </td>
                        <td className="p-4 font-semibold text-muted-foreground">
                          <Badge variant="secondary" className="font-mono text-xs">
                            {r.branch}
                          </Badge>
                        </td>
                        <td className="p-4 font-mono font-bold text-xs text-amber-500">
                          {r.modified_count > 0 ? `${r.modified_count} changes` : '0 modifications'}
                        </td>
                        <td className="p-4">
                          <Badge
                            variant="outline"
                            className={cn('capitalize px-2 py-0.5 text-xs font-semibold rounded-full border', {
                              'bg-emerald-500/10 border-emerald-500/25 text-emerald-600': r.status === 'clean',
                              'bg-amber-500/10 border-amber-500/25 text-amber-600': r.status === 'modified',
                            })}
                          >
                            {r.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
