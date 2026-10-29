import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-normal leading-5 transition-colors disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground disabled:border-input [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-[var(--button-primary)] text-primary-foreground hover:bg-[var(--button-primary-hover)]',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline:
          'border border-transparent bg-[var(--button-neutral)] text-[var(--button-neutral-foreground)] hover:bg-[var(--button-neutral-hover)] aria-pressed:bg-[var(--button-neutral-active)]',
        secondary:
          'border border-transparent bg-[var(--button-neutral)] text-[var(--button-neutral-foreground)] hover:bg-[var(--button-neutral-hover)] aria-pressed:bg-[var(--button-neutral-active)]',
        ghost:
          'border border-transparent bg-[var(--button-neutral)] text-[var(--button-neutral-foreground)] hover:bg-[var(--button-neutral-hover)] aria-pressed:bg-[var(--button-neutral-active)]',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'default'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

/** Shared opt-in presentation for owned workspace actions, never canvas internals. */
const workspaceButtonClass = cn(
  buttonVariants({ variant: 'secondary' }),
  'workspace-control min-h-11 h-auto min-w-0 max-w-full whitespace-normal break-words px-3 py-2',
)
const workspaceDestructiveButtonClass = cn(
  buttonVariants({ variant: 'destructive' }),
  'workspace-control min-h-11 h-auto min-w-0 max-w-full whitespace-normal break-words px-3 py-2',
)

export { Button, buttonVariants, workspaceButtonClass, workspaceDestructiveButtonClass }
