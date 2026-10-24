import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { wagmiConfig } from "./lib/wagmi";
import { ArenaProvider } from "./lib/arena";
import { App } from "./App";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ArenaProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ArenaProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
