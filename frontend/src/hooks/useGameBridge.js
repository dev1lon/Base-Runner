import { useEffect } from 'react'
import { useWalletClient, useDisconnect } from 'wagmi'

/**
 * Bridges wagmi wallet state → window.__walletBridge so script.js can use it.
 * After setting the bridge, dispatches 'walletBridgeReady' event which
 * script.js listens for to skip its own auth flow.
 */
export function useGameBridge({ address, chainId, token, onDisconnect }) {
  const { data: walletClient } = useWalletClient()
  const { disconnect } = useDisconnect()

  useEffect(() => {
    if (!address || !token) return

    // Expose EIP-1193 provider from wagmi walletClient for script.js
    const provider = walletClient?.transport?.request
      ? {
          request: (args) => walletClient.transport.request(args),
          on: () => {},
          removeListener: () => {},
        }
      : window.ethereum

    window.__walletBridge = {
      address,
      chainId,
      token,
      provider,
      disconnect: () => {
        disconnect()
        onDisconnect?.()
      },
    }

    // script.js listens for this to init wallet state from bridge
    window.dispatchEvent(new CustomEvent('walletBridgeReady', {
      detail: { address, chainId, token, provider }
    }))
  }, [address, chainId, token, walletClient]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up bridge on unmount / disconnect
  useEffect(() => {
    return () => { window.__walletBridge = null }
  }, [])
}
