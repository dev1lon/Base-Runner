import { useState, useEffect, useRef } from 'react'
import { useConnect, useAccount, useWalletClient } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { useSIWE } from '../hooks/useSIWE'
import { useGameBridge } from '../hooks/useGameBridge'

const BASE_CHAIN_ID = 8453
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://base-runner-k9oj.onrender.com'
const AUTH_KEY = 'runner_auth_token'
const BASE_APP_LINK = 'https://base.app/app/rugpullrun.app'

function getStoredToken(address) {
  if (!address) return null
  try {
    const map = JSON.parse(localStorage.getItem(AUTH_KEY) ?? '{}')
    return map[address.toLowerCase()] || null
  } catch {
    return null
  }
}

async function validateToken(token) {
  try {
    const response = await fetch(`${BACKEND}/api/user/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const data = await response.json()
    return data?.ok ? data : null
  } catch {
    return null
  }
}

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

function isBaseAppEnvironment() {
  if (!isMobile()) return false
  const ua = navigator.userAgent.toLowerCase()
  const provider = window.ethereum
  return ua.includes('base app') ||
    ua.includes('baseapp') ||
    ua.includes('coinbase') ||
    !!(provider && (provider.isCoinbaseWallet || provider.isCoinbaseBrowser))
}

function BaseAppOnlyScreen() {
  return (
    <div className="base-gate">
      <main className="base-gate-frame">
        <div className="base-gate-mark" aria-hidden="true" />
        <p className="base-gate-kicker">BASE APP ONLY</p>
        <h1 className="base-gate-title">RUG PULL RUN</h1>
        <p className="base-gate-copy">
          Open the game inside Base App to connect your wallet and play.
        </p>
        <a className="base-gate-button" href={BASE_APP_LINK}>
          Open in Base App
        </a>
        <p className="base-gate-link">base.app/app/rugpullrun.app</p>
      </main>
    </div>
  )
}

export function ConnectModal({ onReady }) {
  const { connect } = useConnect()
  const { address, chainId, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { signIn, status: siweStatus, reset: siweReset } = useSIWE()
  const [token, setToken] = useState(null)
  const [error, setError] = useState('')
  const [inBaseApp, setInBaseApp] = useState(() => isBaseAppEnvironment())
  const autoConnectAttempted = useRef(false)
  const autoSignAttempted = useRef(false)

  useEffect(() => {
    if (inBaseApp) return undefined

    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      if (isBaseAppEnvironment()) {
        setInBaseApp(true)
        window.clearInterval(timer)
      } else if (attempts >= 20) {
        window.clearInterval(timer)
      }
    }, 150)

    return () => window.clearInterval(timer)
  }, [inBaseApp])

  useGameBridge({
    address: inBaseApp ? address : null,
    chainId: chainId ?? BASE_CHAIN_ID,
    token: inBaseApp ? token : null,
    onDisconnect: () => {
      setToken(null)
      setError('')
      autoConnectAttempted.current = false
      autoSignAttempted.current = false
      siweReset()
    },
  })

  const handleConnect = () => {
    setError('')
    connect(
      { connector: injected() },
      { onError: (err) => setError(err.message ?? 'Wallet connection failed') },
    )
  }

  useEffect(() => {
    if (!inBaseApp || autoConnectAttempted.current || isConnected) return
    autoConnectAttempted.current = true
    connect(
      { connector: injected() },
      { onError: (err) => setError(err.message ?? 'Wallet connection failed') },
    )
  }, [inBaseApp, isConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignIn = async () => {
    if (!inBaseApp || !isConnected || !address) return
    setError('')
    try {
      const data = await signIn(address, chainId ?? BASE_CHAIN_ID, walletClient)
      setToken(data.token)
      onReady?.()
    } catch (err) {
      const isReject = err.code === 4001 || err.message?.toLowerCase().includes('reject')
      if (!isReject) setError(err.message ?? 'Sign-in failed')
    }
  }

  useEffect(() => {
    if (!inBaseApp || !isConnected || !address || token || !walletClient) return
    if (autoSignAttempted.current) return
    autoSignAttempted.current = true

    const stored = getStoredToken(address)
    if (stored) {
      validateToken(stored).then((data) => {
        if (data) {
          setToken(stored)
          onReady?.()
        } else {
          handleSignIn()
        }
      })
    } else {
      Promise.resolve().then(() => handleSignIn())
    }
  }, [inBaseApp, isConnected, address, walletClient, token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!inBaseApp) return <BaseAppOnlyScreen />
  if (token) return null

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
              ? 'Connecting...'
              : siweStatus === 'pending'
                ? 'Signing...'
                : hasError
                  ? 'Sign in to play'
                  : 'Sign to continue'}
          </p>
        </div>
        <div className="card-body">
          {error && <p className="rpr-error" style={{ marginBottom: 12 }}>{error}</p>}
          {!isConnected && (
            <button className="btn btn-primary btn-large" onClick={handleConnect}>
              Connect Wallet
            </button>
          )}
          {isConnected && siweStatus !== 'pending' && (
            <button
              className="btn btn-primary btn-large"
              style={{ touchAction: 'manipulation' }}
              onClick={handleSignIn}
              onTouchEnd={(event) => {
                event.preventDefault()
                handleSignIn()
              }}
            >
              Sign In
            </button>
          )}
        </div>
        <div className="card-ground" />
      </div>
    </div>
  )
}
