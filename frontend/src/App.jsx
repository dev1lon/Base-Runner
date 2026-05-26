import { ConnectModal } from './components/ConnectModal'

export default function App() {
  const handleReady = () => {
    // Keep the legacy game surface in sync once Base App authentication succeeds.
    setTimeout(() => {
      document.getElementById('overlay-connect')?.classList.add('hidden')
      document.getElementById('overlay-menu')?.classList.remove('hidden')
    }, 50)
  }

  return <ConnectModal onReady={handleReady} />
}
