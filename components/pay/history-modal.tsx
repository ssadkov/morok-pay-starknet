"use client";

import { useState } from "react";
import { HistoryIcon } from "lucide-react";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { shortenAddress } from "@/lib/format";
import { activityParties, readActivity, type ActivityItem } from "@/lib/pay/activity";

/**
 * Two records of the same private life, kept two entirely different ways.
 *
 * "This device" is `recordActivity`'s localStorage log - amounts, labels,
 * everything the app can show because it wrote it down itself. It is
 * private to this browser and gone the moment site data is cleared.
 *
 * "Channels" is not a log at all: `discoverChannels` asks the pool, through
 * this account's own viewing key, who it has ever opened a private channel
 * to. That answer exists independent of any device - the same key would get
 * it back on a phone that has never opened this app. What it cannot answer
 * is how much or when: a channel carries the recipient's key and a note
 * count, because the notes it created are encrypted to *their* key material,
 * not this account's. Ready X holds its own viewing key and does not expose
 * this to the page, so the tab only works on the EVM rail.
 */

type Tab = "device" | "channels";

export function HistoryModal() {
  const { session } = useTreasury();
  const { network, starknet } = useNetwork();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("device");
  const [channels, setChannels] = useState<
    { recipient: string; noteCount: number }[] | null
  >(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  if (!session) return null;

  const local = open ? readActivity(network, session.address) : [];
  const channelsAvailable = session.kind === "evm";

  async function loadChannels() {
    // Re-checked here, not just via channelsAvailable above: a nested
    // function does not inherit the component body's `if (!session) return`
    // narrowing, so TypeScript still sees session as possibly null inside it.
    if (!session || session.kind !== "evm" || channels || loadingChannels) {
      return;
    }
    setLoadingChannels(true);
    setChannelsError(null);
    try {
      const result = await session.account.discoverChannels();
      setChannels(result);
    } catch (caught) {
      setChannelsError(
        caught instanceof Error ? caught.message : "Could not read channels",
      );
    } finally {
      setLoadingChannels(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTab("device");
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" size="sm" variant="outline">
            <HistoryIcon data-icon="inline-start" />
            History
          </Button>
        }
      />
      <DialogContent className="max-w-lg">
        <div className="flex flex-col gap-1">
          <DialogTitle>Private activity</DialogTitle>
          <DialogDescription>
            Two different records, kept two different ways.
          </DialogDescription>
        </div>

        <ToggleGroup
          value={[tab]}
          onValueChange={(next) => {
            const value = next[0];
            if (value !== "device" && value !== "channels") return;
            setTab(value);
            if (value === "channels") void loadChannels();
          }}
        >
          <ToggleGroupItem value="device">This device</ToggleGroupItem>
          <ToggleGroupItem value="channels" disabled={!channelsAvailable}>
            Channels{channelsAvailable ? "" : " (EVM only)"}
          </ToggleGroupItem>
        </ToggleGroup>

        {tab === "device" ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Stored only in this browser&apos;s local storage. Clearing site
              data, or opening MorokPay on another device, loses it - nothing
              here is sent anywhere.
            </p>
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {local.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing recorded on this device yet.
                </p>
              ) : (
                local.map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    explorer={starknet.explorer}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Read from the pool with your viewing key, not from anything
              MorokPay stored - this is permanent and would answer the same
              way on a different device. It shows who you opened a channel
              to, never how much or when.
            </p>
            {loadingChannels ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Reading channels…
              </p>
            ) : channelsError ? (
              <p className="text-sm text-destructive">{channelsError}</p>
            ) : !channels || channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No channels opened from this account yet.
              </p>
            ) : (
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {channels.map((channel) => (
                  <a
                    key={channel.recipient}
                    href={`${starknet.explorer}/contract/${channel.recipient}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm ring-1 ring-foreground/10 hover:bg-muted/60"
                  >
                    <span className="font-mono">
                      {shortenAddress(channel.recipient)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {channel.noteCount}{" "}
                      {channel.noteCount === 1 ? "transfer" : "transfers"}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  pay: "Donated",
  receive: "Received",
  shield: "Shielded",
  unshield: "Unshielded",
};

function ActivityRow({
  item,
  explorer,
}: {
  item: ActivityItem;
  explorer: string;
}) {
  const { from, to } = activityParties(item);
  const counterparty =
    item.kind === "pay" ? to : item.kind === "receive" ? from : undefined;

  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2 text-sm ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <span className="font-medium">{KIND_LABEL[item.kind]}</span>
        <span className="font-mono tabular-nums">{item.amount}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {counterparty
            ? shortenAddress(counterparty)
            : (item.label ?? "—")}
        </span>
        <span className="flex items-center gap-2">
          {new Date(item.at).toLocaleString()}
          {item.txHash ? (
            <a
              href={`${explorer}/tx/${item.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Voyager
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}
