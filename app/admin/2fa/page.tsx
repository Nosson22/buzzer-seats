"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function Setup2FAPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/");
    if (status === "unauthenticated") router.push("/login");
  }, [status, session]);

  useEffect(() => {
    if (session?.user?.role !== "ADMIN") return;
    fetch("/api/admin/2fa/setup")
      .then((r) => r.json())
      .then((d) => { setQrCode(d.qrCode); setSecret(d.secret); });
  }, [session]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const res = await fetch("/api/admin/2fa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage({ type: "success", text: "2FA is set up! Google Authenticator is now required at login." });
    } else {
      setMessage({ type: "error", text: data.error });
    }
    setLoading(false);
  };

  return (
    <div className="max-w-md mx-auto py-12">
      <h1 className="text-3xl font-black text-white mb-2">Set Up 2FA</h1>
      <p className="text-gray-400 mb-8">Scan the QR code with Google Authenticator, then enter the 6-digit code to confirm.</p>

      {message && (
        <div className={`mb-6 p-4 rounded-xl text-sm ${message.type === "error" ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-green-900/30 text-green-400 border border-green-800"}`}>
          {message.text}
        </div>
      )}

      {qrCode && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6 text-center">
          <p className="text-sm text-gray-400 mb-4">Scan with Google Authenticator</p>
          <img src={qrCode} alt="QR Code" className="mx-auto rounded-xl" />
          {secret && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 mb-1">Or enter this code manually:</p>
              <code className="text-xs font-mono text-gray-300 bg-gray-800 px-3 py-1 rounded">{secret}</code>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleVerify} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
        <Input
          id="code"
          label="6-digit code from Google Authenticator"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <Button type="submit" loading={loading} className="w-full">Confirm & Enable 2FA</Button>
      </form>
    </div>
  );
}
