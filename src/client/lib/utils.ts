import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui class combiner: merge conditional clsx output, de-duping conflicting
// Tailwind classes (last one wins).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
