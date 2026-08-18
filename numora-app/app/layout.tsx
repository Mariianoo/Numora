import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { GoogleTagManager } from "@/components/analytics/GoogleTagManager";
import { AttributionCapture } from "@/components/analytics/AttributionCapture";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Numora — Sua coleção. Sua história.",
  description: "Gestão profissional de coleções numismáticas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-text-primary">
        <GoogleTagManager />
        <AttributionCapture />
        {children}
      </body>
    </html>
  );
}
