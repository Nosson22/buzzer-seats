"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState({ email: "", password: "" });
  const [totpCode, setTotpCode] = useState("");
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (step === "credentials") {
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password.");
        setLoading(false);
        return;
      }

      // Check if this account has 2FA enabled
      const check = await fetch("/api/admin/2fa/check").then((r) => r.json());
      if (check.requires2FA) {
        setStep("totp");
        setLoading(false);
        return;
      }

      router.push(searchParams.get("callbackUrl") || "/games");
    } else {
      // Verify TOTP code
      const res = await fetch("/api/admin/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode }),
      });
      if (!res.ok) {
        setError("Invalid code. Try again.");
        setLoading(false);
        return;
      }
      router.push(searchParams.get("callbackUrl") || "/admin");
    }

    setLoading(false);
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white">Sign In</h1>
          <p className="text-gray-400 mt-2">Access your Buzzer Seats account</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-900/30 text-red-400 border border-red-800 text-sm">{error}</div>
          )}

          {step === "credentials" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input id="email" label="Email" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
              <Input id="password" label="Password" type="password" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="current-password" />
              <Button type="submit" loading={loading} className="w-full" size="lg">Sign In</Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-4">
                <div className="text-3xl mb-2">🔐</div>
                <p className="text-white font-semibold">Two-Factor Authentication</p>
                <p className="text-sm text-gray-400 mt-1">Enter the 6-digit code from Google Authenticator</p>
              </div>
              <Input
                id="totp"
                label="Authentication Code"
                placeholder="123456"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
                autoComplete="one-time-code"
              />
              <Button type="submit" loading={loading} className="w-full" size="lg">Verify</Button>
              <button type="button" onClick={() => setStep("credentials")} className="w-full text-sm text-gray-500 hover:text-gray-300 mt-2">
                ← Back
              </button>
            </form>
          )}

          {step === "credentials" && (
            <p className="text-center text-sm text-gray-500 mt-6">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="font-medium" style={{ color: "var(--marlins-blue)" }}>
                Create one
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
