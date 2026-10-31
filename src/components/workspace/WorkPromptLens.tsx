import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { roleAtLeast, type Role } from '@/lib/nav-registry'
import { navigateWork, workHref, type WorkState } from '@/lib/work-workspace'
import { useWebMcpToolSet } from '@/lib/webmcp/provider'
import { makeTool } from '@/lib/webmcp/tools'
import { PromptAuthoringPanel } from '@/components/views/PromptsView'

interface Props {
  state: WorkState
  role: Role
  disabled?: boolean
}
export function WorkPromptLens({ disabled, ...props }: Props) {
  return disabled ? null : <AdmittedWorkPromptLens {...props} />
}
function AdmittedWorkPromptLens({ state, role }: Props) {
  const active = useRef(false)
  const current = useRef(state)
  current.current = state
  const available = roleAtLeast(role, 'admin')
  const selected = state.lens ?? 'investigation'
  const [opened, setOpened] = useState(selected === 'prompts' && available)
  useLayoutEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useLayoutEffect(() => {
    if (selected === 'prompts' && available) setOpened(true)
  }, [selected, available])
  const tools = useMemo(() => {
    const schema = z.object({ lens: z.enum(['investigation', 'prompts']) }).strict()
    return [
      makeTool({
        name: 'overstory.work.lens',
        title: 'Select a Work lens',
        description:
          'Select investigation or admin prompt authoring. Preserves conversation and task context; does not edit, save or run prompts.',
        inputSchema: schema,
        outputSchema: schema,
        jsonSchema: z.toJSONSchema(schema),
        readOnly: false,
        source: 'overstory:src/components/workspace/WorkPromptLens.tsx',
        execute: ({ lens }) => {
          if (!active.current || current.current !== state) throw new Error('Work lens context is stale')
          navigateWork({ ...state, lens }, role)
          return { lens }
        },
      }),
    ]
  }, [state, role])
  useWebMcpToolSet(tools)
  return (
    <section aria-label="Work lenses" className="min-w-0 space-y-3">
      <nav aria-label="Work lenses" className="flex flex-wrap gap-2">
        {(['investigation', ...(available ? (['prompts'] as const) : [])] as const).map((lens) => (
          <a
            key={lens}
            href={workHref({ ...state, lens })}
            aria-current={selected === lens ? 'page' : undefined}
            className="inline-flex min-h-11 items-center rounded border px-3 capitalize"
            onClick={(event) => {
              if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              navigateWork({ ...state, lens }, role)
            }}
          >
            {lens === 'prompts' ? 'Saved instructions' : 'Task details'}
          </a>
        ))}
      </nav>
      {selected === 'prompts' && !available && <p role="alert">Prompt authoring requires administrator access.</p>}
      {opened && available && (
        <div hidden={selected !== 'prompts'}>
          <h2 className="text-lg font-semibold">Prompt authoring</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Reusable instruction profiles. Editing a profile does not run it or associate it with the selected task.
          </p>
          <PromptAuthoringPanel contextual />
        </div>
      )}
    </section>
  )
}
