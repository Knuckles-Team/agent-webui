import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

export interface GeneratedImageProps {
  url: string
  alt?: string
  className?: string
}

export type ImageProps = ComponentProps<'div'> & {
  image?: GeneratedImageProps
}

export const ExperimentalGeneratedImage = ({ image, className, ...props }: ImageProps) => {
  if (!image) return null
  return (
    <div className={cn('relative', className)} {...props}>
      <img
        src={image.url}
        alt={image.alt ?? 'Generated Image'}
        className={cn('h-auto max-w-full overflow-hidden rounded-md', image.className)}
      />
    </div>
  )
}

export interface Base64ImageProps extends ComponentProps<'img'> {
  base64?: string
  uint8Array?: Uint8Array
  mediaType?: string
}

export const Image = ({ base64, uint8Array, mediaType, ...props }: Base64ImageProps) => (
  <img
    {...props}
    alt={props.alt}
    className={cn('h-auto max-w-full overflow-hidden rounded-md', props.className)}
    src={`data:${mediaType};base64,${base64}`}
  />
)
