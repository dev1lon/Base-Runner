import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { sdk } from '@farcaster/miniapp-sdk'
import { config } from './wagmi.config'
import App from './App.jsx'
import './wallet.css'

const queryClient = new QueryClient()

// Signal to Farcaster/Base App that mini-app UI is ready to display.
// Must be called after the app has loaded; otherwise splash screen stays forever.
sdk.actions.ready().catch(() => { /* not in a mini-app context — noop */ })

// Expose SDK on window so script.js can call sdk.actions.addMiniApp()
window.__farcasterSdk = sdk

createRoot(document.getElementById('wallet-root')).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
