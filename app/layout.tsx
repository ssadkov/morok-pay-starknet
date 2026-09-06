import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";

import { Providers } from "@/components/providers";
import { NETWORK_COOKIE, parseAppNetwork } from "@/lib/network";
import "./globals.css";

const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

const jetBrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-variable.woff2",
  weight: "100 800",
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MorokPay — private USDC on Starknet",
  description:
    "Send private USDC to any Ethereum wallet. The recipient collects with MetaMask alone - no Starknet wallet, no STRK, no gas.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  /* The visitor's network choice, read where the first paint happens. Without
     it the server always rendered the default and the client corrected it a
     frame later, so every network-dependent line flipped after load. */
  let initialNetwork;
  try {
    initialNetwork = parseAppNetwork(
      (await cookies()).get(NETWORK_COOKIE)?.value ?? null,
    );
  } catch {
    initialNetwork = undefined;
  }

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers initialNetwork={initialNetwork}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
