import { Fragment, useState } from "react";

const KEYWORDS = /^(const|let|await|async|for|of|if|else|return|import|from|export|function|new|true|false|null|type)$/;

/** A tiny highlighter, enough for TypeScript and JSON samples. No library. */
function tokens(src: string) {
  const out: { t: string; c?: string }[] = [];
  // comments | strings | a name followed by "(" | other names | anything else
  const re = new RegExp(
    [String.raw`(\/\/[^\n]*)`, String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`, String.raw`([A-Za-z_$][\w$]*)(?=\s*\()`, String.raw`([A-Za-z_$][\w$]*)`, String.raw`(\s+|.)`].join("|"),
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) out.push({ t: m[1], c: "c" });
    else if (m[2]) out.push({ t: m[2], c: "s" });
    else if (m[3]) out.push({ t: m[3], c: KEYWORDS.test(m[3]) ? "k" : "f" });
    else if (m[4]) out.push({ t: m[4], c: KEYWORDS.test(m[4]) ? "k" : undefined });
    else out.push({ t: m[5] });
  }
  return out;
}

export function Code({ src, title, className = "" }: { src: string; title?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className={`min-w-0 overflow-hidden rounded-[20px] border border-bone/[0.09] bg-[#0e0d0c] shadow-[0_40px_80px_-40px_rgba(0,0,0,.9)] ${className}`}>
      <figcaption className="flex items-center justify-between gap-4 border-b border-bone/[0.07] px-5 py-3">
        <span className="flex items-center gap-3">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2 rounded-full bg-bone/15" />
            <span className="size-2 rounded-full bg-bone/15" />
            <span className="size-2 rounded-full bg-bone/15" />
          </span>
          {title && <span className="label text-bone-3">{title}</span>}
        </span>
        <button
          type="button"
          className="label text-bone-3 transition-colors hover:text-bone"
          onClick={() => {
            navigator.clipboard?.writeText(src).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="codeblock scroll-thin" data-lenis-prevent>
        {tokens(src).map((x, i) => (x.c ? <span key={i} className={x.c}>{x.t}</span> : <Fragment key={i}>{x.t}</Fragment>))}
      </pre>
    </figure>
  );
}
