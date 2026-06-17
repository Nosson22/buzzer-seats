import Stripe from "stripe";

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia",
    });
  }
  return _stripe;
}

// Keep named export for backwards compat — resolved lazily at call time
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop];
  },
});

export const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE || "0.15");

export function calcAmounts(salePrice: number) {
  const commissionAmount = parseFloat((salePrice * COMMISSION_RATE).toFixed(2));
  const sellerPayout = parseFloat((salePrice - commissionAmount).toFixed(2));
  return { commissionAmount, sellerPayout };
}
