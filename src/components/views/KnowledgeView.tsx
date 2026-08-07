import { useState, useEffect } from 'react'
import { z } from 'zod'
import { Book, Search, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Response } from '@/components/ai-elements/response'
import { fetchValidated, ApiError, looseArray } from '@/lib/api-validation'
import { SessionExpiredNotice } from '@/components/SessionExpiredNotice'

interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
}

const skillSchema: z.ZodType<Skill> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
})

export default function KnowledgeView() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [loading, setLoading] = useState(true)
  const [docContent, setDocContent] = useState('')
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    void fetchSkills()
  }, [])

  useEffect(() => {
    if (selectedSkill) {
      fetchDocs(selectedSkill.id)
    }
  }, [selectedSkill])

  const fetchSkills = async () => {
    try {
      setLoading(true)
      const data = await fetchValidated('/api/enhanced/skills', looseArray(skillSchema))
      setSessionExpired(false)

      const docSkills = data
        .filter((s: Skill) => s.id.endsWith('-docs'))
        .sort((a: Skill, b: Skill) => a.name.localeCompare(b.name))
      setSkills(docSkills)
      if (docSkills.length > 0) {
        setSelectedSkill(docSkills[0])
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setSessionExpired(true)
      } else {
        toast.error('Failed to load knowledge graphs')
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchDocs = (_skillId: string) => {
    setDocContent(
      `# ${selectedSkill?.name}\n\n${selectedSkill?.description}\n\n---\n\n*Detailed skill documentation and graph visualization coming soon.*`,
    )
  }

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  if (sessionExpired) {
    return <SessionExpiredNotice />
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-12rem)]">
      <div className="w-80 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search knowledge..."
            className="pl-9 bg-muted/20 border-border/40"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
            }}
          />
        </div>

        <Card className="flex-1 flex flex-col overflow-hidden border-border/40">
          <CardHeader className="py-3 px-4 border-b bg-muted/5">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Skill Documentation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {loading ? (
                  <p className="text-center py-4 text-xs text-muted-foreground">Loading...</p>
                ) : filteredSkills.length === 0 ? (
                  <p className="text-center py-4 text-xs text-muted-foreground">No documentation found.</p>
                ) : (
                  filteredSkills.map((skill) => (
                    <button
                      key={skill.id}
                      className={cn(
                        'w-full text-left p-3 rounded-lg transition-all duration-200 group flex flex-col gap-1',
                        selectedSkill?.id === skill.id
                          ? 'bg-primary/10 border-primary/20 shadow-sm'
                          : 'hover:bg-muted/50 border-transparent border',
                      )}
                      onClick={() => {
                        setSelectedSkill(skill)
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'text-sm font-semibold truncate',
                            selectedSkill?.id === skill.id ? 'text-primary' : 'text-foreground',
                          )}
                        >
                          {skill.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[9px] h-4 border-primary/20 bg-primary/5 text-primary"
                        >
                          DOCS
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground line-clamp-1 group-hover:line-clamp-none transition-all">
                        {skill.id}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden border-border/40 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/5 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Book className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">{selectedSkill?.name ?? 'Knowledge Base'}</CardTitle>
              <CardDescription className="text-xs italic">{selectedSkill?.id}</CardDescription>
            </div>
          </div>
          {selectedSkill && (
            <Button variant="outline" size="sm" className="gap-2 text-xs border-primary/20 hover:bg-primary/5">
              <ExternalLink className="size-3" />
              Open Graph
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-8 prose prose-blue dark:prose-invert max-w-none">
              {selectedSkill ? (
                <Response>{docContent}</Response>
              ) : (
                <div className="h-full flex flex-col items-center justify-center py-20 text-muted-foreground/40 space-y-4">
                  <Book className="size-16" />
                  <p className="text-lg font-medium">Select a knowledge graph to view documentation</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

function cn(...classes: unknown[]) {
  return classes.filter(Boolean).join(' ')
}
