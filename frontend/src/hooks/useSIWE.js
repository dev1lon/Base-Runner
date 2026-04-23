import { useState, useCallback } from 'react'
import { useSignMessage } from 'wagmi'
import { SiweMessage } from 'siwe'

const BACKEND = import.meta.env.VITE_BACKEND_URL ?? ''
const AUTH_KEY = 'runner_auth_token'

function storeToken(address, token) {
  let map = {}
  try { map = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}') } catch {}
  map[address.toLowerCase()] = token
  localStorage.setItem(AUTH_KEY, JSON.stringify(map))
}

export function useSIWE() {
  const { signMessageAsync } = useSignMessage()
  const [status, setStatus] = useState('idle') // idle | pending | done | error | cancelled

  const signIn = useCallback(async (address, chainId) => {
    setStatus('pending')
    try {
      // 1. Get nonce
      const nr = await fetch(`${BACKEND}/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId }),
      }).then(r => r.json())
      if (!nr.ok) throw new Error(nr.error ?? 'Nonce failed')

      // 2. Build EIP-4361 SIWE message
      const msg = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in to Rug Pull Run',
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce: nr.nonce,
        issuedAt: nr.issuedAt,
      })
      const prepared = msg.prepareMessage()

      // 3. Sign
      const signature = await signMessageAsync({ message: prepared })

      // 4. Verify — try SIWE endpoint first, fallback to legacy
      let vr = await fetch(`${BACKEND}/auth/siwe-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prepared, signature }),
      }).then(r => r.json()).catch(() => ({ ok: false }))

      if (!vr.ok) {
        // Legacy fallback: send address+signature to old endpoint
        vr = await fetch(`${BACKEND}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, signature }),
        }).then(r => r.json())
      }

      if (!vr.ok) throw new Error(vr.error ?? 'Auth failed')

      // 5. Store token in same format script.js expects
      storeToken(address, vr.token)
      setStatus('done')
      return vr
    } catch (err) {
      console.error('SIWE error:', err)
      const isCancel = err.code === 4001 || err.message?.toLowerCase().includes('reject')
      setStatus(isCancel ? 'cancelled' : 'error')
      throw err
    }
  }, [signMessageAsync])

  const reset = useCallback(() => setStatus('idle'), [])

  return { signIn, status, reset }
}
