/** Browser WebAuthn conversion; GraphOS owns challenge and assertion validation. */

function decode(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid passkey options')
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer
}

function encode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function credentialApi(): CredentialsContainer {
  const credentials: unknown = Reflect.get(navigator, 'credentials')
  if (!window.isSecureContext || !credentials || typeof credentials !== 'object')
    throw new Error('Passkeys require a secure browser context')
  return credentials as CredentialsContainer
}

export async function createPasskey(options: PublicKeyCredentialCreationOptions): Promise<Record<string, unknown>> {
  const credential = await credentialApi().create({
    publicKey: {
      ...options,
      challenge: decode(options.challenge as unknown as string),
      user: { ...options.user, id: decode(options.user.id as unknown as string) },
      excludeCredentials: options.excludeCredentials?.map((item) => ({
        ...item,
        id: decode(item.id as unknown as string),
      })),
    },
  })
  if (credential?.type !== 'public-key') throw new Error('Passkey creation was cancelled')
  const created = credential as PublicKeyCredential
  const response = created.response as AuthenticatorAttestationResponse
  if (!(response.attestationObject instanceof ArrayBuffer) || !(response.clientDataJSON instanceof ArrayBuffer))
    throw new Error('Passkey creation returned invalid evidence')
  const getTransports = Reflect.get(response, 'getTransports') as (() => string[]) | undefined
  return {
    id: created.id,
    rawId: encode(created.rawId),
    type: created.type,
    response: {
      attestationObject: encode(response.attestationObject),
      clientDataJSON: encode(response.clientDataJSON),
      transports: getTransports?.call(response) ?? [],
    },
  }
}

export async function usePasskey(options: PublicKeyCredentialRequestOptions): Promise<Record<string, unknown>> {
  const credential = await credentialApi().get({
    publicKey: {
      ...options,
      challenge: decode(options.challenge as unknown as string),
      allowCredentials: options.allowCredentials?.map((item) => ({
        ...item,
        id: decode(item.id as unknown as string),
      })),
    },
  })
  if (credential?.type !== 'public-key') throw new Error('Passkey verification was cancelled')
  const asserted = credential as PublicKeyCredential
  const response = asserted.response as AuthenticatorAssertionResponse
  if (
    !(response.authenticatorData instanceof ArrayBuffer) ||
    !(response.clientDataJSON instanceof ArrayBuffer) ||
    !(response.signature instanceof ArrayBuffer)
  )
    throw new Error('Passkey verification returned invalid evidence')
  return {
    id: asserted.id,
    rawId: encode(asserted.rawId),
    type: asserted.type,
    response: {
      authenticatorData: encode(response.authenticatorData),
      clientDataJSON: encode(response.clientDataJSON),
      signature: encode(response.signature),
      userHandle: response.userHandle ? encode(response.userHandle) : null,
    },
  }
}
