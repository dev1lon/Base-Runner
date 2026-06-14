import { useState, useEffect, useRef } from 'react'
import { useConnect, useAccount, useWalletClient } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { useSIWE } from '../hooks/useSIWE'
import { useGameBridge } from '../hooks/useGameBridge'

const BASE_CHAIN_ID = 8453
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'https://base-runner-k9oj.onrender.com'
const AUTH_KEY = 'runner_auth_token'
const BASE_APP_LINK = 'https://base.app/app/rugpullrun.app'

// Tournament deadline: 2026-06-22 00:00 GMT+3 (night of Sun 21 -> Mon 22).
const TOURNAMENT_END_MS = Date.parse('2026-06-22T00:00:00+03:00')

function formatTournamentCountdown(ms) {
  if (ms <= 0) return 'Ended'
  const t = Math.floor(ms / 60000)
  const d = Math.floor(t / 1440)
  const h = Math.floor((t % 1440) / 60)
  const m = t % 60
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
}

function TournamentBanner() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])
  if (now >= TOURNAMENT_END_MS) return null
  return (
    <div className="gate-tournament">
      <div className="gate-tournament-row">
        <span className="gate-tournament-live"><span className="gate-tournament-dot" aria-hidden="true" />LIVE</span>
        <span className="gate-tournament-title">🏆 Tournament</span>
        <span className="gate-tournament-pool">$50</span>
      </div>
      <div className="gate-tournament-sub">
        Top 3 on the leaderboard win · ends in {formatTournamentCountdown(TOURNAMENT_END_MS - now)}
      </div>
    </div>
  )
}

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
        <div className="card-corner card-corner-tl" />
        <div className="card-corner card-corner-tr" />
        <div className="card-corner card-corner-bl" />
        <div className="card-corner card-corner-br" />
        <div className="base-gate-badge">
          <span className="base-gate-badge-dot" aria-hidden="true" />
          BASE APP ONLY
        </div>
        <TournamentBanner />
        <h1 className="base-gate-title">RUG PULL RUN</h1>
        <p className="base-gate-copy">
          Open the game inside Base App to connect your wallet and play.
        </p>
        <a
          className="btn btn-primary btn-large base-gate-button"
          href={BASE_APP_LINK}
          target="_blank"
          rel="noopener noreferrer"
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          onTouchEnd={(e) => {
            // Fallback: some mobile webviews don't follow target=_blank on tap.
            // Force navigation via JS only when the native anchor didn't take.
            e.stopPropagation();
            try { window.open(BASE_APP_LINK, '_blank', 'noopener,noreferrer'); }
            catch { window.location.href = BASE_APP_LINK; }
          }}
        >
          Open in Base App
        </a>
        <p className="base-gate-link">base.app/app/rugpullrun.app</p>
        <p className="base-gate-credit">
          Created by{' '}
          <a href="https://x.com/devilonnn" target="_blank" rel="noopener noreferrer">
            @devilonnn
          </a>
        </p>
        <div className="base-gate-ground" aria-hidden="true" />
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
      const data = await signIn(address, chainId ?? BASE_CHAIN_ID)
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
