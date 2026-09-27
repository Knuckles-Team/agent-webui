import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPasskey, usePasskey } from '@/lib/passkeys'

const bytes = (...values: number[]) => new Uint8Array(values).buffer

describe('passkey browser evidence', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('converts server challenges and returns only the browser credential evidence', async () => {
    vi.stubGlobal('isSecureContext', true)
    const create = vi.fn((_options: CredentialCreationOptions) =>
      Promise.resolve({
        id: 'credential',
        rawId: bytes(1, 2),
        type: 'public-key',
        response: { attestationObject: bytes(3), clientDataJSON: bytes(4), getTransports: () => ['internal'] },
      }),
    )
    const get = vi.fn((_options: CredentialRequestOptions) =>
      Promise.resolve({
        id: 'credential',
        rawId: bytes(1, 2),
        type: 'public-key',
        response: { authenticatorData: bytes(5), clientDataJSON: bytes(6), signature: bytes(7), userHandle: null },
      }),
    )
    vi.stubGlobal('navigator', { credentials: { create, get } })

    const registration = await createPasskey({
      challenge: 'AQ',
      user: { id: 'Ag', name: 'alice', displayName: 'Alice' },
      rp: { name: 'GraphOS' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ type: 'public-key', id: 'Aw' }],
    } as unknown as PublicKeyCredentialCreationOptions)
    expect(new Uint8Array(create.mock.calls[0][0].publicKey!.challenge as ArrayBuffer)).toEqual(new Uint8Array([1]))
    expect(new Uint8Array(create.mock.calls[0][0].publicKey!.user.id as ArrayBuffer)).toEqual(new Uint8Array([2]))
    expect(registration).toEqual({
      id: 'credential',
      rawId: 'AQI',
      type: 'public-key',
      response: { attestationObject: 'Aw', clientDataJSON: 'BA', transports: ['internal'] },
    })

    const assertion = await usePasskey({
      challenge: 'AQ',
      allowCredentials: [{ type: 'public-key', id: 'Ag' }],
    } as unknown as PublicKeyCredentialRequestOptions)
    expect(new Uint8Array(get.mock.calls[0][0].publicKey!.allowCredentials![0].id as ArrayBuffer)).toEqual(
      new Uint8Array([2]),
    )
    expect(assertion).toEqual({
      id: 'credential',
      rawId: 'AQI',
      type: 'public-key',
      response: { authenticatorData: 'BQ', clientDataJSON: 'Bg', signature: 'Bw', userHandle: null },
    })
  })

  it('refuses insecure contexts and invalid browser evidence', async () => {
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('navigator', { credentials: { get: vi.fn() } })
    await expect(usePasskey({ challenge: 'AQ' } as unknown as PublicKeyCredentialRequestOptions)).rejects.toThrow(
      'secure browser context',
    )
    vi.stubGlobal('isSecureContext', true)
    await expect(
      usePasskey({ challenge: 'not valid!' } as unknown as PublicKeyCredentialRequestOptions),
    ).rejects.toThrow('Invalid passkey options')
  })
})
