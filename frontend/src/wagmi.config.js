import { createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors'

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID ?? ''

export const config = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({
      appName: 'Rug Pull Run',
      appLogoUrl: 'https://rugpullrun.app/assets/coin.png',
      preference: 'smartWalletOnly',
    }),
    injected({ shimDisconnect: true }),
    ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID })] : []),
  ],
  transports: {
    [base.id]: http(),
  },
})
