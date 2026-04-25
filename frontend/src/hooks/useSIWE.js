import { useState, useCallback } from 'react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://base-runner-k9oj.onrender.com'
const AUTH_KEY = 'runner_auth_token'

function storeToken(address, token) {
  let map = {}
  try { map = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}') } catch {}
  map[address.toLowerCase()] = token
  localStorage.setItem(AUTH_KEY, JSON.stringify(map))
}

function buildSiweMessage({ domain, address, statement, uri, chainId, nonce, issuedAt }) {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    statement,
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n')
}

export function useSIWE() {
  const [status, setStatus] = useState('idle')

  // walletClient is passed in so we use the already-ready client (avoids re-fetching connector)
  const signIn = useCallback(async (address, chainId, walletClient) => {
    setStatus('pending')
    try {
      const effectiveChainId = chainId || 8453

      // 1. Nonce
      const nr = await fetch(`${BACKEND}/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId: effectiveChainId }),
      }).then(r => r.json())
      if (!nr.ok) throw new Error(nr.error ?? 'Nonce failed')

      // 2. EIP-4361 message
      const message = buildSiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to Rug Pull Run',
        uri: window.location.origin,
        chainId: effectiveChainId,
        nonce: nr.nonce,
        issuedAt: nr.issuedAt,
      })

      // 3. Sign — use Farcaster SDK provider in mini-app context (proper channel for Base App)
      // Fallback chain: sdk.wallet.ethProvider → walletClient.signMessage → window.ethereum
      let signature
      try {
        const { sdk } = await import('@farcaster/miniapp-sdk')
        const sdkProvider = sdk.wallet?.ethProvider
        if (sdkProvider) {
          signature = await sdkProvider.request({ method: 'personal_sign', params: [message, address] })
        } else {
          throw new Error('not in mini-app context')
        }
      } catch (sdkErr) {
        if (sdkErr.code === 4001 || sdkErr.message?.toLowerCase().includes('reject')) throw sdkErr
        // Not in mini-app context — use walletClient or window.ethereum
        if (walletClient?.signMessage) {
          signature = await walletClient.signMessage({ account: address, message })
        } else {
          const provider = window.ethereum
          if (!provider) throw new Error('No wallet provider')
          signature = await provider.request({ method: 'personal_sign', params: [message, address] })
        }
      }

      // 4. Verify
      let vr = await fetch(`${BACKEND}/auth/siwe-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      }).then(r => r.json()).catch(() => ({ ok: false }))

      if (!vr.ok) {
        vr = await fetch(`${BACKEND}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, signature }),
        }).then(r => r.json())
      }
      if (!vr.ok) throw new Error(vr.error ?? 'Auth failed')

      storeToken(address, vr.token)
      setStatus('done')
      return vr
    } catch (err) {
      const isCancel = err.code === 4001 || err.message?.toLowerCase().includes('reject')
      setStatus(isCancel ? 'cancelled' : 'error')
      throw err
    }
  }, [])

  const reset = useCallback(() => setStatus('idle'), [])

  return { signIn, status, reset }
}
