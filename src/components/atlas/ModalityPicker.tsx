/**
 * @file ModalityPicker.tsx
 * @description Pick a modality. The list is whatever `discoverAdapters()` found — an
 * unregistered modality simply does not appear, rather than appearing as a placeholder
 * that renders an empty table and lets a reader conclude the data is missing.
 */
import { Button } from '@/components/ui/button'
import type { ModalityAdapter } from '@/lib/atlas/adapter'

export interface ModalityPickerProps {
  adapters: ModalityAdapter[]
  activeId: string
  onSelect: (adapterId: string) => void
}

export function ModalityPicker({ adapters, activeId, onSelect }: ModalityPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="atlas-modality-picker">
      {adapters.map((adapter) => {
        const Icon = adapter.icon
        return (
          <Button
            key={adapter.id}
            size="sm"
            variant={adapter.id === activeId ? 'secondary' : 'ghost'}
            className="h-8 text-xs"
            title={adapter.description}
            data-testid={`atlas-modality-${adapter.id}`}
            onClick={() => {
              onSelect(adapter.id)
            }}
          >
            <Icon className="mr-1.5 size-3.5" />
            {adapter.label}
          </Button>
        )
      })}
    </div>
  )
}
