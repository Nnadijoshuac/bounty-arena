import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { onPaid } from "../lib/arena";
import { useReducedMotion } from "../lib/motion";
import { EASE, Lines } from "./motion";

// the hands plate, from art/web.mjs: 2400 x 530
const RATIO = 530 / 2400;
// the gap between the fingertips, as fractions of the plate
const GAP = { x: 0.501, y: 0.5 };

/**
 * The Creation of Adam, in layers, back to front:
 *   the fresco band, dim, with a candle of light that follows the pointer
 *   the headline
 *   the two hands, cut out of the sky, reaching for each other over the words
 *   a point of light in the gap: the fee. It flares when a commission is paid.
 */
export function Hero({ headline, children }: { headline: ReactNode[]; children?: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  // the candle eases after the pointer, and drifts by itself on touch screens
  const cx = useMotionValue(50);
  const cy = useMotionValue(GAP.y * 100);
  const sx = useSpring(cx, { stiffness: 40, damping: 18 });
  const sy = useSpring(cy, { stiffness: 40, damping: 18 });
  const mask = useMotionTemplate`radial-gradient(circle clamp(220px, 26vw, 460px) at ${sx}% ${sy}%, #000 0%, rgba(0,0,0,.5) 45%, transparent 100%)`;

  // the hands lean with the pointer, a little more than the fresco behind them
  const tx = useSpring(0, { stiffness: 50, damping: 20 });
  const ty = useSpring(0, { stiffness: 50, damping: 20 });
  const handX = useTransform(tx, (v) => v * -18);
  const handY = useTransform(ty, (v) => v * -10);
  const backX = useTransform(tx, (v) => v * 8);
  const backY = useTransform(ty, (v) => v * 5);

  useEffect(() => {
    const el = section.current;
    if (!el || reduced) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (!fine) {
      // touch: the light wanders slowly across the gap
      let raf = 0;
      const t0 = performance.now();
      const loop = (t: number) => {
        const k = (t - t0) / 1000;
        cx.set(50 + Math.sin(k * 0.35) * 22);
        cy.set(GAP.y * 100 + Math.cos(k * 0.27) * 12);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }
    const stage = el.querySelector<HTMLElement>("[data-stage]");
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx.set((e.clientX - r.left) / r.width - 0.5);
      ty.set((e.clientY - r.top) / r.height - 0.5);
      if (stage) {
        const s = stage.getBoundingClientRect();
        cx.set(((e.clientX - s.left) / s.width) * 100);
        cy.set(((e.clientY - s.top) / s.height) * 100);
      }
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, [reduced, cx, cy, tx, ty]);

  // on scroll the words lift away faster than the hands, and the room darkens
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const handsY = useTransform(scrollYProgress, [0, 1], ["0%", "-12%"]);
  const dim = useTransform(scrollYProgress, [0, 0.9], [0, 0.85]);

  // the fee flares when a commission is paid anywhere in Arena
  const [flare, setFlare] = useState(0);
  useEffect(() => onPaid(() => setFlare((n) => n + 1)), []);

  const still = reduced ? undefined : true;
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "-60%"]);
  const plate = "relative left-1/2 w-[max(290vw,100%)] -translate-x-1/2 [container-type:inline-size] sm:w-[max(160vw,100%)] lg:w-[max(122vw,100%)]";
  const type = "display whitespace-nowrap text-center text-[min(5.6cqw,15rem)] leading-[0.9] tracking-[-0.036em] text-bone sm:text-[min(7.9cqw,15rem)] lg:text-[min(9.8cqw,15rem)]";
  const [first, second] = headline;

  return (
    <section ref={section} className="relative isolate h-[78svh] min-h-[560px] overflow-hidden bg-ink sm:h-[100svh] sm:min-h-[640px]" aria-label="Arena">
      <motion.div style={still && { y: handsY }} className="absolute inset-x-0 top-[44%] -translate-y-1/2 sm:top-[47%]">
        <div data-stage className={plate} style={{ aspectRatio: `${1 / RATIO}` }}>
          {/* I. the fresco, dim, with the candle */}
          <motion.div
            style={still && { x: backX, y: backY }}
            className="absolute inset-x-[8%] -inset-y-[70%] [mask-image:radial-gradient(closest-side,#000_30%,transparent_100%)]"
          >
            <motion.img
              src="/img/wall-1600.webp"
              sizes="150vw"
              alt=""
              aria-hidden
              className="absolute inset-0 size-full object-cover"
              style={{ filter: "brightness(.24) saturate(.6) contrast(1.05)" }}
              initial={reduced ? false : { opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 2.4, ease: EASE }}
            />
            {!reduced && (
              <motion.img
                src="/img/wall-1600.webp"
                sizes="150vw"
                alt=""
                aria-hidden
                className="absolute inset-0 size-full object-cover"
                style={{ filter: "brightness(.5) saturate(.8)", maskImage: mask, WebkitMaskImage: mask }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 2, delay: 1.2 }}
              />
            )}
          </motion.div>

          {/* II. the first line, behind the hands */}
          <motion.div style={still && { y: textY }} className="pointer-events-none absolute inset-x-0 bottom-[80%] z-10 sm:bottom-[76%]">
            <h1 className={type}>
              <Lines lines={[first]} immediate delay={0.5} />
              <span className="sr-only"> {typeof second === "string" ? second : "of hands"}</span>
            </h1>
          </motion.div>

          {/* III. the hands. Each half reaches in from its own side. */}
          <motion.div style={still && { x: handX, y: handY }} className="pointer-events-none absolute inset-0 z-20 [mask-image:linear-gradient(90deg,transparent,#000_7%,#000_93%,transparent)]">
            {(["left", "right"] as const).map((side) => (
              <motion.img
                key={side}
                src="/img/hands-2400.png"
                srcSet="/img/hands-1200.png 1200w, /img/hands-2400.png 2400w"
                sizes="150vw"
                alt={side === "left" ? "A human hand, painted like the fresco" : "An agent's hand in graphite, reaching back"}
                className="absolute inset-0 size-full"
                style={{
                  clipPath: side === "left" ? `inset(0 ${100 - GAP.x * 100}% 0 0)` : `inset(0 0 0 ${GAP.x * 100}%)`,
                  filter: "drop-shadow(0 30px 40px rgba(0,0,0,.7))",
                }}
                initial={reduced ? false : { x: side === "left" ? "-9%" : "9%", opacity: 0 }}
                animate={{ x: "0%", opacity: 1 }}
                transition={{ duration: 2.6, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
              />
            ))}
            {/* IV. the fee, a point of light in the gap */}
            <div className="absolute" style={{ left: `${GAP.x * 100}%`, top: `${GAP.y * 100 - 2}%` }}>
              <motion.span
                key={flare}
                className="absolute block size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#fff6e8]"
                style={{ boxShadow: "0 0 18px 6px rgba(255,236,200,.55), 0 0 60px 18px rgba(226,88,47,.25)" }}
                initial={reduced ? false : flare ? { scale: 5, opacity: 1 } : { scale: 0, opacity: 0 }}
                animate={reduced ? undefined : { scale: [1, 1.5, 1], opacity: [0.75, 1, 0.75] }}
                transition={flare ? { duration: 1.6, ease: EASE } : { duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 2.4 }}
              />
            </div>
          </motion.div>

          {/* V. the second line, in front of the hands, under the fingertips */}
          <motion.div style={still && { y: textY }} className="pointer-events-none absolute inset-x-0 top-[80%] z-30" aria-hidden>
            <div className={`${type} italic [text-shadow:0_10px_40px_rgba(11,10,9,.8)]`}>
              <Lines lines={[second]} immediate delay={0.62} />
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* the room darkens as you leave it */}
      <motion.div style={still && { opacity: dim }} className="pointer-events-none absolute inset-0 z-40 bg-ink opacity-0" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 h-32 bg-gradient-to-t from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-40 bg-gradient-to-b from-ink to-transparent" />

      <div className="absolute inset-x-0 bottom-0 z-50">{children}</div>
    </section>
  );
}
