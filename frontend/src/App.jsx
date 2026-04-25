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

  const handleReady = () => {
    setOpen(false)
    // Direct DOM transition — most reliable way to show game menu
    // regardless of bridge event timing
    setTimeout(() => {
      document.getElementById('overlay-connect')?.classList.add('hidden')
      document.getElementById('overlay-menu')?.classList.remove('hidden')
    }, 50)
  }

  return (
    <ConnectModal
      open={open}
      onClose={() => setOpen(false)}
      onReady={handleReady}
    />
  )
}
