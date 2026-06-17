import { Suspense } from "react";
import { CheckoutContent } from "./CheckoutContent";

export default function CheckoutPage() {
  return (
    <div className="max-w-md mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-black text-white">Complete Purchase</h1>
        <p className="text-gray-400 mt-2">Secure payment powered by Stripe</p>
      </div>
      <Suspense fallback={
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--marlins-blue)] border-t-transparent rounded-full" />
        </div>
      }>
        <CheckoutContent />
      </Suspense>
    </div>
  );
}
