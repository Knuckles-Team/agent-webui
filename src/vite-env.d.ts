/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Origin of the embedded openvscode-server / code-server workbench (see
  // WorkspaceIDEView.tsx). Declared here so `import.meta.env.VITE_IDE_ORIGIN`
  // is typed `string | undefined` instead of vite/client's default
  // `ImportMetaEnv` index signature, which types every key as `any`.
  readonly VITE_IDE_ORIGIN?: string
}
