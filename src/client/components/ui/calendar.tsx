import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

// react-day-picker wrapper. Colors come from the --rdp-* variables overridden
// in index.css (mapped to the design tokens), so no per-class theming needed.
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, ...props }: CalendarProps) {
  return <DayPicker className={cn("text-sm", className)} {...props} />;
}
