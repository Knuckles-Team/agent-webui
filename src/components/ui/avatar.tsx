import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'

import { assertImageAlt, type ImageAltProps } from '@/lib/accessible-image'
import { cn } from '@/lib/utils'

function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  )
}

function AvatarImage<const Alt extends string>({
  className,
  alt,
  decorative,
  ...props
}: Omit<React.ComponentProps<typeof AvatarPrimitive.Image>, 'alt'> & ImageAltProps<Alt>) {
  assertImageAlt(alt, decorative)
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      alt={alt}
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn('bg-muted flex size-full items-center justify-center rounded-full', className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
