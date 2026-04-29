import { useEffect, useState } from 'react'

// Detects wallet capabilities via EIP-5792 wallet_getCapabilities.
// Returns null while loading, or a capabilities object for Base (chainId 8453).
export function useCapabilities(address) {
  const [caps, setCaps] = useState(null)

  useEffect(() => {
    if (!address) {
      queueMicrotask(() => setCaps(null))
      return
    }
    const provider = window.__walletBridge?.provider || window.ethereum
    if (!provider?.request) {
      queueMicrotask(() => setCaps({ atomic: false, paymasterService: false, auxiliaryFunds: false }))
      return
    }

    let cancelled = false
    provider.request({ method: 'wallet_getCapabilities', params: [address] })
      .then(result => {
        if (cancelled) return
        // Base mainnet: key is "0x2105"
        const baseCaps = result?.['0x2105'] || result?.[8453] || {}
        const atomicStatus = baseCaps.atomic?.status ?? baseCaps.atomic?.supported
        setCaps({
          atomic: atomicStatus === 'supported' || atomicStatus === 'ready',
          paymasterService: !!baseCaps.paymasterService?.supported,
          auxiliaryFunds: !!baseCaps.auxiliaryFunds?.supported,
          raw: baseCaps,
        })
      })
      .catch(() => {
        // Wallet doesn't support EIP-5792 (EOA wallets) — no capabilities
        if (!cancelled) setCaps({ atomic: false, paymasterService: false, auxiliaryFunds: false })
      })

    return () => { cancelled = true }
  }, [address])

  return caps
}
