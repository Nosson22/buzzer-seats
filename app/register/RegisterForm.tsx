"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultRole = searchParams.get("role") === "SELLER" ? "SELLER" : "BUYER";

  const [form, setForm] = useState({ name: "", email: "", password: "", role: defaultRole, phone: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");

      await signIn("credentials", { email: form.email, password: form.password, redirect: false });
      router.push("/games");
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white">Create Account</h1>
          <p className="text-gray-400 mt-2">Join the Buzzer Seats marketplace</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-900/30 text-red-400 border border-red-800 text-sm">{error}</div>
          )}

          <div className="flex gap-2 mb-6">
            {(["BUYER", "SELLER"] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setForm({ ...form, role })}
                className={`flex-1 py-3 rounded-lg text-sm font-semibold border transition-all ${
                  form.role === role
                    ? "border-[var(--marlins-blue)] text-[var(--marlins-blue)] bg-blue-900/20"
                    : "border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {role === "BUYER" ? "🎟 Buyer" : "💼 Seller"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input id="name" label="Full Name" placeholder="Jane Smith" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
            <Input id="email" label="Email" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Input id="password" label="Password" type="password" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            {form.role === "SELLER" && (
              <Input id="phone" label="Phone (optional)" type="tel" placeholder="+1 (305) 555-0100" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            )}
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Create Account
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{" "}
            <Link href="/login" className="font-medium" style={{ color: "var(--marlins-blue)" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
