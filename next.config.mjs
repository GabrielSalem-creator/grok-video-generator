import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Parent-folder lockfiles (e.g. ~/package-lock.json) can make Turbopack pick the wrong root.
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
