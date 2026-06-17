/**
 * RecallButton — the one-click seller safety net.
 *
 * Shows a prominent "Recall Ticket" button on any DEPOSITED or AVAILABLE listing.
 * Handles all server responses cleanly:
 *   - Success: shows the transfer token / confirmation
 *   - 409 CHECKOUT_ACTIVE: tells seller a buyer is mid-checkout and shows retry time
 *   - 423 LOCK_CONFLICT: auto-retries once after 1 s
 */
"use client";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";

interface RecallButtonProps {
  listingId: string;
  onSuccess?: (transferToken: string | null) => void;
}

type RecallState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; transferToken: string | null; message: string }
  | { phase: "checkout_active"; retryAfter: Date; message: string }
  | { phase: "error"; message: string };

export function RecallButton({ listingId, onSuccess }: RecallButtonProps) {
  const [state, setState] = useState<RecallState>({ phase: "idle" });

  const recall = useCallback(
    async (retryCount = 0) => {
      setState({ phase: "loading" });

      const res = await fetch(`/api/tickets/${listingId}/recall`, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        setState({ phase: "success", transferToken: data.transferToken, message: data.message });
        onSuccess?.(data.transferToken);
        return;
      }

      // 423 = transient lock — retry once automatically
      if (res.status === 423 && retryCount < 1) {
        setTimeout(() => recall(retryCount + 1), 1_000);
        return;
      }

      if (res.status === 409 && data.code === "CHECKOUT_ACTIVE") {
        setState({
          phase: "checkout_active",
          retryAfter: new Date(data.retryAfter),
          message: data.error,
        });
        return;
      }

      setState({ phase: "error", message: data.error ?? "Recall failed. Please try again." });
    },
    [listingId, onSuccess]
  );

  if (state.phase === "success") {
    return (
      <div className="bg-green-900/30 border border-green-700 rounded-xl p-4">
        <p className="text-green-400 font-semibold mb-1">✓ Ticket recalled successfully</p>
        <p className="text-sm text-gray-300">{state.message}</p>
        {state.transferToken && (
          <div className="mt-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">MLB Transfer Link</p>
            <a
              href={state.transferToken}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono break-all underline text-blue-400 hover:text-blue-300"
            >
              {state.transferToken}
            </a>
          </div>
        )}
      </div>
    );
  }

  if (state.phase === "checkout_active") {
    const retryIn = Math.ceil((state.retryAfter.getTime() - Date.now()) / 60_000);
    return (
      <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4">
        <p className="text-yellow-400 font-semibold mb-1">⚠ A buyer is checking out</p>
        <p className="text-sm text-gray-300">{state.message}</p>
        <p className="text-xs text-gray-500 mt-2">
          Their session expires in ~{retryIn} min. You can recall after that if the sale doesn&apos;t complete.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => setState({ phase: "idle" })}
        >
          Dismiss
        </Button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
        <p className="text-red-400 font-semibold mb-1">Recall failed</p>
        <p className="text-sm text-gray-300">{state.message}</p>
        <Button variant="danger" size="sm" className="mt-3" onClick={() => recall()}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="danger"
      size="lg"
      loading={state.phase === "loading"}
      onClick={() => recall()}
      className="w-full"
    >
      ⚡ Recall Ticket Instantly
    </Button>
  );
}
