import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "green" | "red" | "yellow" | "blue" | "gray";
  className?: string;
}

const variants = {
  green: "bg-green-900/50 text-green-400 border border-green-800",
  red: "bg-red-900/50 text-red-400 border border-red-800",
  yellow: "bg-yellow-900/50 text-yellow-400 border border-yellow-800",
  blue: "bg-blue-900/50 text-blue-400 border border-blue-800",
  gray: "bg-gray-800 text-gray-400 border border-gray-700",
};

export function Badge({ children, variant = "gray", className }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium", variants[variant], className)}>
      {children}
    </span>
  );
}
