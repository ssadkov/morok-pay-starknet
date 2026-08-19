import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

type MorokMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

/** Geometric M whose inner cuts echo MorokPay's original // rails. */
export function MorokMark({ className, title, ...props }: MorokMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <rect width="64" height="64" rx="15" fill="#071412" />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="14"
        fill="none"
        stroke="#245C55"
        strokeWidth="2"
      />
      <path
        d="M11 48V16h9l12 17 12-17h9v32h-8V29L32 46 19 29v19H11Z"
        fill="#5EEAD4"
      />
      <path
        d="m27 39 5 7 18-25h-9L27 39Z"
        fill="#ECFEFA"
        opacity="0.92"
      />
    </svg>
  );
}
