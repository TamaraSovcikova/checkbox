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
  variant?: "primary" | "ghost" | "subtle" | "danger";
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(
  ({ variant = "subtle", className, ...rest }, ref) => {
    const base =
      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
    const variants = {
      primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
      ghost: "text-foreground hover:bg-surface-2",
      subtle: "bg-surface-2 text-foreground hover:bg-surface-2/80",
      danger: "bg-danger text-white hover:bg-danger/90",
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
      "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary",
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
