"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/**
 * The mark, inlined so the PNG export can rasterise it without a network
 * fetch. Kept in sync with components/brand/morok-mark.tsx.
 */
export const MOROK_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="15" fill="#071412"/><rect x="1" y="1" width="62" height="62" rx="14" fill="none" stroke="#245C55" stroke-width="2"/><path d="M11 48V16h9l12 17 12-17h9v32h-8V29L32 46 19 29v19H11Z" fill="#5EEAD4"/><path d="m27 39 5 7 18-25h-9L27 39Z" fill="#ECFEFA" opacity="0.92"/></svg>`;

/**
 * A centred logo covers modules, so the code is encoded at the highest error
 * correction level - "H" recovers about 30% - and the mark is held to a small
 * share of the width to stay well inside that budget.
 */
const LOGO_SHARE = 0.19;

export function useQrMatrix(value: string) {
  return useMemo(() => encode(value, { ecc: "H", border: 2 }), [value]);
}

export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = useQrMatrix(value);
  const path = data
    .flatMap((row, y) =>
      row.flatMap((cell, x) => (cell ? `M${x} ${y}h1v1h-1z` : [])),
    )
    .join("");
  const logo = size * LOGO_SHARE;
  const logoAt = (size - logo) / 2;
  const plate = logo * 1.24;
  const plateAt = (size - plate) / 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="size-52 rounded-lg bg-white"
    >
      <path d={path} className="fill-black" />
      <rect
        x={plateAt}
        y={plateAt}
        width={plate}
        height={plate}
        rx={plate * 0.22}
        fill="white"
      />
      <g
        transform={`translate(${logoAt} ${logoAt}) scale(${logo / 64})`}
        dangerouslySetInnerHTML={{
          __html: MOROK_MARK_SVG.replace(/^<svg[^>]*>/, "").replace(
            /<\/svg>$/,
            "",
          ),
        }}
      />
    </svg>
  );
}
