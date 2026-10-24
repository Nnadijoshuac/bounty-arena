import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useArena } from "./lib/arena";
import { Board } from "./pages/Board";
import { BountyPage } from "./pages/BountyPage";
import { PostPage } from "./pages/PostPage";
import { HunterPage } from "./pages/HunterPage";
import { Leaderboard } from "./pages/Leaderboard";
import { AgentsPage } from "./pages/AgentsPage";

export default function App() {
  const { depError, network } = useArena();
  return (
    <Layout>
      {depError ? (
        <NotReady message={depError} network={network} />
      ) : (
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/bounty/:id" element={<BountyPage />} />
          <Route path="/post" element={<PostPage />} />
          <Route path="/hunter/:address" element={<HunterPage />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="*" element={<NotReady message="That page does not exist." network={network} />} />
        </Routes>
      )}
    </Layout>
  );
}

function NotReady({ message, network }: { message: string; network: string }) {
  return (
    <div className="panel grid-bg ticks mx-auto mt-10 max-w-xl px-8 py-12 text-center">
      <div className="label mb-3">{network === "local" ? "Local demo" : "Arc testnet"}</div>
      <p className="font-display text-xl">{message}</p>
      {network === "local" ? (
        <pre className="mt-6 inline-block rounded-[3px] border border-line bg-ink px-4 py-2 text-left font-mono text-sm text-brass">npm run demo</pre>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Deploy with <code className="font-mono text-fg">npm --prefix contracts run deploy:arc</code> and a funded testnet key in{" "}
          <code className="font-mono text-fg">DEPLOYER_KEY</code>, or switch back to the local demo.
        </p>
      )}
    </div>
  );
}
