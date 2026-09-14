import { cn } from '@/lib/utils'
import { assertImageAlt, type ImageAltProps } from '@/lib/accessible-image'
import type { ComponentProps } from 'react'

export type GeneratedImageProps<Alt extends string = string> = ImageAltProps<Alt> & {
  url: string
  className?: string
}

export type ImageProps<Alt extends string = string> = ComponentProps<'div'> & {
  image?: GeneratedImageProps<Alt>
}

export const ExperimentalGeneratedImage = <const Alt extends string>({
  image,
  className,
  ...props
}: ImageProps<Alt>) => {
  if (!image) return null
  assertImageAlt(image.alt, image.decorative)
  return (
    <div className={cn('relative', className)} {...props}>
      <AccessibleImage
        src={image.url}
        alt={image.alt}
        decorative={image.decorative}
        className={cn('h-auto max-w-full overflow-hidden rounded-md', image.className)}
      />
    </div>
  )
}

export type AccessibleImageProps<Alt extends string = string> = Omit<ComponentProps<'img'>, 'alt'> & ImageAltProps<Alt>

export const AccessibleImage = <const Alt extends string>({
  alt,
  decorative,
  ...props
}: AccessibleImageProps<Alt>) => {
  assertImageAlt(alt, decorative)
  return <img {...props} alt={alt} />
}

export type Base64ImageProps<Alt extends string = string> = Omit<AccessibleImageProps<Alt>, 'src'> & {
  base64?: string
  uint8Array?: Uint8Array
  mediaType?: string
}

export const Image = <const Alt extends string>({
  base64,
  uint8Array,
  mediaType,
  ...props
}: Base64ImageProps<Alt>) => (
  <AccessibleImage
    {...props}
    alt={props.alt}
    className={cn('h-auto max-w-full overflow-hidden rounded-md', props.className)}
    src={`data:${mediaType};base64,${base64}`}
  />
)
