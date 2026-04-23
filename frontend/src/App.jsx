import { useAccount } from 'wagmi'
import { ConnectModal } from './components/ConnectModal'
import { useState } from 'react'

export default function App() {
  const { isConnected } = useAccount()
  const [ready, setReady] = useState(false)

  // Once authed, game takes over — React just stays mounted silently
  if (ready) return null

  return <ConnectModal onReady={() => setReady(true)} />
}
