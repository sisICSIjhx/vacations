import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // La raíz del repositorio tiene su propio package-lock.json (OpenSpec y
  // CodeGraph); sin esto Turbopack la toma como raíz y no resuelve tailwindcss.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
