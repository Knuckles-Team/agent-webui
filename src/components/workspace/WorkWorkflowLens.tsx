import { useLayoutEffect, useRef, useState } from 'react'
import { roleAtLeast, type Role } from '@/lib/nav-registry'
import { navigateWork, workHref, type WorkState } from '@/lib/work-workspace'
import { WorkflowEditor } from '@/components/workflow/WorkflowEditor'

interface Props {
  state: WorkState
  role: Role
  disabled?: boolean
}
/** Mounted inside the admission-owned Work surface; hidden inspection keeps only local draft state. */
export function WorkWorkflowLens({ disabled, ...props }: Props) {
  return disabled ? null : <AdmittedWorkflowLens {...props} />
}
function AdmittedWorkflowLens({ state, role }: Props) {
  const available = roleAtLeast(role, 'admin')
  const selected = state.lens === 'workflows'
  const [opened, setOpened] = useState(selected && available)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const current = useRef(state)
  current.current = state
  const active = useRef(false)
  useLayoutEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useLayoutEffect(() => {
    if (selected && available) setOpened(true)
  }, [selected, available])
  return (
    <section aria-label="Work workflow plans" className="min-w-0 space-y-3">
      {available && (
        <a
          href={workHref({ ...state, lens: selected ? 'investigation' : 'workflows' })}
          className="inline-flex min-h-11 items-center rounded border px-3"
          aria-current={selected ? 'page' : undefined}
          onClick={(event) => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            navigateWork({ ...state, lens: selected ? 'investigation' : 'workflows' }, role)
          }}
        >
          {selected ? 'Inspect tasks and traces' : 'Workflow plans'}
        </a>
      )}
      {selected && !available && <p role="alert">Workflow plans require administrator access.</p>}
      {opened && available && (
        <div hidden={!selected}>
          <h2 className="text-lg font-semibold">Workflow plan</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            A reusable local plan preview. Selecting or editing it does not change the selected task, conversation or
            trace.
          </p>
          {selectionError && <p role="alert">{selectionError}</p>}
          <WorkflowEditor
            workflowId={state.workflow ?? null}
            onSelectWorkflow={(workflow) => {
              if (!active.current || current.current !== state || !selected) return
              try {
                navigateWork({ ...state, lens: 'workflows', workflow }, role)
                setSelectionError(null)
              } catch {
                setSelectionError('This workflow identity is invalid. The current selection was not changed.')
              }
            }}
          />
        </div>
      )}
    </section>
  )
}
