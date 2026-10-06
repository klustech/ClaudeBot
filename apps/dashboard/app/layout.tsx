import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = { title: "AI Trading Mission Control", description: "Claude AI trading research platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 overflow-x-auto p-5">{children}</main>
        </div>
      </body>
    </html>
  );
}
