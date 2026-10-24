import { lazy, Suspense } from "react";
import { Route, Routes, Link } from "react-router-dom";
import { Loading, Shell } from "./components/Shell";
import { Hall } from "./pages/Hall";
import { Forum } from "./pages/Forum";

const CommissionPage = lazy(() => import("./pages/Commission"));
const CommissionWork = lazy(() => import("./pages/CommissionWork"));
const MakerPage = lazy(() => import("./pages/Maker"));
const Contest = lazy(() => import("./pages/Contest"));
const Workshop = lazy(() => import("./pages/Workshop"));

export function App() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Hall />} />
          <Route path="/forum" element={<Forum />} />
          <Route path="/c/:id" element={<CommissionPage />} />
          <Route path="/commission" element={<CommissionWork />} />
          <Route path="/maker/:address" element={<MakerPage />} />
          <Route path="/contest" element={<Contest />} />
          <Route path="/workshop" element={<Workshop />} />
          <Route path="*" element={<Lost />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

function Lost() {
  return (
    <div className="relative grid min-h-[90vh] place-content-center gap-6 overflow-hidden px-5 text-center">
      <img src="/img/vitruvian-ink.png" alt="" aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.12]" />
      <div className="label relative text-bone-3">Error 404</div>
      <p className="display relative text-[clamp(3rem,8vw,7rem)] leading-[0.9]">
        This room
        <br />
        <em>is empty</em>
      </p>
      <Link to="/" className="btn btn-ghost relative mx-auto">
        Back to the entrance
      </Link>
    </div>
  );
}
