import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcMainnet, arcTestnet, arenaLocal } from "@shared";

export const wagmiConfig = createConfig({
  chains: [arenaLocal, arcTestnet, arcMainnet],
  connectors: [injected()],
  transports: {
    [arenaLocal.id]: http(arenaLocal.rpcUrls.default.http[0], { batch: true }),
    [arcTestnet.id]: http(arcTestnet.rpcUrls.default.http[0], { batch: true }),
    [arcMainnet.id]: http(arcMainnet.rpcUrls.default.http[0], { batch: true }),
  },
});
