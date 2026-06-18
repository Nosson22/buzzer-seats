"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatDate } from "@/lib/utils";
import { CUSTODY_INBOUND_EMAIL } from "@/lib/team-config";

const STEPS = 7;

const TRIGGER_OPTIONS = [
  {
    value: "T_60",
    label: "60 minutes before first pitch",
    description: "Good if you want to keep selling options open as long as possible.",
  },
  {
    value: "T_30",
    label: "30 minutes before first pitch",
    description: "Sweet spot — buyers are committed, you still have time to transfer.",
  },
  {
    value: "POST_START",
    label: "At first pitch",
    description: "Maximum hold time. Last-second buyers, last-second transfer.",
  },
];

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-1 mb-10">
      <div
        className="h-1 rounded-full transition-all duration-300"
        style={{ width: `${(step / STEPS) * 100}%`, backgroundColor: "var(--marlins-blue)" }}
      />
    </div>
  );
}

function StepShell({
  step,
  title,
  subtitle,
  onBack,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-xl mx-auto py-4">
      <ProgressBar step={step} />
      {onBack && (
        <button
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-white mb-6 flex items-center gap-1 transition-colors"
        >
          ← Back
        </button>
      )}
      <h1 className="text-3xl font-black text-white mb-2">{title}</h1>
      {subtitle && <p className="text-gray-400 mb-8">{subtitle}</p>}
      {children}
    </div>
  );
}

