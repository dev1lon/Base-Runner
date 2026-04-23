import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { ConnectModal } from './components/ConnectModal'

export default function App() {
  const [open, setOpen] = useState(false)
  const { isConnected } = useAccount()

  useEffect(() => {
    // script.js dispatches this when user clicks Connect Wallet
    const handler = () => setOpen(true)
    window.addEventListener('wallet:openModal', handler)
    return () => window.removeEventListener('wallet:openModal', handler)
  }, [])

  // Always render ConnectModal so useGameBridge hook stays alive (bridge persists after auth)
  // Pass open prop to control visibility — modal hides when open=false AND token is set
  return (
    <ConnectModal
      open={open}
      onClose={() => setOpen(false)}
      onReady={() => setOpen(false)}
    />
  )
}
