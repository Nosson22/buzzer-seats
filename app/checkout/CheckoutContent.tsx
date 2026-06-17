"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function CheckoutContent() {
  const searchParams = useSearchParams();
  const clientSecret = searchParams.get("clientSecret");
  const listingId = searchParams.get("listingId");
  const [StripeCheckout, setStripeCheckout] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    import("@/components/checkout/StripeCheckoutForm").then((mod) => {
      setStripeCheckout(() => mod.StripeCheckoutForm);
    });
  }, []);

  if (!clientSecret) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p>Invalid checkout session.</p>
      </div>
    );
  }

  if (!StripeCheckout) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--marlins-blue)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return <StripeCheckout clientSecret={clientSecret} listingId={listingId} />;
}
