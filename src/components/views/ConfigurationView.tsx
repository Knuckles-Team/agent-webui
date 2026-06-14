import { useState, useEffect } from 'react'
import { Save, RefreshCw, Eye, EyeOff, Settings, Shield, Sliders, Variable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'

export default function ConfigurationView() {
  const [config, setConfig] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/enhanced/config')
      if (!res.ok) {
        toast.error('Failed to load active configuration')
        return
      }
      const data = await res.json()
      setConfig(data)
    } catch {
      toast.error('Failed to connect to configuration service')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/enhanced/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        toast.success('Central config.json updated successfully')
      } else {
        toast.error('Failed to update config.json')
      }
    } catch {
      toast.error('Network error saving configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleReload = async () => {
    setReloading(true)
    try {
      const res = await fetch('/api/enhanced/reload', { method: 'POST' })
      if (res.ok) {
        toast.success('Agent-utilities background workers reloaded')
      } else {
        toast.error('Reload trigger failed')
      }
    } catch {
      toast.error('Network error during reload trigger')
    } finally {
      setReloading(false)
    }
  }

  const handleFieldChange = (key: string, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const toggleShowKey = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const apiKeyFields = [
    { key: 'openai_api_key', label: 'OpenAI API Key', placeholder: 'sk-proj-...' },
    { key: 'anthropic_api_key', label: 'Anthropic API Key', placeholder: 'sk-ant-...' },
    { key: 'gemini_api_key', label: 'Gemini API Key', placeholder: 'AIzaSy...' },
    { key: 'github_token', label: 'GitHub Personal Access Token', placeholder: 'ghp_...' },
  ]

  const operationalFields = [
    { key: 'graph_timeout', label: 'Knowledge Graph Request Timeout (ms)', type: 'number' },
    {
      key: 'log_level',
      label: 'System Log Level Verbosity',
      type: 'select',
      options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'],
    },
  ]

  // Filter other custom/arbitrary variables not in standard fields
  const customKeys = Object.keys(config).filter(
    (key) => !apiKeyFields.some((f) => f.key === key) && !operationalFields.some((f) => f.key === key),
  )

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-[calc(100vh-12rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-500 flex items-center gap-2">
            <Settings className="size-6 text-emerald-400" />
            Configuration Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage your agent central parameters, provider API credentials, and query boundaries.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReload()}
            disabled={reloading}
            className="border-emerald-500/20 hover:bg-emerald-500/5 text-emerald-400"
          >
            <RefreshCw className={`size-4 mr-1.5 ${reloading ? 'animate-spin' : ''}`} />
            Reload Engine
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="size-4 mr-1.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 pr-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="size-8 text-emerald-500 animate-spin" />
            <span className="text-sm text-muted-foreground">Reading config.json parameters...</span>
          </div>
        ) : (
          <div className="space-y-6 pb-12">
            {/* 1. API Credentials Section */}
            <Card className="border-border/40 bg-card/60 backdrop-blur-md">
              <CardHeader className="pb-3 flex flex-row items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Shield className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">API Credentials</CardTitle>
                  <CardDescription>Secure tokens for AI model providers and platforms.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {apiKeyFields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">{field.label}</label>
                      <div className="relative">
                        <Input
                          type={showKeys[field.key] ? 'text' : 'password'}
                          value={config[field.key] || ''}
                          placeholder={field.placeholder}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className="bg-muted/20 pr-10 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => toggleShowKey(field.key)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showKeys[field.key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 2. Operational Tuning Section */}
            <Card className="border-border/40 bg-card/60 backdrop-blur-md">
              <CardHeader className="pb-3 flex flex-row items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Sliders className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Operational Thresholds</CardTitle>
                  <CardDescription>Set query timeout margins and verbosity filters.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {operationalFields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">{field.label}</label>
                      {field.type === 'select' ? (
                        <select
                          value={config[field.key] || 'INFO'}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className="w-full h-10 px-3 rounded-md border border-input bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt} className="bg-background text-foreground">
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          type="number"
                          value={config[field.key] || ''}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className="bg-muted/20 font-mono text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 3. Custom Metadata Fields */}
            {customKeys.length > 0 && (
              <Card className="border-border/40 bg-card/60 backdrop-blur-md">
                <CardHeader className="pb-3 flex flex-row items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <Variable className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Custom Workspace Environment</CardTitle>
                    <CardDescription>Arbitrary values loaded from your active config profile.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customKeys.map((key) => (
                      <div key={key} className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                          {key}
                          <Badge variant="outline" className="text-[8px] px-1 py-0.25">
                            env
                          </Badge>
                        </label>
                        <Input
                          value={config[key] !== null ? String(config[key]) : ''}
                          onChange={(e) => handleFieldChange(key, e.target.value)}
                          className="bg-muted/20 font-mono text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
