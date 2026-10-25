import { useState } from 'react'
import { useIdentity } from '@/lib/auth'
import { roleAtLeast } from '@/lib/nav-registry'
import { WorkflowEditor } from '@/components/workflow/WorkflowEditor'
import { useWorkspaceAdmission } from '@/components/workspace/useWorkspaceAdmission'

/** Compatibility entry; Work consumes the contextual editor directly, not this page. */
export default function WorkflowEditorView() {
  const { identity, loading } = useIdentity()
  const generation = useWorkspaceAdmission(identity)
  if (loading) return <p role="status">Checking workflow access…</p>
  if (identity.needsSignIn || !roleAtLeast(identity.role, 'admin'))
    return <p role="alert">Workflow plans require administrator access.</p>
  return <AdmittedWorkflowEditor key={generation} />
}
function AdmittedWorkflowEditor() {
  const [workflow, setWorkflow] = useState<string | null>(null)
  return <WorkflowEditor workflowId={workflow} onSelectWorkflow={setWorkflow} />
}
