import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ModularModalProps extends React.ComponentProps<typeof Dialog> {
  title?: string
  description?: string
  footer?: React.ReactNode
  children: React.ReactNode
  contentClassName?: string
}

/**
 * ModularModal
 * A glassmorphic modal pattern inspired by the odysseus library.
 * Useful for settings, configuration, or skill auditing overlays.
 */
export function ModularModal({
  title,
  description,
  footer,
  children,
  contentClassName,
  ...props
}: ModularModalProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          // Glassmorphic properties ported from odysseus
          'backdrop-blur-xl bg-background/80 supports-[backdrop-filter]:bg-background/60',
          'border border-border/50 shadow-2xl',
          'max-w-3xl w-full',
          contentClassName
        )}
      >
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}

        <div className="py-4">
          {children}
        </div>

        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
