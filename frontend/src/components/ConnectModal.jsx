import { useState, useEffect, useRef } from 'react'
import { useConnect, useAccount } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { useSIWE } from '../hooks/useSIWE'
import { useGameBridge } from '../hooks/useGameBridge'

const BASE_CHAIN_ID = 8453

function isWalletApp() {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('coinbase') || ua.includes('metamask') || ua.includes('trust') || ua.includes('rainbow')) return true
  const eth = window.ethereum
  if (eth && (eth.isCoinbaseWallet || eth.isCoinbaseBrowser || eth.isMetaMask || eth.isTrust)) return true
  return false
}

export function ConnectModal({ onReady }) {
  const { connect, connectors, isPending } = useConnect()
  const { address, chainId, isConnected } = useAccount()
  const { signIn, status: siweStatus, reset: siweReset } = useSIWE()
  const [token, setToken] = useState(null)
  const [error, setError] = useState('')
  const [showStandard, setShowStandard] = useState(false)
  const autoConnectAttempted = useRef(false)
  const autoSignAttempted = useRef(false)

  useGameBridge({
    address,
    chainId: chainId ?? BASE_CHAIN_ID,
    token,
    onDisconnect: () => {
      setToken(null)
      setShowStandard(false)
      autoSignAttempted.current = false
      siweReset()
    },
  })

  // Auto-connect when inside Base App / mobile wallet browser
  useEffect(() => {
    if (autoConnectAttempted.current || isConnected) return
    if (!isWalletApp()) return
    autoConnectAttempted.current = true
    connect({ connector: injected() })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignIn = async () => {
    if (!address) return
    setError('')
    try {
      const data = await signIn(address, chainId ?? BASE_CHAIN_ID)
      setToken(data.token)
      onReady?.(data)
    } catch (err) {
      if (!err.message?.toLowerCase().includes('reject')) {
        setError(err.message ?? 'Sign-in failed')
      }
    }
  }

  // Auto-sign SIWE when inside wallet app and just connected
  useEffect(() => {
    if (!isConnected || !address || token) return
    if (!isWalletApp()) return
    if (autoSignAttempted.current) return
    autoSignAttempted.current = true
    handleSignIn()
  }, [isConnected, address]) // eslint-disable-line react-hooks/exhaustive-deps

  const smartConnector = connectors.find(c => c.id === 'coinbaseWalletSDK')
  const injectedConnectors = connectors.filter(c => c.id !== 'coinbaseWalletSDK')

  // Authenticated — hide modal
  if (token) return null

  // Inside wallet app — show minimal loading screen while auto-connecting/signing
  if (isWalletApp()) {
    const hasError = siweStatus === 'cancelled' || siweStatus === 'error' || !!error
    return (
      <div className="rpr-overlay">
        <div className="rpr-card">
          <div className="card-corner card-corner-tl" />
          <div className="card-corner card-corner-tr" />
          <div className="card-corner card-corner-bl" />
          <div className="card-corner card-corner-br" />
          <div className="card-header">
            <h1 className="card-title">RUG PULL RUN</h1>
            <p className="card-subtitle">
              {!isConnected
                ? 'Connecting…'
                : siweStatus === 'pending'
                ? 'Signing…'
                : hasError
                ? 'Sign in to play'
                : 'Sign to continue'}
            </p>
          </div>
          <div className="card-body">
            {hasError && (
              <>
                {error && <p className="rpr-error" style={{ marginBottom: 12 }}>{error}</p>}
                <button
                  className="btn btn-primary btn-large"
                  onClick={handleSignIn}
                  disabled={siweStatus === 'pending'}
                >
                  {siweStatus === 'pending' ? 'Signing…' : 'Sign In'}
                </button>
              </>
            )}
          </div>
          <div className="card-ground" />
        </div>
      </div>
    )
  }

  // Desktop / external browser — Phase 2: connected, need to sign
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

  // Desktop — Phase 1: wallet selector
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
