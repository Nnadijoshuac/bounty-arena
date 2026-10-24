import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

/**
 * The deploy scripts write deployments/*.json, arena.json and llms.txt into web/public.
 * Arena serves them straight from there, read fresh on every request, so a new
 * `npm run demo` is picked up without restarting this server. A static build copies them in.
 */
const WEB_PUBLIC = path.resolve(__dirname, "../web/public");
const SHARED_FILES = /^\/(deployments\/(local|arcTestnet|arcMainnet)\.json|arena\.json|llms\.txt)$/;

const sharedFiles: Connect.NextHandleFunction = (req, res, next) => {
  const url = (req.url ?? "").split("?")[0];
  if (!SHARED_FILES.test(url)) return next();
  const file = path.join(WEB_PUBLIC, url);
  if (!fs.existsSync(file)) return next();
  res.setHeader("content-type", url.endsWith(".txt") ? "text/plain; charset=utf-8" : "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(fs.readFileSync(file));
};

function arenaFiles(): Plugin {
  return {
    name: "arena-shared-files",
    configureServer: (server) => void server.middlewares.use(sharedFiles),
    configurePreviewServer: (server) => void server.middlewares.use(sharedFiles),
    generateBundle() {
      for (const name of ["deployments/local.json", "deployments/arcTestnet.json", "deployments/arcMainnet.json", "arena.json", "llms.txt"]) {
        const file = path.join(WEB_PUBLIC, name);
        if (fs.existsSync(file)) this.emitFile({ type: "asset", fileName: name, source: fs.readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), arenaFiles()],
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "../shared/src") },
    // shared/ has its own node_modules. One copy of viem for the whole app.
    dedupe: ["viem"],
  },
  server: {
    port: 5310,
    strictPort: true,
    fs: { allow: [".."] },
    // the demo's HTTP view of the text store, a fallback for the onchain one
    proxy: { "/api/store": { target: "http://localhost:5303", changeOrigin: true } },
  },
  preview: { port: 5310, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
});
