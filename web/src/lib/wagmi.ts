import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet, arenaLocal } from "./chains";

export const wagmiConfig = createConfig({
  chains: [arenaLocal, arcTestnet],
  connectors: [injected()],
  transports: {
    [arenaLocal.id]: http("http://127.0.0.1:8555", { batch: true }),
    [arcTestnet.id]: http("https://rpc.testnet.arc.io", { batch: true }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
