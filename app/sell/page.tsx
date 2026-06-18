"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatDate } from "@/lib/utils";
import { CUSTODY_INBOUND_EMAIL } from "@/lib/team-config";

const TRIGGER_OPTIONS = [
  {
    value: "T_60",
    label: "T-60 (60 min before first pitch)",
    description: "Best for last-minute buyers planning ahead. Alert sent 90 min before game.",
  },
  {
    value: "T_30",
    label: "T-30 (30 min before first pitch)",
    description: "Ideal window — buyers are decided, traffic still light. Alert sent 60 min before.",
  },
  {
    value: "POST_START",
    label: "First Pitch (game starts)",
    description: "Maximum hold time. Captures buyers who wait until the last second. Alert sent 30 min before.",
  },
];

export default function SellPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({
    gameId: "",
    section: "",
    row: "",
    seatNumbers: "",
    quantity: "2",
    askingPrice: "",
    description: "",
    barcodeNumber: "",
    liveTriggerType: "T_60",
    mlbTransferLink: "",
  });

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login?callbackUrl=/sell");
  }, [status, session]);

  useEffect(() => {
    fetch("/api/games?upcoming=true")
      .then((r) => r.json())
      .then(setGames);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          quantity: parseInt(form.quantity),
          askingPrice: parseFloat(form.askingPrice),
          mlbTransferLink: form.mlbTransferLink || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create listing");
      setSuccess(true);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--marlins-blue)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="text-5xl mb-4">🎟️</div>
        <h1 className="text-2xl font-black text-white mb-3">Draft listing saved!</h1>
        <p className="text-gray-400 mb-6">
          Your ticket is still in your MLB Ballpark app — keep it, keep trying to sell elsewhere.
          We'll send you a high-priority alert 30 minutes before your listing goes live.
          When you get it, forward your ticket to:
        </p>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-6 font-mono text-lg font-bold text-[var(--marlins-blue)]">
          {CUSTODY_INBOUND_EMAIL}
        </div>
        <p className="text-sm text-gray-500 mb-8">
          The moment we receive it, your listing goes live to buyers instantly. If you sell elsewhere
          before then, ignore the alert.
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => { setSuccess(false); setForm({ gameId: "", section: "", row: "", seatNumbers: "", quantity: "2", askingPrice: "", description: "", barcodeNumber: "", liveTriggerType: "T_60", mlbTransferLink: "" }); }}>
            List Another Ticket
          </Button>
          <Button variant="ghost" onClick={() => router.push("/dashboard")}>
            View My Listings
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-white">Pre-List Your Ticket</h1>
        <p className="text-gray-400 mt-2">
          List now, keep your ticket. We notify you when it's time to transfer.
        </p>
      </div>

      {/* How it works banner */}
      <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-4 mb-6">
        <p className="text-sm font-semibold text-blue-300 mb-2">How Pre-Listed Drafts work</p>
        <ol className="text-sm text-blue-200 space-y-1 list-decimal list-inside">
          <li>Fill out this form — your ticket stays in your MLB Ballpark app.</li>
          <li>We alert you 30 min before your chosen activation time.</li>
          <li>Forward the ticket to <span className="font-mono font-bold">{CUSTODY_INBOUND_EMAIL}</span></li>
          <li>Listing goes <span className="font-semibold">LIVE</span> the instant we receive it.</li>
          <li>If unsold, we return your ticket automatically after the window closes.</li>
        </ol>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-xl text-sm ${message.type === "error" ? "bg-red-900/30 text-red-400 border border-red-800" : "bg-green-900/30 text-green-400 border border-green-800"}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Game selection */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-bold text-white mb-4">Select Game</h2>
          <div className="space-y-2">
            {games.length === 0 && <p className="text-gray-500 text-sm">No upcoming games available.</p>}
            {games.map((game) => (
              <label
                key={game.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  form.gameId === game.id
                    ? "border-[var(--marlins-blue)] bg-blue-900/20"
                    : "border-gray-700 hover:border-gray-600"
                }`}
              >
                <input
                  type="radio"
                  name="gameId"
                  value={game.id}
                  checked={form.gameId === game.id}
                  onChange={(e) => setForm({ ...form, gameId: e.target.value })}
                  className="accent-[var(--marlins-blue)]"
                  required
                />
                <div>
                  <p className="font-semibold text-white text-sm">{game.awayTeam} at {game.homeTeam}</p>
                  <p className="text-xs text-gray-400">{formatDate(game.gameTime)}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Ticket details */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-bold text-white mb-4">Ticket Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <Input id="section" label="Section" placeholder="e.g. 114" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} required />
            <Input id="row" label="Row" placeholder="e.g. G" value={form.row} onChange={(e) => setForm({ ...form, row: e.target.value })} required />
            <Input id="seatNumbers" label="Seat Numbers" placeholder="e.g. 4, 5" value={form.seatNumbers} onChange={(e) => setForm({ ...form, seatNumbers: e.target.value })} required />
            <Input id="quantity" label="Quantity" type="number" min="1" max="10" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          </div>
          <div className="mt-4">
            <Input id="askingPrice" label="Asking Price (per ticket, USD)" type="number" min="1" step="0.01" placeholder="e.g. 75.00" value={form.askingPrice} onChange={(e) => setForm({ ...form, askingPrice: e.target.value })} required />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Description (optional)</label>
            <textarea
              className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--marlins-blue)] focus:border-transparent transition-all text-sm resize-none"
              rows={3}
              placeholder="Aisle seats, great view, etc."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>

        {/* Activation trigger */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-bold text-white mb-1">When should your listing go live?</h2>
          <p className="text-sm text-gray-400 mb-4">We'll alert you 30 minutes before this time to forward your ticket.</p>
          <div className="space-y-2">
            {TRIGGER_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                  form.liveTriggerType === opt.value
                    ? "border-[var(--marlins-blue)] bg-blue-900/20"
                    : "border-gray-700 hover:border-gray-600"
                }`}
              >
                <input
                  type="radio"
                  name="liveTriggerType"
                  value={opt.value}
                  checked={form.liveTriggerType === opt.value}
                  onChange={(e) => setForm({ ...form, liveTriggerType: e.target.value })}
                  className="accent-[var(--marlins-blue)] mt-0.5"
                />
                <div>
                  <p className="font-semibold text-white text-sm">{opt.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Ticket identity */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="font-bold text-white mb-1">Ticket Identity</h2>
          <p className="text-sm text-gray-400 mb-4">
            We use your barcode to match the ticket email you'll forward us at activation time.
          </p>
          <Input
            id="barcodeNumber"
            label="Barcode Number"
            placeholder="e.g. 0123456789012345"
            value={form.barcodeNumber}
            onChange={(e) => setForm({ ...form, barcodeNumber: e.target.value })}
            required
          />
          <p className="text-xs text-gray-500 mt-2">
            Found in the MLB Ballpark app under your ticket → Barcode / Ticket ID.
          </p>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              MLB Transfer Link <span className="text-gray-500 font-normal">(optional — makes returning your ticket instant)</span>
            </label>
            <Input
              id="mlbTransferLink"
              label=""
              placeholder="https://ballpark.mlb.com/transfer/..."
              value={form.mlbTransferLink}
              onChange={(e) => setForm({ ...form, mlbTransferLink: e.target.value })}
            />
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-xl p-4 text-sm text-gray-400">
          Platform commission: <strong className="text-white">15%</strong> on completed sales. You keep <strong className="text-white">85%</strong>, paid via Stripe directly to your bank.
        </div>

        <Button type="submit" loading={loading} size="lg" className="w-full">
          Save Draft Listing →
        </Button>
      </form>
    </div>
  );
}
