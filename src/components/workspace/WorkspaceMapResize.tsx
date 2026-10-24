import { GripVertical } from 'lucide-react'
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { mapMinimum, useWorkspaceMapWidth } from './useWorkspaceMapWidth'

type WidthControl = ReturnType<typeof useWorkspaceMapWidth>

export function WorkspaceMapResize({ control }: { control: WidthControl }) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null)
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 2 : 1
    const changes: Record<string, number | undefined> = {
      ArrowLeft: control.width - step,
      ArrowRight: control.width + step,
      Home: mapMinimum,
      End: control.maximum,
    }
    const next = changes[event.key]
    if (next === undefined) return
    event.preventDefault()
    control.resize(next)
    control.save()
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.currentTarget.focus()
    drag.current = { id: event.pointerId, x: event.clientX, width: control.width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const origin = drag.current
    if (origin?.id !== event.pointerId) return
    control.resize(origin.width + (event.clientX - origin.x) / control.rem)
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return
    control.save()
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <div className="workspace-map-gutter">
      <button
        type="button"
        role="separator"
        aria-label="Resize workspace map"
        aria-orientation="vertical"
        aria-controls="workspace-map"
        aria-valuemin={mapMinimum}
        aria-valuemax={control.maximum}
        aria-valuenow={control.width}
        aria-valuetext={`${Math.round(control.width * control.rem)} pixels`}
        title="Resize map: drag, use arrow keys, Home or End"
        onKeyDown={keyDown}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onLostPointerCapture={() => {
          drag.current = null
        }}
      >
        <GripVertical aria-hidden="true" size={20} style={{ margin: 'auto' }} />
      </button>
    </div>
  )
}
