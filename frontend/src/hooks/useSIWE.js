import { signMessage as wagmiSignMessage } from '@wagmi/core'
import { useState, useCallback } from 'react'
import { config } from '../wagmi.config'

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

  const signIn = useCallback(async (address, chainId) => {
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

      // 3. Sign via @wagmi/core signMessage action — with 30s timeout so it never hangs forever
      const signature = await Promise.race([
        wagmiSignMessage(config, { message, account: address }),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('Sign request timed out'), { code: 'TIMEOUT' })), 30_000)
        ),
      ])

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

      // If running in Base App / Farcaster, link FID for push notifications (best-effort)
      try {
        const { sdk } = await import('@farcaster/miniapp-sdk')
        const ctx = await sdk.context
        const fid = ctx?.user?.fid
        if (fid) {
          fetch(`${BACKEND}/api/user/link-fid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vr.token}` },
            body: JSON.stringify({ fid }),
          }).catch(() => {})
        }
      } catch (_) { /* not in mini-app context — noop */ }

      setStatus('done')
      return vr
    } catch (err) {
      const isCancel = err.code === 4001 || err.message?.toLowerCase().includes('reject')
      const isTimeout = err.code === 'TIMEOUT'
      setStatus(isCancel ? 'cancelled' : isTimeout ? 'idle' : 'error')
      throw err
    }
  }, [])

  const reset = useCallback(() => setStatus('idle'), [])

  return { signIn, status, reset }
}
