import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "ICSI Vacaciones | Administración",
  description: "Panel administrativo para coordinar las vacaciones y disponibilidad del personal de ICSI.",
  openGraph: {
    title: "ICSI Vacaciones | Administración",
    description: "Vacaciones, disponibilidad y coincidencias del equipo en un solo calendario.",
    type: "website",
    locale: "es_MX",
    images: [{ url: "/og-icsi-vacaciones.png", width: 1736, height: 909, alt: "Calendario anual de vacaciones ICSI" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ICSI Vacaciones | Administración",
    description: "Vacaciones, disponibilidad y coincidencias del equipo en un solo calendario.",
    images: ["/og-icsi-vacaciones.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
