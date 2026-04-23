import { useEffect } from 'react'
import { useWalletClient, useDisconnect } from 'wagmi'
import { useCapabilities } from './useCapabilities'

/**
 * Bridges wagmi wallet state → window.__walletBridge so script.js can use it.
 * After setting the bridge, dispatches 'walletBridgeReady' event which
 * script.js listens for to skip its own auth flow.
 */
export function useGameBridge({ address, chainId, token, onDisconnect }) {
  const { data: walletClient } = useWalletClient()
  const { disconnect } = useDisconnect()
  const capabilities = useCapabilities(address && token ? address : null)

  useEffect(() => {
    if (!address || !token) return

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
      capabilities,
      disconnect: () => {
        disconnect()
        onDisconnect?.()
      },
    }

    window.dispatchEvent(new CustomEvent('walletBridgeReady', {
      detail: { address, chainId, token, provider, capabilities }
    }))
  }, [address, chainId, token, walletClient, capabilities]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up bridge on unmount / disconnect
  useEffect(() => {
    return () => { window.__walletBridge = null }
  }, [])
}
