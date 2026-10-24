import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useInView, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import Lenis from "lenis";
import { useReducedMotion } from "../lib/motion";

/**
 * Arena's motion. Everything eases out slowly, like a curtain, and nothing moves for
 * visitors who asked for less motion.
 */

export const EASE = [0.22, 1, 0.36, 1] as const;

// ------------------------------------------------------------------ smooth scroll

const LenisCtx = createContext<Lenis | null>(null);
export const useLenis = () => useContext(LenisCtx);

export function SmoothScroll({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [lenis, setLenis] = useState<Lenis | null>(null);
  useEffect(() => {
    if (reduced) return;
    const l = new Lenis({ lerp: 0.1, wheelMultiplier: 0.95 });
    setLenis(l);
    let raf = 0;
    const loop = (t: number) => {
      l.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      l.destroy();
      setLenis(null);
    };
  }, [reduced]);
  return <LenisCtx.Provider value={lenis}>{children}</LenisCtx.Provider>;
}

// ------------------------------------------------------------------ reveals

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, className = "", delay = 0, y = 28, as = "div" }: { children: ReactNode; className?: string; delay?: number; y?: number; as?: "div" | "li" | "section" | "p" }) {
  const reduced = useReducedMotion();
  const M = motion[as];
  if (reduced) return <M className={className}>{children}</M>;
  return (
    <M
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 1.1, ease: EASE, delay }}
    >
      {children}
    </M>
  );
}

/**
 * A headline that rises line by line from behind a mask. Pass lines as an array so the
 * breaks are chosen, not left to the browser.
 */
export function Lines({ lines, className = "", delay = 0, stagger = 0.09, immediate = false }: { lines: ReactNode[]; className?: string; delay?: number; stagger?: number; immediate?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduced = useReducedMotion();
  const show = reduced || immediate || seen;
  return (
    <span ref={ref} className={`block ${className}`}>
      {lines.map((l, i) => (
        <span key={i} className="block overflow-hidden pb-[0.22em] -mb-[0.22em] pt-[0.18em] -mt-[0.18em]">
          <motion.span
            className="block will-change-transform"
            initial={reduced ? false : { y: "105%" }}
            animate={show ? { y: "0%" } : undefined}
            transition={{ duration: 1.25, ease: EASE, delay: delay + i * stagger }}
          >
            {l}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** A paragraph whose words light up one after another as it is scrolled through. */
export function ScrollWords({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const words = text.split(" ");
  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => (
        <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]} still={reduced}>
          {w}
        </Word>
      ))}
    </p>
  );
}

function Word({ children, progress, range, still }: { children: string; progress: MotionValue<number>; range: [number, number]; still: boolean }) {
  const opacity = useTransform(progress, range, [0.14, 1]);
  return (
    <motion.span style={still ? undefined : { opacity }} className="inline">
      {children}{" "}
    </motion.span>
  );
}

// ------------------------------------------------------------------ depth

/** Moves its child against the scroll, for layered depth. speed 0.2 means 20% of the scroll. */
export function Parallax({ children, speed = 0.15, className = "" }: { children: ReactNode; speed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [`${-speed * 100}%`, `${speed * 100}%`]);
  return (
    <motion.div ref={ref} style={reduced ? undefined : { y }} className={className}>
      {children}
    </motion.div>
  );
}

/** A pointer position for the element, eased, as fractions from -0.5 to 0.5. */
export function usePointer(el: React.RefObject<HTMLElement | null>) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 60, damping: 20, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 60, damping: 20, mass: 0.6 });
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const move = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      x.set((e.clientX - r.left) / r.width - 0.5);
      y.set((e.clientY - r.top) / r.height - 0.5);
    };
    node.addEventListener("pointermove", move);
    return () => node.removeEventListener("pointermove", move);
  }, [el, x, y]);
  return { x: sx, y: sy };
}

/** Pulls toward the pointer while it hovers, then settles back. */
export function Magnetic({ children, strength = 0.3, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const x = useSpring(0, { stiffness: 220, damping: 18 });
  const y = useSpring(0, { stiffness: 220, damping: 18 });
  if (reduced) return <span className={`inline-flex ${className}`}>{children}</span>;
  return (
    <motion.span
      ref={ref}
      className={`inline-flex ${className}`}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = ref.current!.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * strength);
        y.set((e.clientY - r.top - r.height / 2) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}

/** Counts up to a number the first time it is seen. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-US"), className = "" }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced || !seen) {
      if (reduced) setN(value);
      return;
    }
    let raf = 0;
    const from = n;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1600);
      const e = 1 - Math.pow(1 - k, 4);
      setN(from + (value - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, seen, reduced]);
  return (
    <span ref={ref} className={className}>
      {format(n)}
    </span>
  );
}
