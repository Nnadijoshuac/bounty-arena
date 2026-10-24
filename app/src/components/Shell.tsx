import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useConnect, useDisconnect } from "wagmi";
import type { Address } from "viem";
import { DEMO_ROLES, NETWORKS, onPaid, useArena, useArenaData, useBalances, usePaidWatcher, type NetworkKey } from "../lib/arena";
import { roman, shortAddr, usdc } from "../lib/format";
import { useActions } from "../lib/actions";
import { EASE, Magnetic, SmoothScroll, useLenis } from "./motion";
import { KindGlyph, Loader, TxButton } from "./ui";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <SmoothScroll>
      <Frame>{children}</Frame>
    </SmoothScroll>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const lenis = useLenis();
  useEffect(() => {
    if (lenis) lenis.scrollTo(0, { immediate: true });
    else window.scrollTo(0, 0);
  }, [pathname, lenis]);
  usePaidWatcher();
  return (
    <div className="relative flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-full focus:bg-bone focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <motion.div key={pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, ease: EASE }}>
          {children}
        </motion.div>
      </main>
      <Footer />
      <Toasts />
      <div className="grain" aria-hidden />
    </div>
  );
}

/** Page container: the same gutters everywhere. */
export function Wrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1520px] px-5 sm:px-8 lg:px-14 ${className}`}>{children}</div>;
}

const NAV = [
  { to: "/forum", label: "Commissions" },
  { to: "/contest", label: "The Contest" },
  { to: "/workshop", label: "For agents" },
];

function Wordmark() {
  return (
    <Link to="/" className="group flex items-baseline gap-2.5" aria-label="Arena, home">
      <span className="display text-[28px] leading-none tracking-[-0.03em] text-bone">Arena</span>
      <span className="label hidden text-[10px] text-bone-3 transition-colors group-hover:text-bone-2 xl:inline">Built on Arc</span>
    </Link>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const lenis = useLenis();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!lenis) return;
    if (open) lenis.stop();
    else lenis.start();
  }, [open, lenis]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-500 ${
          scrolled && !open ? "border-b border-bone/[0.07] bg-ink/70 backdrop-blur-xl" : "border-b border-transparent"
        }`}
      >
        <div className="mx-auto flex h-[72px] max-w-[1520px] items-center gap-8 px-5 sm:px-8 lg:px-14">
          <Wordmark />
          <nav className="hidden items-center gap-8 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `relative text-[14px] transition-colors ${isActive ? "text-bone" : "text-bone-3 hover:text-bone"}`}>
                {({ isActive }) => (
                  <>
                    {n.label}
                    {isActive && <motion.span layoutId="nav-dot" className="absolute -bottom-2 left-1/2 size-1 -translate-x-1/2 rounded-full bg-ember" />}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden sm:inline-flex">
              <Magnetic>
                <Link to="/commission" className="btn btn-sm btn-solid">
                  Commission a work
                </Link>
              </Magnetic>
            </span>
            <Wallet />
            <button
              type="button"
              className="grid size-[38px] place-items-center rounded-full text-bone shadow-[inset_0_0_0_1px_rgba(237,230,216,0.22)] lg:hidden"
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="relative block h-[9px] w-4" aria-hidden>
                <span className={`absolute left-0 h-px w-4 bg-current transition-transform duration-500 ${open ? "top-1 rotate-45" : "top-0"}`} />
                <span className={`absolute left-0 h-px w-4 bg-current transition-transform duration-500 ${open ? "top-1 -rotate-45" : "top-2"}`} />
              </span>
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 flex flex-col bg-ink px-5 pb-10 pt-28 sm:px-8 lg:hidden"
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            <img src="/img/vitruvian-ink.png" alt="" aria-hidden className="pointer-events-none absolute -right-24 bottom-0 w-[110%] max-w-none opacity-[0.07]" />
            <nav aria-label="Main" className="relative">
              <ul className="grid gap-1">
                {[{ to: "/", label: "Home" }, ...NAV, { to: "/commission", label: "Commission a work" }].map((n, i) => (
                  <li key={n.to} className="overflow-hidden">
                    <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ duration: 0.9, ease: EASE, delay: 0.15 + i * 0.06 }}>
                      <NavLink to={n.to} end className={({ isActive }) => `flex items-baseline gap-4 py-1.5 ${isActive ? "text-bone" : "text-bone-2"}`}>
                        <span className="label w-6 text-bone-4">{String(i + 1).padStart(2, "0")}</span>
                        <span className="display text-[2.9rem] leading-[1.05]">{n.label}</span>
                      </NavLink>
                    </motion.div>
                  </li>
                ))}
              </ul>
            </nav>
            <p className="label relative mt-auto text-bone-3">A testnet prototype, built on Arc</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** The wallet chip and its drawer: network, demo personas, balance and withdrawals. */
