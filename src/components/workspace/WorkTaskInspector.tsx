import { taskOutput, taskReferences } from '@/lib/work-task-inspection'

/** Read-only projection of the selected task response, never a relationship resolver. */
export function WorkTaskInspector({ task }: { task: unknown }) {
  const references = taskReferences(task)
  const output = taskOutput(task)
  return (
    <section aria-label="Task output and references" className="mt-3 min-w-0 space-y-3 border-t pt-3">
      <h4 className="font-medium">Task output</h4>
      {output.message && <p role="status">{output.message}</p>}
      {output.artifacts.map((artifact) => (
        <article key={artifact.artifactId} className="min-w-0 rounded border p-2">
          <h5 className="break-all font-medium">{artifact.name ?? artifact.artifactId}</h5>
          <p className="break-all text-xs">Artifact: {artifact.artifactId}</p>
          {artifact.parts.map((part, index) => (
            <pre key={index} className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
              {part.text}
            </pre>
          ))}
        </article>
      ))}
      <h4 className="font-medium">Returned references</h4>
      {references ? (
        <dl className="grid gap-1 text-sm">
          <dt>Task context reference</dt>
          <dd className="break-all">{references.context}</dd>
          <dt>Run reference</dt>
          <dd className="break-all">{references.run}</dd>
          <dt>Trace reference</dt>
          <dd className="break-all">{references.trace}</dd>
        </dl>
      ) : (
        <p role="status">Task references are unavailable: unsupported format.</p>
      )}
      <p className="text-sm text-muted-foreground">
        These references come from the selected task. A context reference is not a browser conversation link, and a
        trace reference is not a navigable trace identifier.
      </p>
    </section>
  )
}
