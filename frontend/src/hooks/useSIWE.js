import { useState, useCallback } from 'react'
import { useSignMessage } from 'wagmi'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://base-runner-k9oj.onrender.com'
const AUTH_KEY = 'runner_auth_token'

function storeToken(address, token) {
  let map = {}
  try { map = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}') } catch {}
  map[address.toLowerCase()] = token
  localStorage.setItem(AUTH_KEY, JSON.stringify(map))
}

export function useSIWE() {
  const { signMessageAsync, reset: resetMutation } = useSignMessage()
  const [status, setStatus] = useState('idle')

  const signIn = useCallback(async (address, chainId) => {
    setStatus('pending')
    resetMutation()
    try {
      const effectiveChainId = chainId || 8453

      // 1. Get nonce from backend
      const nr = await fetch(`${BACKEND}/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId: effectiveChainId }),
      }).then(r => r.json())
      if (!nr.ok) throw new Error(nr.error ?? 'Nonce failed')

      // 2. Build EIP-4361 message using viem/siwe (per Base docs)
      const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to Rug Pull Run',
        uri: window.location.origin,
        version: '1',
        chainId: effectiveChainId,
        nonce: nr.nonce,
        issuedAt: new Date(nr.issuedAt),
      })

      // 3. Sign via wagmi useSignMessage (per Base docs standard approach)
      const signature = await signMessageAsync({ message })

      // 4. Verify on backend
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
  }, [signMessageAsync, resetMutation])

  const reset = useCallback(() => setStatus('idle'), [])

  return { signIn, status, reset }
}