function Wallet() {
  const { account, walletKind, network } = useArena();
  const { data } = useArenaData();
  const { data: bal } = useBalances(account);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const me = account ? data?.byAddress.get(account.toLowerCase()) : undefined;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-[38px] items-center gap-2.5 rounded-full px-3.5 text-[13.5px] text-bone shadow-[inset_0_0_0_1px_rgba(237,230,216,0.22)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(237,230,216,0.5)]"
      >
        <span className={`inline-block size-1.5 rounded-full ${network === "local" ? "bg-bone-2" : network === "arcMainnet" ? "bg-ember" : "bg-pass"}`} aria-hidden />
        {account ? (
          <>
            {me?.registered && <KindGlyph agent={me.isAgent} />}
            <span className="max-w-[7.5rem] truncate">{me?.handle || shortAddr(account)}</span>
            {bal && <span className="num hidden text-[12.5px] text-bone-3 md:inline">{usdc(bal.wallet)}</span>}
            {bal && bal.claimable > 0n && <span className="pulse-dot relative inline-block size-1.5 rounded-full bg-lapis text-lapis" title="You have USDC to withdraw" />}
          </>
        ) : (
          <span>{walletKind === null ? "Connect" : "Wallet"}</span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="card absolute right-0 top-[50px] z-50 w-[min(calc(100vw-2.5rem),380px)] origin-top-right bg-ink-2/95 p-5 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <WalletDrawer onDone={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function WalletDrawer({ onDone }: { onDone: () => void }) {
  const { network, setNetwork, account, walletKind, demoAccounts, selectDemo, mintTestUsdc, dep } = useArena();
  const act = useActions();
  const { data } = useArenaData();
  const { data: bal } = useBalances(account);
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  return (
    <div className="grid gap-6">
      <div>
        <div className="label mb-3 text-bone-3">Network</div>
        <div className="grid grid-cols-3 gap-1 rounded-full bg-bone/5 p-1">
          {(Object.keys(NETWORKS) as NetworkKey[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNetwork(n)}
              className={`h-8 rounded-full text-[12.5px] transition-colors ${network === n ? "bg-bone text-ink" : "text-bone-2 hover:text-bone"}`}
            >
              {NETWORKS[n].label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[12.5px] leading-snug text-bone-3">
          {network === "arcMainnet" ? "Real USDC on Arc mainnet. Your wallet signs everything and Arena never sees a key." : "Test networks use free test USDC. Arena never asks for a key."}
        </p>
      </div>

      {account && bal && (
        <div className="grid grid-cols-2 gap-4 border-y border-bone/8 py-5">
          <div>
            <div className="display text-[2rem] leading-none">{usdc(bal.wallet)}</div>
            <div className="label mt-2 text-bone-3">USDC in wallet</div>
          </div>
          <div>
            <div className={`display text-[2rem] leading-none ${bal.claimable > 0n ? "text-lapis" : "text-bone-3"}`}>{usdc(bal.claimable)}</div>
            <div className="label mt-2 text-bone-3">Ready to withdraw</div>
          </div>
          <div className="col-span-2 flex flex-wrap gap-2">
            {bal.claimable > 0n && (
              <TxButton className="btn-sm btn-lapis" onRun={() => act.withdraw()} done="Sent">
                Withdraw
              </TxButton>
            )}
            {network === "local" && (
              <TxButton className="btn-sm btn-quiet" onRun={mintTestUsdc} done="Minted">
                Mint 1,000 test USDC
              </TxButton>
            )}
            <Link to={`/maker/${account}`} onClick={onDone} className="btn btn-sm btn-quiet">
              My page
            </Link>
          </div>
        </div>
      )}

      {network === "local" ? (
        <div>
          <div className="label mb-2 text-bone-3">Act as a demo persona</div>
          {!dep && <p className="text-[13px] text-bone-3">Waiting for the local chain.</p>}
          <ul data-lenis-prevent className="scroll-thin -mx-2 grid max-h-[42vh] overflow-y-auto">
            {demoAccounts.map((a: Address, i) => {
              const h = data?.byAddress.get(a.toLowerCase());
              const active = account?.toLowerCase() === a.toLowerCase();
              return (
                <li key={a}>
                  <button
                    type="button"
                    onClick={() => {
                      selectDemo(a);
                      onDone();
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-[14px] transition-colors ${active ? "bg-bone/10 text-bone" : "text-bone-2 hover:bg-bone/5 hover:text-bone"}`}
                  >
                    <span className="num w-5 text-[11px] text-bone-4">{i}</span>
                    {h?.registered ? <KindGlyph agent={h.isAgent} /> : <span className="inline-block size-[7px] rounded-full border border-bone/25" />}
                    <span className="flex-1 truncate">{h?.handle || shortAddr(a)}</span>
                    <span className="label text-[10px] text-bone-4">{DEMO_ROLES[i] ?? ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {walletKind === "demo" && (
            <button type="button" className="mt-3 text-[13px] text-bone-3 hover:text-bone" onClick={() => selectDemo(null)}>
              Leave persona
            </button>
          )}
        </div>
      ) : (
        <div>
          <div className="label mb-3 text-bone-3">Browser wallet</div>
          {walletKind === "injected" ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => disconnect()}>
              Disconnect {shortAddr(account)}
            </button>
          ) : connectors.length ? (
            <div className="grid gap-2">
              {connectors.map((c) => (
                <button key={c.uid} type="button" className="btn btn-sm btn-solid" onClick={() => connect({ connector: c })}>
                  Connect {c.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-bone-3">No browser wallet found.</p>
          )}
          <p className="mt-3 text-[12.5px] text-bone-3">
            Testnet USDC comes from{" "}
            <a className="text-bone underline decoration-bone/30 underline-offset-4 hover:decoration-bone" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
              faucet.circle.com
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

function Footer() {
  const { network, skipTime, dep, depError, setNetwork } = useArena();
  return (
    <footer className="relative overflow-hidden border-t border-bone/[0.07]">
      {depError && (
        <div className="border-b border-bone/[0.07]">
          <Wrap className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 text-[13.5px]">
            <span className="label text-ember">No signal</span>
            <span className="text-bone-2">{depError}</span>
            {network === "arcTestnet" && (
              <button type="button" className="link-line ml-auto text-bone" onClick={() => setNetwork("local")}>
                Switch to the local demo
              </button>
            )}
          </Wrap>
        </div>
      )}
      <Wrap className="grid gap-12 pb-10 pt-20 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <p className="display max-w-[16ch] text-[clamp(1.9rem,2.6vw,2.6rem)] leading-[1.05] text-bone">Work, commissioned in USDC. Made by people and machines.</p>
          <p className="mt-6 max-w-[52ch] text-[13.5px] leading-relaxed text-bone-3 copy">
            Arena is a testnet prototype built on Arc Network, Circle's blockchain for stablecoin finance. Never use a key that holds real funds. The paintings are
            public-domain works by Michelangelo, Leonardo da Vinci and Raphael.
          </p>
        </div>
        <div className="grid content-start gap-3 text-[14px]">
          <div className="label mb-1 text-bone-4">Arena</div>
          <Link className="link-line justify-self-start text-bone-2 hover:text-bone" to="/forum">
            Commissions
          </Link>
          <Link className="link-line justify-self-start text-bone-2 hover:text-bone" to="/contest">
            The Contest
          </Link>
          <Link className="link-line justify-self-start text-bone-2 hover:text-bone" to="/commission">
            Commission a work
          </Link>
        </div>
        <div className="grid content-start gap-3 text-[14px]">
          <div className="label mb-1 text-bone-4">For agents</div>
          <Link className="link-line justify-self-start text-bone-2 hover:text-bone" to="/workshop">
            The Workshop
          </Link>
          <a className="link-line justify-self-start text-bone-2 hover:text-bone" href="/llms.txt">
            llms.txt
          </a>
          <a className="link-line justify-self-start text-bone-2 hover:text-bone" href="/arena.json">
            arena.json
          </a>
          {network === "local" && dep && (
            <div className="mt-4">
              <div className="label mb-2 text-bone-4">Demo clock</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ["+1h", 3600],
                  ["+1d", 86400],
                  ["+3d", 3 * 86400],
                ].map(([label, s]) => (
                  <TxButton key={label} className="btn-sm btn-quiet" done="Moved" onRun={() => skipTime(s as number)}>
                    {label}
                  </TxButton>
                ))}
              </div>
            </div>
          )}
        </div>
      </Wrap>
      <div aria-hidden className="pointer-events-none select-none">
        <div className="display -mb-[0.2em] text-center text-[27vw] leading-[0.86] tracking-[-0.045em] text-transparent [-webkit-text-stroke:1px_rgba(237,230,216,0.13)]">Arena</div>
      </div>
    </footer>
  );
}

type Toast = { id: number; title: string; body: string; agent: boolean };

/** A paid commission announces itself in the corner. */
function Toasts() {
  const { data } = useArenaData();
  const [items, setItems] = useState<Toast[]>([]);
  const names = useRef(data?.byAddress);
  names.current = data?.byAddress;
  useEffect(
    () =>
      onPaid(({ bounty }) => {
        const w = bounty.winners[0];
        const who = w ? names.current?.get(w.hunter.toLowerCase())?.handle || shortAddr(w.hunter) : null;
        const t: Toast = {
          id: Date.now() + bounty.id,
          title: `Commission ${roman(bounty.id + 1)} is paid`,
          body:
            bounty.status === "ghost-paid"
              ? `${usdc(bounty.reward)} USDC shared among the makers`
              : `${who ?? "The maker"} takes ${usdc(w?.payout ?? bounty.reward)} USDC${bounty.autoPaidIn != null ? `, ${bounty.autoPaidIn}s after entry` : ""}`,
          agent: !!w?.isAgent,
        };
        setItems((s) => [...s, t].slice(-3));
        setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 7000);
      }),
    [],
  );
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[75] grid w-[min(calc(100vw-2.5rem),360px)] gap-2" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="card paid-sweep bg-ink-2/95 p-4 backdrop-blur-xl"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <div className="flex items-center gap-2.5">
              <KindGlyph agent={t.agent} />
              <span className="label text-bone">{t.title}</span>
            </div>
            <div className="mt-1.5 text-[14px] text-bone-2">{t.body}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Full-page waiting state. */
export function Loading({ label }: { label?: string }) {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <Loader label={label} />
    </div>
  );
}
