/**
 * Shared accessibility contract for image wrappers.
 *
 * An empty alt value is valid only when the caller explicitly marks the image
 * decorative. The generic keeps that distinction visible to TypeScript for
 * literal values, while the runtime assertion protects dynamic/JavaScript
 * callers that can otherwise bypass the type contract.
 */
export interface ImageAltProps<Alt extends string> {
  alt: Alt
  decorative?: Alt extends '' ? true : false
}

export function assertImageAlt(alt: string | undefined, decorative: boolean | undefined): void {
  if (!decorative && (!alt || alt.trim().length === 0)) {
    throw new Error('Informative images must provide non-empty alt text; mark decorative images explicitly.')
  }
}
