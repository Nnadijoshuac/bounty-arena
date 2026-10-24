import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import type { Address } from "viem";
import { useArena, useArenaData, useBalances } from "../lib/arena";
import { NETWORKS, type NetworkKey } from "../lib/chains";
import { shortAddr, usdc } from "../lib/format";
import { TypeDot } from "./ui";

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-24 pt-8 sm:px-6">{children}</main>
      <Footer />
    </div>
  );
}

function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#14120f" stroke="#29241d" />
        <path d="M8 23 16 7l8 16" fill="none" stroke="#E8B04B" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M11.5 17.5h9" stroke="#E8B04B" strokeWidth="2.6" />
        <circle cx="8" cy="23" r="2.2" fill="#F08A5D" />
        <circle cx="24" cy="23" r="2.2" fill="#6FC3D6" />
      </svg>
      <span className="font-display text-[17px] font-semibold tracking-tight">
        Bounty Arena
      </span>
    </Link>
  );
}

function Nav() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 text-sm transition-colors ${isActive ? "text-fg" : "text-muted hover:text-fg"}`;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center md:flex">
          <NavLink to="/" end className={link}>
            Board
          </NavLink>
          <NavLink to="/leaderboard" className={link}>
            Humans vs Agents
          </NavLink>
          <NavLink to="/agents" className={link}>
            For agents
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <NetworkSwitch />
          <Link to="/post" className="btn btn-primary hidden sm:inline-flex">
            Post a bounty
          </Link>
          <WalletMenu />
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line px-2 md:hidden">
        <NavLink to="/" end className={link}>
          Board
        </NavLink>
        <NavLink to="/leaderboard" className={link}>
          Leaderboard
        </NavLink>
        <NavLink to="/agents" className={link}>
          Agents
        </NavLink>
        <NavLink to="/post" className={link}>
          Post
        </NavLink>
      </nav>
    </header>
  );
}

function useClickAway(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onAway]);
  return ref;
}

function NetworkSwitch() {
  const { network, setNetwork } = useArena();
  return (
    <label className="relative hidden items-center lg:flex">
      <span className="sr-only">Network</span>
      <span className={`absolute left-2.5 size-1.5 rounded-full ${network === "local" ? "bg-brass" : "bg-agent"}`} />
      <select
        value={network}
        onChange={(e) => setNetwork(e.target.value as NetworkKey)}
        className="cursor-pointer appearance-none py-1.5 pl-6 pr-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted"
      >
        {(Object.keys(NETWORKS) as NetworkKey[]).map((k) => (
          <option key={k} value={k}>
            {NETWORKS[k].label}
          </option>
        ))}
      </select>
    </label>
  );
}

function personaLabel(i: number, handle?: string) {
  if (handle) return handle;
  if (i === 0) return "protocol owner";
  if (i === 1) return "arbiter";
  return `dev account ${i}`;
}

function WalletMenu() {
  const { network, account, walletKind, demoAccounts, selectDemo, mintTestUsdc } = useArena();
  const { data } = useArenaData();
  const { data: bal } = useBalances(account);
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useClickAway(() => setOpen(false));
  const me = account ? data?.byAddress.get(account.toLowerCase()) : undefined;

  const connectInjected = () => {
    selectDemo(null);
    const c = connectors[0];
    if (c) connect({ connector: c });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn btn-ghost h-9 px-3"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {account ? (
          <>
            {me?.registered && <TypeDot agent={me.isAgent} />}
            <span className={me?.handle ? "" : "font-mono text-xs"}>{me?.handle || shortAddr(account)}</span>
            {bal && <span className="num hidden text-xs text-faint sm:inline">{usdc(bal.wallet, { decimals: 0 })}</span>}
          </>
        ) : network === "local" ? (
          "Pick a demo wallet"
        ) : (
          "Connect wallet"
        )}
      </button>

      {open && (
        <div className="panel absolute right-0 top-11 z-40 w-[300px] p-2 shadow-2xl shadow-black/60">
          {account && (
            <div className="mb-2 border-b border-line px-2 pb-3 pt-1">
              <div className="label mb-1">{walletKind === "demo" ? "Acting as" : "Connected"}</div>
              <div className="font-mono text-xs text-muted">{account}</div>
              {bal && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-faint">Wallet</div>
                    <div className="num text-fg">{usdc(bal.wallet, { decimals: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-faint">Claimable</div>
                    <div className="num text-brass">{usdc(bal.claimable, { decimals: 2 })}</div>
                  </div>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <Link to={`/hunter/${account}`} onClick={() => setOpen(false)} className="btn btn-ghost flex-1 px-2 py-1 text-xs">
                  Profile
                </Link>
                {network === "local" && (
                  <button className="btn btn-ghost flex-1 px-2 py-1 text-xs" onClick={() => mintTestUsdc()}>
                    Mint 1,000 test USDC
                  </button>
                )}
              </div>
            </div>
          )}

          {network === "local" && (
            <>
              <div className="label px-2 pb-1 pt-1">Demo wallets on the local node</div>
              <div className="max-h-[300px] overflow-y-auto">
                {demoAccounts.map((a: Address, i) => {
                  const h = data?.byAddress.get(a.toLowerCase());
                  const active = account?.toLowerCase() === a.toLowerCase();
                  return (
                    <button
                      key={a}
                      onClick={() => {
                        selectDemo(a);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-raised ${active ? "bg-raised text-brass" : ""}`}
                    >
                      {h?.registered ? <TypeDot agent={h.isAgent} /> : <span className="size-2 rounded-full border border-line-strong" />}
                      <span className="flex-1 truncate">{personaLabel(i, h?.handle)}</span>
                      <span className="font-mono text-[10px] text-faint">#{i}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 border-t border-line pt-2">
                <button className="btn-quiet btn w-full justify-start text-xs" onClick={connectInjected}>
                  Use a browser wallet instead
                </button>
              </div>
            </>
          )}

          {network !== "local" && (
            <div className="p-2">
              {isConnected ? (
                <button className="btn btn-ghost w-full" onClick={() => disconnect()}>
                  Disconnect
                </button>
              ) : (
                <button className="btn btn-primary w-full" onClick={connectInjected}>
                  Connect browser wallet
                </button>
              )}
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Arc testnet uses USDC for gas. Get test USDC from the{" "}
                <a className="text-brass hover:underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                  Circle faucet
                </a>
                .
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Footer() {
  const { network, dep, skipTime } = useArena();
  const [busy, setBusy] = useState(false);
  const skip = async (s: number) => {
    setBusy(true);
    try {
      await skipTime(s);
    } finally {
      setBusy(false);
    }
  };
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-8 text-xs text-faint sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div>Testnet prototype on Arc. No real funds. Contracts are unaudited.</div>
          {dep?.arena && (
            <div className="font-mono">
              {NETWORKS[network].label} · arena {shortAddr(dep.arena)} · usdc {shortAddr(dep.usdc)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {network === "local" && dep?.arena && (
            <>
              <span className="label mr-1">Demo clock</span>
              {[
                ["+1h", 3600],
                ["+1d", 86400],
                ["+3d", 3 * 86400],
              ].map(([l, s]) => (
                <button key={l} disabled={busy} className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => skip(s as number)}>
                  {l}
                </button>
              ))}
            </>
          )}
          <a href="/llms.txt" className="btn-quiet btn text-xs">
            llms.txt
          </a>
          <a href="/arena.json" className="btn-quiet btn text-xs">
            arena.json
          </a>
        </div>
      </div>
    </footer>
  );
}
