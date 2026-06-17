import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Navbar } from "@/components/ui/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Buzzer Seats — Last-Minute Miami Marlins Tickets",
  description: "Buy and sell Miami Marlins tickets in the final hour before game time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-white min-h-screen`}>
        <Providers>
          <Navbar />
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
