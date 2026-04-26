import { createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import { baseAccount, injected } from 'wagmi/connectors'

// ERC-8021 builder code — auto-appended to all wagmi transactions for Base attribution
const BUILDER_CODE = '0x62635f64357464397274770b0080218021802180218021802180218021'

export const config = createConfig({
  chains: [base],
  connectors: [
    baseAccount({ appName: 'Rug Pull Run' }),
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [base.id]: http(),
  },
  dataSuffix: BUILDER_CODE,
})
