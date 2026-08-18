"use client";

import { useTreasury } from "@/components/treasury/treasury-context";
import { Field, FieldTitle } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ShieldTokenId } from "@/lib/starknet/tokens";

export function TokenPicker({ labelledBy = "token-picker-label" }: { labelledBy?: string }) {
  const { token, tokens, setTokenId } = useTreasury();

  if (tokens.length < 2) return null;

  return (
    <Field orientation="horizontal">
      <FieldTitle id={labelledBy}>Token</FieldTitle>
      <ToggleGroup
        aria-labelledby={labelledBy}
        spacing={2}
        value={[token.id]}
        onValueChange={(next) => {
          const id = next[0];
          if (id === "usdc" || id === "strkbtc") {
            setTokenId(id as ShieldTokenId);
          }
        }}
      >
        {tokens.map((entry) => (
          <ToggleGroupItem key={entry.id} value={entry.id}>
            {entry.symbol}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}
