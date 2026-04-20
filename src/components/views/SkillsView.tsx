import { useState, useEffect } from 'react'
import { Zap, ZapOff, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  type?: string
}

export default function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetchSkills()
  }, [])

  const fetchSkills = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/enhanced/skills')
      const data = (await res.json()) as Skill[]
      const sortedData = [...data].sort((a, b) => a.name.localeCompare(b.name))
      setSkills(sortedData)
    } catch (_err) {
      toast.error('Failed to load skills')
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (id: string) => {
    try {
      const res = await fetch(`/api/enhanced/skills/${id}/toggle`, { method: 'POST' })
      if (res.ok) {
        setSkills(skills.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
        toast.success(`Skill ${id} status updated`)
      }
    } catch (_err) {
      toast.error('Failed to update skill status')
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Agent Skills</CardTitle>
            <CardDescription>Manage your agent's capabilities and integrated tools</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p>Loading skills...</p>
            ) : skills.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No skills discovered in the current workspace.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex flex-col p-4 border rounded-lg bg-card text-card-foreground shadow-sm group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`p-2 rounded-md ${skill.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                        >
                          {skill.enabled ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-sm leading-none">{skill.name}</h3>
                            {skill.type && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-secondary-foreground uppercase tracking-wider">
                                {skill.type}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{skill.id}</p>
                        </div>
                      </div>
                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={() => {
                          void handleToggle(skill.id)
                        }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-2">
                      {skill.description || 'No description provided for this skill.'}
                    </p>
                    <div className="mt-4 flex justify-end">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 gap-1">
                            <Info className="size-3" />
                            <span className="text-xs">Details</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Skill manifests and additional metadata view coming soon</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
