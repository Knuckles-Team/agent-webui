import { CodeIcon, DownloadIcon, GlobeIcon, ImagePlusIcon, WrenchIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function getToolIcon(toolId: string, className = 'size-4') {
  const iconMap: Record<string, ReactNode> = {
    web_search: <GlobeIcon className={className} />,
    web_fetch: <DownloadIcon className={className} />,
    code_execution: <CodeIcon className={className} />,
    image_generation: <ImagePlusIcon className={className} />,
  }
  return iconMap[toolId] ?? <WrenchIcon className={className} />
}
