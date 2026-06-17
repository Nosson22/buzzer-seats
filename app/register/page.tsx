import { Suspense } from "react";
import { RegisterForm } from "./RegisterForm";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-2 border-[var(--marlins-blue)] border-t-transparent rounded-full" /></div>}>
      <RegisterForm />
    </Suspense>
  );
}
