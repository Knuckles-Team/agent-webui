/**
 * @file SignInPanel.tsx
 * @description The sign-in, second-factor and first-run screens rendered in
 * place of any page while no principal is signed in.
 *
 * Every decision here is the server's: which screen to show comes from
 * `/auth/session` (`setup_required`, `second_factor_required`, `mode`), and
 * whether a submission worked comes from the broker's fixed outcome codes.
 * After any successful step the page reloads, so `/auth/session` — not this
 * component — decides who the user now is.
 */
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { Identity } from '@/lib/auth'
import {
  createFirstAdministrator,
  listIdentityProviders,
  signIn,
  verifySecondFactor,
  type IdentityProviderOption,
  type SignInOutcome,
} from '@/lib/auth-api'

/** The broker's fixed codes → what the user reads. Unknown codes read generically. */
const MESSAGES: Record<string, string> = {
  bad: 'Sign-in failed. Check your username and password.',
  denied: 'Sign-in failed.',
  throttled: 'Too many attempts. Wait a moment and try again.',
  mfa_enrollment_required: 'Your account must enrol a second factor. Ask an administrator.',
  mfa_enrollment: 'Your account must enrol a second factor. Ask an administrator.',
  password_change_required: 'Your password must be changed. Use the reset token an administrator gave you.',
  password_change: 'Your password must be changed. Use the reset token an administrator gave you.',
  idp_refused: 'The identity provider refused the sign-in.',
  idp_unavailable: 'The identity provider is unavailable.',
  idp_unverified: 'The identity provider could not be verified.',
  stale_login: 'That sign-in attempt expired. Start again.',
  error: 'Sign-in failed.',
}

function messageFor(code: string | null): string | null {
  if (!code) return null
  return MESSAGES[code] ?? 'Sign-in failed.'
}

function reloadHome(): void {
  window.location.assign('/')
}

function useFormState(): {
  message: string | null
  busy: boolean
  run: (action: () => Promise<SignInOutcome>, done: ReadonlySet<SignInOutcome>) => void
} {
  const initial = new URLSearchParams(window.location.search).get('error')
  const [message, setMessage] = useState<string | null>(messageFor(initial))
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<SignInOutcome>, done: ReadonlySet<SignInOutcome>) => {
    setBusy(true)
    void action().then((outcome) => {
      setBusy(false)
      if (done.has(outcome)) reloadHome()
      else setMessage(messageFor(outcome))
    })
  }
  return { message, busy, run }
}

const SIGNED_IN = new Set<SignInOutcome>(['ok', 'mfa_required'])
const FACTOR_DONE = new Set<SignInOutcome>(['ok'])

function Shell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8" data-testid="sign-in-panel">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  )
}

function Message({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  )
}

function submitting(handler: () => void) {
  return (event: SyntheticEvent) => {
    event.preventDefault()
    handler()
  }
}

function SetupForm() {
  const { message, busy, run } = useFormState()
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const submit = submitting(() => {
    run(() => createFirstAdministrator(code, username, password), SIGNED_IN)
  })
  return (
    <Shell title="Create the first administrator" description="Enter the setup code from the Graph OS log.">
      <form className="space-y-3" onSubmit={submit}>
        <Input
          aria-label="Setup code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
          }}
        />
        <Input
          aria-label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
          }}
        />
        <Input
          aria-label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
          }}
        />
        <Message text={message} />
        <Button type="submit" disabled={busy} className="w-full">
          Create administrator
        </Button>
      </form>
    </Shell>
  )
}

function SecondFactorForm() {
  const { message, busy, run } = useFormState()
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const method = recovery ? 'recovery' : 'totp'
  const submit = submitting(() => {
    run(() => verifySecondFactor(method, code), FACTOR_DONE)
  })
  return (
    <Shell
      title="Second factor"
      description={recovery ? 'Enter one of your recovery codes.' : 'Enter the code from your authenticator app.'}
    >
      <form className="space-y-3" onSubmit={submit}>
        <Input
          aria-label={recovery ? 'Recovery code' : 'Authenticator code'}
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
          }}
        />
        <Message text={message} />
        <Button type="submit" disabled={busy} className="w-full">
          Verify
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setRecovery(!recovery)
          }}
        >
          {recovery ? 'Use an authenticator code' : 'Use a recovery code'}
        </Button>
      </form>
    </Shell>
  )
}

function ProviderChoice({ provider }: { provider: IdentityProviderOption }) {
  const id = encodeURIComponent(provider.idp_id)
  if (provider.kind === 'ldap') {
    return (
      <form method="post" action={`/auth/ldap/${id}/login`} className="space-y-2">
        <p className="text-sm font-medium">{provider.display_name}</p>
        <Input name="username" aria-label={`${provider.display_name} username`} autoComplete="username" />
        <Input name="password" type="password" aria-label={`${provider.display_name} password`} />
        <Button type="submit" variant="outline" className="w-full">
          Sign in with {provider.display_name}
        </Button>
      </form>
    )
  }
  return (
    <Button asChild variant="outline" className="w-full">
      <a href={`/auth/${provider.kind}/${id}/login`}>Sign in with {provider.display_name}</a>
    </Button>
  )
}

function LocalSignInForm() {
  const { message, busy, run } = useFormState()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [providers, setProviders] = useState<IdentityProviderOption[]>([])
  useEffect(() => {
    void listIdentityProviders().then(setProviders)
  }, [])
  const submit = submitting(() => {
    run(() => signIn(username, password), SIGNED_IN)
  })
  return (
    <Shell title="Sign in" description="Sign in to Graph OS.">
      <form className="space-y-3" onSubmit={submit}>
        <Input
          aria-label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
          }}
        />
        <Input
          aria-label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
          }}
        />
        <Message text={message} />
        <Button type="submit" disabled={busy} className="w-full">
          Sign in
        </Button>
      </form>
      {providers.map((provider) => (
        <ProviderChoice key={provider.idp_id} provider={provider} />
      ))}
    </Shell>
  )
}

/** The screen for a browser with no usable session. */
export function SignInPanel({ identity }: { identity: Identity }) {
  const raw = identity.raw
  if (!identity.ssoConfigured) {
    return (
      <Shell title="Identity unavailable" description="The sign-in service did not answer. Reload to try again.">
        <Button onClick={reloadHome}>Reload</Button>
      </Shell>
    )
  }
  if (raw?.setup_required) return <SetupForm />
  if (raw?.second_factor_required) return <SecondFactorForm />
  if (raw?.mode === undefined) {
    // A standalone WebUI's single-client OIDC boundary owns a redirect login.
    return (
      <Shell title="Sign in" description="Sign in with your organisation's identity provider.">
        <Button asChild className="w-full">
          <a href="/auth/login">Sign in</a>
        </Button>
      </Shell>
    )
  }
  return <LocalSignInForm />
}
