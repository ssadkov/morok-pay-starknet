"use client";

import { useMemo } from "react";
import { encode } from "uqr";

export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = useMemo(
    () => encode(value, { ecc: "M", border: 2 }),
    [value],
  );
  const path = data
    .flatMap((row, y) =>
      row.flatMap((cell, x) => (cell ? `M${x} ${y}h1v1h-1z` : [])),
    )
    .join("");

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="size-52 rounded-lg bg-white"
    >
      <path d={path} className="fill-black" />
    </svg>
  );
}
