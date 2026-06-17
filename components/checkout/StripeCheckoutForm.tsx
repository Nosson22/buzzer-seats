"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/Button";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function CheckoutForm({ listingId }: { listingId: string | null }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success?listingId=${listingId}`,
      },
    });

    if (stripeError) {
      setError(stripeError.message || "Payment failed");
      setLoading(false);
    }
    // On success, Stripe redirects to return_url
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
      <div className="mb-6">
        <PaymentElement
          options={{ layout: "tabs" }}
        />
      </div>
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 text-red-400 border border-red-800 text-sm">
          {error}
        </div>
      )}
      <Button type="submit" loading={loading} disabled={!stripe} size="lg" className="w-full">
        Pay Now
      </Button>
      <p className="text-center text-xs text-gray-500 mt-4">
        Secured by Stripe · 256-bit encryption
      </p>
    </form>
  );
}

export function StripeCheckoutForm({
  clientSecret,
  listingId,
}: {
  clientSecret: string;
  listingId: string | null;
}) {
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: "night" },
      }}
    >
      <CheckoutForm listingId={listingId} />
    </Elements>
  );
}
