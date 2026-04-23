import { useState, useCallback } from 'react'
import { SiweMessage } from 'siwe'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://base-runner-k9oj.onrender.com'
const AUTH_KEY = 'runner_auth_token'

function storeToken(address, token) {
  let map = {}
  try { map = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}') } catch {}
  map[address.toLowerCase()] = token
  localStorage.setItem(AUTH_KEY, JSON.stringify(map))
}

// Sign via window.ethereum directly — bypasses wagmi walletClient timing issues
async function signWithProvider(message, address) {
  const provider = window._activeProvider || window.ethereum
  if (!provider) throw new Error('No wallet provider')
  // personal_sign: params are [message, address]
  return provider.request({ method: 'personal_sign', params: [message, address] })
}

export function useSIWE() {
  const [status, setStatus] = useState('idle')

  const signIn = useCallback(async (address, chainId) => {
    setStatus('pending')
    try {
      const effectiveChainId = chainId || 8453
      console.log('[SIWE] backend:', BACKEND, 'address:', address, 'chainId:', effectiveChainId)

      // 1. Get nonce
      const nr = await fetch(`${BACKEND}/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId: effectiveChainId }),
      }).then(r => r.json())
      if (!nr.ok) throw new Error(nr.error ?? 'Nonce failed')

      // 2. Build SIWE message
      const msg = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to Rug Pull Run',
        uri: window.location.origin,
        version: '1',
        chainId: effectiveChainId,
        nonce: nr.nonce,
        issuedAt: nr.issuedAt,
      })
      const prepared = msg.prepareMessage()

      // 3. Sign directly via provider (avoids wagmi walletClient timing issues)
      const signature = await signWithProvider(prepared, address)

      // 4. Verify
      let vr = await fetch(`${BACKEND}/auth/siwe-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prepared, signature }),
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
      console.error('[SIWE] error:', err.message, err)
      const isCancel = err.code === 4001 || err.message?.toLowerCase().includes('reject')
      setStatus(isCancel ? 'cancelled' : 'error')
      throw err
    }
  }, [])

  const reset = useCallback(() => setStatus('idle'), [])

  return { signIn, status, reset }
}
