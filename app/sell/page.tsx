import { AppShell } from "@/components/pay/app-shell";
import { GiveawayPanel } from "@/components/pay/giveaway-panel";
import { SellPanel } from "@/components/pay/sell-panel";

export default function SellPage() {
  return (
    <AppShell>
      <SellPanel />
      <GiveawayPanel />
    </AppShell>
  );
}
