import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "subtle";
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(
  ({ variant = "subtle", className, ...rest }, ref) => {
    const base =
      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
    const variants = {
      primary: "bg-sky-500 text-white hover:bg-sky-400",
      ghost: "text-slate-300 hover:bg-slate-800",
      subtle: "bg-slate-800 text-slate-100 hover:bg-slate-700",
    };
    return (
      <button ref={ref} className={cx(base, variants[variant], className)} {...rest} />
    );
  }
);
Button.displayName = "Button";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...rest }, ref) => (
  <input
    ref={ref}
    className={cx(
      "w-full rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-sky-500",
      className
    )}
    {...rest}
  />
));
Input.displayName = "Input";

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        className
      )}
    >
      {children}
    </span>
  );
}
