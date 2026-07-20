import { cn } from '@/lib/utils'
import { type ComponentProps, memo } from 'react'
import { defaultRehypePlugins, Streamdown, type MermaidOptions } from 'streamdown'

type ResponseProps = ComponentProps<typeof Streamdown>

const SAFE_REHYPE_PLUGINS = Object.values(defaultRehypePlugins)
export const SAFE_MERMAID_OPTIONS: MermaidOptions = {
  config: { securityLevel: 'strict' },
}

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      {...props}
      className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 code-bg ', className)}
      mermaid={SAFE_MERMAID_OPTIONS}
      rehypePlugins={SAFE_REHYPE_PLUGINS}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
)

Response.displayName = 'Response'
