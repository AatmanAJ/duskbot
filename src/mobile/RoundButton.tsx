import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** The floating round control: 44pt of liquid glass over content, a quieter glass disc inside sheets.
 * Press is the .96 scale with the release overshoot, in CSS so it never waits on React. */
export const RoundButton = forwardRef<HTMLButtonElement, {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  size?: number;
  floating?: boolean;
  className?: string;
  pressed?: boolean;
  disabled?: boolean;
}>(function RoundButton({ label, onClick, children, size = 44, floating = false, className, pressed, disabled }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mobile-press relative inline-flex shrink-0 items-center justify-center rounded-full text-ink disabled:opacity-40",
        floating ? "m-glass" : "m-glass-quiet",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
});
