import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-02-24.acacia",
});

export const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE || "0.15");

export function calcAmounts(salePrice: number) {
  const commissionAmount = parseFloat((salePrice * COMMISSION_RATE).toFixed(2));
  const sellerPayout = parseFloat((salePrice - commissionAmount).toFixed(2));
  return { commissionAmount, sellerPayout };
}
