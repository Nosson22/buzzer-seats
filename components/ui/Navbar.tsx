"use client";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";

export function Navbar() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-4 flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/">
          <Image src="/logo.png" alt="Buzzer Seats" height={48} width={240} priority />
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <Link href="/how-it-works" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">
            How It Works
          </Link>
          {session && (
            <Link href="/sell" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">
              Sell Tickets
            </Link>
          )}
          {session?.user?.role === "ADMIN" && (
            <Link href="/admin" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">
              Admin
            </Link>
          )}
          {session ? (
            <>
              <Link href="/dashboard" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">
                Dashboard
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-300 hover:text-white transition-colors text-sm font-medium">
                Sign In
              </Link>
              <Link
                href="/register"
                className="text-sm font-medium px-4 py-2 rounded-lg text-white transition-colors"
                style={{ backgroundColor: "var(--marlins-blue)" }}
              >
                Get Started
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden p-2" onClick={() => setOpen(!open)}>
          <div className="w-6 h-0.5 bg-white mb-1" />
          <div className="w-6 h-0.5 bg-white mb-1" />
          <div className="w-6 h-0.5 bg-white" />
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-gray-900 border-t border-gray-800 px-4 py-4 flex flex-col gap-4">
          <Link href="/games" className="text-gray-300 hover:text-white text-sm font-medium" onClick={() => setOpen(false)}>
            How It Works
          </Link>
          {session && (
            <Link href="/sell" className="text-gray-300 hover:text-white text-sm font-medium" onClick={() => setOpen(false)}>
              Sell Tickets
            </Link>
          )}
          {session ? (
            <>
              <Link href="/dashboard" className="text-gray-300 hover:text-white text-sm font-medium" onClick={() => setOpen(false)}>
                Dashboard
              </Link>
              <button onClick={() => signOut({ callbackUrl: "/" })} className="text-left text-gray-300 hover:text-white text-sm font-medium">
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-300 hover:text-white text-sm font-medium" onClick={() => setOpen(false)}>
                Sign In
              </Link>
              <Link href="/register" className="text-sm font-medium text-white px-4 py-2 rounded-lg w-fit" style={{ backgroundColor: "var(--marlins-blue)" }} onClick={() => setOpen(false)}>
                Get Started
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
