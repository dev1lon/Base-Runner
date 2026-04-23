import { useState } from 'react'
import { useConnect, useAccount } from 'wagmi'
import { useSIWE } from '../hooks/useSIWE'
import { useGameBridge } from '../hooks/useGameBridge'

const BASE_CHAIN_ID = 8453

export function ConnectModal({ onReady }) {
  const { connect, connectors, isPending } = useConnect()
  const { address, chainId, isConnected } = useAccount()
  const { signIn, status: siweStatus, reset: siweReset } = useSIWE()
  const [token, setToken] = useState(null)
  const [authData, setAuthData] = useState(null)
  const [error, setError] = useState('')
  const [showStandard, setShowStandard] = useState(false)

  useGameBridge({
    address,
    chainId: chainId ?? BASE_CHAIN_ID,
    token,
    onDisconnect: () => {
      setToken(null)
      setAuthData(null)
      setShowStandard(false)
      siweReset()
    },
  })

  // Auto-trigger SIWE once wallet is connected but not yet authed
  const handleSignIn = async () => {
    if (!address) return
    setError('')
    try {
      const data = await signIn(address, chainId ?? BASE_CHAIN_ID)
      setToken(data.token)
      setAuthData(data)
      onReady?.(data)
    } catch (err) {
      if (!err.message?.toLowerCase().includes('reject')) {
        setError(err.message ?? 'Sign-in failed')
      }
    }
  }

  const smartConnector = connectors.find(c => c.id === 'coinbaseWalletSDK')
  const injectedConnectors = connectors.filter(c => c.id !== 'coinbaseWalletSDK')

  // Phase 3: authenticated — bridge is active, hide this modal
  if (token) return null

  // Phase 2: connected, need to sign
  if (isConnected && address) {
    return (
      <div className="rpr-overlay">
        <div className="rpr-card">
          <div className="card-corner card-corner-tl" />
          <div className="card-corner card-corner-tr" />
          <div className="card-corner card-corner-bl" />
          <div className="card-corner card-corner-br" />
          <div className="card-header">
            <h1 className="card-title">RUG PULL RUN</h1>
            <p className="card-subtitle">Sign to verify ownership</p>
          </div>
          <div className="card-body">
            <p className="rpr-address">{address.slice(0, 6)}…{address.slice(-4)}</p>
            <button
              className="btn btn-primary btn-large"
              onClick={handleSignIn}
              disabled={siweStatus === 'pending'}
            >
              {siweStatus === 'pending' ? 'Signing…' : 'Sign In'}
            </button>
            {(siweStatus === 'cancelled' || siweStatus === 'error') && (
              <button className="btn btn-ghost" onClick={handleSignIn} style={{ marginTop: 8 }}>
                Try Again
              </button>
            )}
            {error && <p className="rpr-error">{error}</p>}
          </div>
          <div className="card-ground" />
        </div>
      </div>
    )
  }

  // Phase 1: not connected — show wallet selector
  return (
    <div className="rpr-overlay">
      <div className="rpr-card">
        <div className="card-corner card-corner-tl" />
        <div className="card-corner card-corner-tr" />
        <div className="card-corner card-corner-bl" />
        <div className="card-corner card-corner-br" />
        <div className="card-header">
          <h1 className="card-title">RUG PULL RUN</h1>
          <p className="card-subtitle">Run. Earn. Unlock.</p>
        </div>
        <div className="card-body">
          {!showStandard ? (
            <>
              {smartConnector && (
                <button
                  className="btn btn-primary btn-large"
                  onClick={() => connect({ connector: smartConnector })}
                  disabled={isPending}
                >
                  {isPending ? 'Connecting…' : 'Smart Wallet'}
                </button>
              )}
              <button
                className="btn btn-ghost btn-large"
                onClick={() => setShowStandard(true)}
                style={{ marginTop: 10 }}
              >
                Standard Wallet
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setShowStandard(false)}
                style={{ marginBottom: 10, fontSize: 13 }}
              >
                ← Back
              </button>
              {injectedConnectors.map(c => (
                <button
                  key={c.id}
                  className="btn btn-ghost btn-large"
                  onClick={() => connect({ connector: c })}
                  disabled={isPending}
                  style={{ marginBottom: 8 }}
                >
                  {isPending ? 'Connecting…' : c.name}
                </button>
              ))}
            </>
          )}
          {error && <p className="rpr-error">{error}</p>}
        </div>
        <div className="card-rules">
          <p className="rules-title">How to play:</p>
          <ul className="rules-list">
            <li>Jump: Space / Arrow Up (tap left on mobile)</li>
            <li>Duck: Arrow Down / S (hold right on mobile)</li>
            <li>Avoid coins and birds as obstacles</li>
            <li>Free: 1 coin / 1,000 pts · Paid: 5 coins / 1,000 pts</li>
          </ul>
        </div>
        <div className="card-ground" />
      </div>
    </div>
  )
}
