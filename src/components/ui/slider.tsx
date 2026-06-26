import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Minimal single-thumb slider built on a native `<input type="range">`.
 *
 * Kept dependency-free (no @radix-ui/react-slider) on purpose: the temporal
 * scrubber only needs a single controlled value, and a native range input
 * renders deterministically under jsdom for vitest. The API mirrors the shadcn
 * Slider shape (`value`/`onValueChange`/`min`/`max`/`step`) so it can be swapped
 * for the Radix version later without touching call sites.
 */
interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="range"
        role="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onChange={(e) => {
          onValueChange(Number(e.target.value))
        }}
        className={cn('w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary h-2', className)}
        {...props}
      />
    )
  },
)
Slider.displayName = 'Slider'
