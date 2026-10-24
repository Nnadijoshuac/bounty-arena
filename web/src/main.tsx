import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./lib/wagmi";
import { ArenaProvider } from "./lib/arena";
import App from "./App";
import "./index.css";

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 40, fontFamily: "Geist, sans-serif", color: "#f1eae0" }}>
        <p style={{ fontSize: 20 }}>Something broke while drawing the arena.</p>
        <pre style={{ color: "#a39a8c", whiteSpace: "pre-wrap" }}>{this.state.error.message}</pre>
        <button onClick={() => location.reload()} style={{ marginTop: 16, color: "#e8b04b" }}>
          Reload
        </button>
      </div>
    );
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2000, refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ArenaProvider>
            <App />
          </ArenaProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
    </Boundary>
  </React.StrictMode>,
);
