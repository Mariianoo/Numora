import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { GoogleTagManager } from "@/components/analytics/GoogleTagManager";
import { AttributionCapture } from "@/components/analytics/AttributionCapture";
import { ConsentBanner } from "@/components/analytics/ConsentBanner";
import { Footer } from "@/components/layout/Footer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Numora — Sua coleção. Sua história.",
  description: "Gestão profissional de coleções numismáticas.",
};

// Identidade visual Numora (favicon/apple-icon vêm da convenção de arquivo
// `app/icon.svg`/`app/apple-icon.png` — Next.js os detecta sozinho, sem
// precisar declarar `metadata.icons` aqui). `themeColor` mora num export
// `viewport` separado (não em `metadata`) desde que o Next.js 14 dividiu
// os dois — colocá-lo em `metadata` gera aviso de build nesta versão.
export const viewport: Viewport = {
  themeColor: "#0B1F3B",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-text-primary">
        <GoogleTagManager />
        <AttributionCapture />
        {children}
        <Footer />
        <ConsentBanner />
      </body>
    </html>
  );
}