export default function SellPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    quantity: "",
    gameId: "",
    section: "",
    row: "",
    seatNumbers: "",
    askingPrice: "",
    liveTriggerType: "T_60",
    barcodeNumber: "",
    mlbTransferLink: "",
    description: "",
  });

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login?callbackUrl=/sell");
  }, [status]);

  useEffect(() => {
    fetch("/api/games?upcoming=true")
      .then((r) => r.json())
      .then(setGames);
  }, []);

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => s - 1);
  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          quantity: parseInt(form.quantity),
          askingPrice: parseFloat(form.askingPrice),
          mlbTransferLink: form.mlbTransferLink || undefined,
          description: form.description || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create listing");
      setSuccess(true);
    } catch (err: any) {
      setErrorMsg(err.message);
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
    const game = games.find((g) => g.id === form.gameId);
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="w-20 h-20 rounded-full bg-green-900/40 border border-green-700 flex items-center justify-center text-4xl mx-auto mb-6">
          🎟️
        </div>
        <h1 className="text-3xl font-black text-white mb-3">You're all set!</h1>
        <p className="text-gray-400 mb-6">
          Your ticket is still in your MLB Ballpark app — keep it. We'll send you a high-priority
          alert when it's time to forward it to us.
        </p>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 mb-6 text-left space-y-2">
          <p className="text-sm text-gray-500 font-medium uppercase tracking-wide">Your listing</p>
          {game && <p className="font-semibold text-white">{game.awayTeam} at {game.homeTeam}</p>}
          <p className="text-gray-400 text-sm">
            {form.quantity} ticket{parseInt(form.quantity) > 1 ? "s" : ""} · Sec {form.section} · Row {form.row} · Seats {form.seatNumbers}
          </p>
          <p className="text-lg font-bold text-white">${parseFloat(form.askingPrice).toFixed(2)} each</p>
        </div>
        <p className="text-sm text-gray-500 mb-8">
          When we alert you, forward your ticket to:{" "}
          <span className="font-mono font-bold text-[var(--marlins-blue)]">{CUSTODY_INBOUND_EMAIL}</span>
        </p>
        <div className="flex gap-3 justify-center">
          <Button
            onClick={() => {
              setSuccess(false);
              setStep(1);
              setForm({ quantity: "", gameId: "", section: "", row: "", seatNumbers: "", askingPrice: "", liveTriggerType: "T_60", barcodeNumber: "", mlbTransferLink: "", description: "" });
            }}
          >
            List Another Ticket
          </Button>
          <Button variant="ghost" onClick={() => router.push("/dashboard")}>
            View My Listings
          </Button>
        </div>
      </div>
    );
  }

  // Step 1 — Quantity
  if (step === 1) {
    return (
      <StepShell step={1} title="How many tickets do you want to sell?">
        <div className="grid grid-cols-2 gap-3">
          {["1", "2", "3", "4"].map((n) => (
            <button
              key={n}
              onClick={() => { set("quantity", n); next(); }}
              className={`py-8 rounded-2xl border-2 text-3xl font-black transition-all hover:border-[var(--marlins-blue)] ${
                form.quantity === n
                  ? "border-[var(--marlins-blue)] bg-blue-900/20 text-white"
                  : "border-gray-700 text-white bg-gray-900"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          onClick={() => { set("quantity", "5"); next(); }}
          className="mt-3 w-full py-4 rounded-2xl border-2 border-gray-700 text-gray-400 hover:border-[var(--marlins-blue)] hover:text-white transition-all text-sm font-medium"
        >
          More than 4 →
        </button>
      </StepShell>
    );
  }

  // Step 2 — Game selection
  if (step === 2) {
    return (
      <StepShell step={2} title="Which game?" onBack={back}>
        <div className="space-y-2">
          {games.length === 0 && <p className="text-gray-500 text-sm">No upcoming games available.</p>}
          {games.map((game) => (
            <button
              key={game.id}
              onClick={() => { set("gameId", game.id); next(); }}
              className={`w-full flex items-center justify-between p-4 rounded-xl border-2 text-left transition-all hover:border-[var(--marlins-blue)] ${
                form.gameId === game.id
                  ? "border-[var(--marlins-blue)] bg-blue-900/20"
                  : "border-gray-700 bg-gray-900"
              }`}
            >
              <div>
                <p className="font-semibold text-white">{game.awayTeam} at {game.homeTeam}</p>
                <p className="text-sm text-gray-400 mt-0.5">{formatDate(game.gameTime)}</p>
              </div>
              <span className="text-[var(--marlins-blue)] text-xl">→</span>
            </button>
          ))}
        </div>
      </StepShell>
    );
  }

  // Step 3 — Section, row, seats
  if (step === 3) {
    const canContinue = form.section && form.row && form.seatNumbers;
    return (
      <StepShell step={3} title="Where are the seats?" subtitle="Enter your section, row, and seat numbers." onBack={back}>
        <div className="space-y-4">
          <Input id="section" label="Section" placeholder="e.g. 114" value={form.section} onChange={(e) => set("section", e.target.value)} />
          <Input id="row" label="Row" placeholder="e.g. G" value={form.row} onChange={(e) => set("row", e.target.value)} />
          <Input id="seatNumbers" label="Seat Numbers" placeholder={`e.g. ${form.quantity === "1" ? "4" : "4, 5"}`} value={form.seatNumbers} onChange={(e) => set("seatNumbers", e.target.value)} />
        </div>
        <Button className="w-full mt-8" disabled={!canContinue} onClick={next}>
          Continue →
        </Button>
      </StepShell>
    );
  }

  // Step 4 — Asking price
  if (step === 4) {
    return (
      <StepShell step={4} title="What's your asking price?" subtitle="Per ticket, in USD. Buyers see this price." onBack={back}>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl font-bold">$</span>
          <input
            type="number"
            min="1"
            step="0.01"
            placeholder="0.00"
            value={form.askingPrice}
            onChange={(e) => set("askingPrice", e.target.value)}
            className="w-full pl-10 pr-4 py-5 bg-gray-900 border-2 border-gray-700 rounded-2xl text-white text-3xl font-black placeholder-gray-600 focus:outline-none focus:border-[var(--marlins-blue)] transition-all"
          />
        </div>
        {form.askingPrice && parseFloat(form.askingPrice) > 0 && (
          <p className="text-sm text-gray-500 mt-3 text-center">
            You'll receive <span className="text-white font-semibold">${(parseFloat(form.askingPrice) * 0.85).toFixed(2)}</span> per ticket after our 15% commission.
          </p>
        )}
        <Button className="w-full mt-8" disabled={!form.askingPrice || parseFloat(form.askingPrice) <= 0} onClick={next}>
          Continue →
        </Button>
      </StepShell>
    );
  }

  // Step 5 — Trigger / when to go live
  if (step === 5) {
    return (
      <StepShell step={5} title="When should your listing go live?" subtitle="We'll alert you 30 minutes before this time to forward your ticket." onBack={back}>
        <div className="space-y-3">
          {TRIGGER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { set("liveTriggerType", opt.value); next(); }}
              className={`w-full text-left p-5 rounded-2xl border-2 transition-all hover:border-[var(--marlins-blue)] ${
                form.liveTriggerType === opt.value
                  ? "border-[var(--marlins-blue)] bg-blue-900/20"
                  : "border-gray-700 bg-gray-900"
              }`}
            >
              <p className="font-bold text-white mb-1">{opt.label}</p>
              <p className="text-sm text-gray-400">{opt.description}</p>
            </button>
          ))}
        </div>
      </StepShell>
    );
  }

  // Step 6 — Barcode
  if (step === 6) {
    return (
      <StepShell step={6} title="What's your ticket barcode?" subtitle="We use this to match the ticket email you'll forward us." onBack={back}>
        <Input
          id="barcodeNumber"
          label="Barcode / Ticket ID"
          placeholder="e.g. 0123456789012345"
          value={form.barcodeNumber}
          onChange={(e) => set("barcodeNumber", e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-2">
          Found in the MLB Ballpark app under your ticket → Barcode / Ticket ID.
        </p>
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            MLB Transfer Link <span className="text-gray-500 font-normal">(optional — speeds up returning your ticket)</span>
          </label>
          <Input
            id="mlbTransferLink"
            label=""
            placeholder="https://ballpark.mlb.com/transfer/..."
            value={form.mlbTransferLink}
            onChange={(e) => set("mlbTransferLink", e.target.value)}
          />
        </div>
        <Button className="w-full mt-8" disabled={!form.barcodeNumber} onClick={next}>
          Continue →
        </Button>
      </StepShell>
    );
  }

  // Step 7 — Review & submit
  const selectedGame = games.find((g) => g.id === form.gameId);
  const triggerLabel = TRIGGER_OPTIONS.find((t) => t.value === form.liveTriggerType)?.label;

  return (
    <StepShell step={7} title="Review your listing" subtitle="Everything look right? Hit submit and we'll take it from here." onBack={back}>
      {errorMsg && (
        <div className="mb-6 p-4 rounded-xl bg-red-900/30 text-red-400 border border-red-800 text-sm">
          {errorMsg}
        </div>
      )}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4 mb-8">
        <Row label="Game" value={selectedGame ? `${selectedGame.awayTeam} at ${selectedGame.homeTeam}` : "—"} />
        <Row label="Date" value={selectedGame ? formatDate(selectedGame.gameTime) : "—"} />
        <Row label="Tickets" value={form.quantity} />
        <Row label="Section / Row / Seats" value={`Sec ${form.section} · Row ${form.row} · ${form.seatNumbers}`} />
        <Row label="Asking price" value={`$${parseFloat(form.askingPrice).toFixed(2)} per ticket`} />
        <Row label="Goes live" value={triggerLabel ?? "—"} />
        <Row label="Barcode" value={form.barcodeNumber} mono />
      </div>
      <Button className="w-full" size="lg" loading={loading} onClick={handleSubmit}>
        Submit Listing →
      </Button>
      <p className="text-xs text-gray-600 text-center mt-4">
        15% commission on sales · Your ticket stays with you until we alert you
      </p>
    </StepShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className={`text-sm text-white text-right ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
    </div>
  );
}
