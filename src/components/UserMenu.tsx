/**
 * @file UserMenu.tsx
 * @description The session/identity chrome the sidebar footer was missing
 * (W-16, W-17): an avatar+name trigger that opens a dropdown with "Profile"
 * and "Log out".
 *
 * `/auth/logout` already exists and works server-side
 * (`agent/agent_webui/oidc_session.py`, `LOGOUT_PATH`) -- it was simply never
 * surfaced anywhere in the UI, which is the entire W-16 defect. This
 * component only links to it; it does not reimplement any session logic.
 *
 * Follows the same shadcn "NavUser" shape `SidebarMenuButton size="lg"` was
 * already built for (see `sidebarMenuButtonVariants` in `ui/sidebar.tsx`),
 * so it slots into `SidebarFooter` next to `ModeToggle` without introducing a
 * new visual pattern.
 */
import { useState } from 'react'
import { ChevronsUpDown, LogIn, LogOut, User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { useIdentity } from '@/lib/auth'
import { useProfileOverride } from '@/lib/profile-store'
import { ProfileDialog } from './ProfileDialog'

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function UserMenu() {
  const { identity } = useIdentity()
  const override = useProfileOverride(identity.userKey)
  const [profileOpen, setProfileOpen] = useState(false)

  const claims = identity.raw
  const accountName = claims?.name ?? claims?.username ?? null
  const displayName =
    override.nickname ?? accountName ?? (identity.ssoConfigured ? identity.userKey : 'Local operator')
  const email = claims?.email ?? null
  const avatarSrc = override.avatarDataUrl ?? claims?.picture ?? undefined

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                <Avatar className="size-7 rounded-md">
                  <AvatarImage src={avatarSrc} alt="" />
                  <AvatarFallback className="rounded-md text-xs">{initialsOf(displayName)}</AvatarFallback>
                </Avatar>
                <span className="flex flex-col items-start min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium w-full">{displayName}</span>
                  <span className="truncate text-xs text-muted-foreground w-full">
                    {email ?? (identity.ssoConfigured ? identity.role : 'SSO not configured')}
                  </span>
                </span>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <div className="flex items-center gap-2">
                  <Avatar className="size-8 rounded-md">
                    <AvatarImage src={avatarSrc} alt="" />
                    <AvatarFallback className="rounded-md text-xs">{initialsOf(displayName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-sm font-medium">{displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {email ?? 'No email from identity provider'}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setProfileOpen(true)
                }}
              >
                <User />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!identity.ssoConfigured ? (
                <DropdownMenuItem disabled title="Single sign-on is not configured for this deployment">
                  <LogOut />
                  Log out (SSO not configured)
                </DropdownMenuItem>
              ) : identity.needsSignIn ? (
                <DropdownMenuItem asChild>
                  <a href="/auth/login">
                    <LogIn />
                    Sign in
                  </a>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem asChild variant="destructive">
                  <a href="/auth/logout">
                    <LogOut />
                    Log out
                  </a>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} identity={identity} />
    </>
  )
}
