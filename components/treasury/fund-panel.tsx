"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLineIcon } from "lucide-react";
import {
  useAccount,
  useConnect,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import type { Address } from "viem";

import { txToast } from "@/components/pay/tx-toast";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import {
  bridgeUsdcFromBase,
  deliverAttestation,
} from "@/lib/cctp/bridge-from-base";
import { erc20Abi } from "@/lib/cctp/constants";
import { shortenAddress } from "@/lib/format";
import { formatUsdc } from "@/lib/starknet/status";

/**
 * Bringing more USDC over, after the way in is already behind you.
 *
 * The onboarding screen carries this too, but it is a way *in*: it stops
 * offering itself the moment the account is ready, which is exactly when
 * somebody wants to add funds for the second time. So the same bridge lives
 * here permanently, on the page whose whole job is topping up - and it is
 * literally the same one, from lib/cctp/bridge-from-base, rather than a
 * second copy of a long sequence that would quietly drift away from it.
 *
 * This file used to be that second copy. It was written first, never rendered
 * anywhere, and had settled on the finalized threshold - thirteen to nineteen
 * minutes instead of about one, for no benefit anybody chose.
 */
export function FundPanel() {
  const { session, refreshBalances, evmStarknetAddress } = useTreasury();
  const { network, starknet, cctp, baseChain } = useNetwork();
  const usdc = cctp.usdc as Address;
  const messenger = cctp.tokenMessenger as Address;
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    message: string;
    attestation: string;
  } | null>(null);

  const parsed = useMemo(() => {
    try {
      return amount.trim() ? parseUsdc(amount) : null;
    } catch {
      return null;
    }
  }, [amount]);

  const { data: baseUsdc } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: baseChain.id,
    query: { enabled: Boolean(address) },
  });

  const { data: allowance } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, messenger] : undefined,
    chainId: baseChain.id,
    query: { enabled: Boolean(address) },
  });

  /* Not gated on a session: an ERC-20 balance needs no code at the address,
     so USDC can be sent to an account that is not deployed yet. */
  const derived = session?.address ?? evmStarknetAddress;
  if (!derived) return null;
  const destination: string = derived;

  function announce(transactionHash: string) {
    if (transactionHash) {
      txToast({
        title: "USDC arrived on Starknet",
        note: "MorokPay paid the delivery fee",
        txHash: transactionHash,
        explorerUrl: `${starknet.explorer}/tx/${transactionHash}`,
        explorerLabel: "Voyager",
      });
    } else {
      toast.success("USDC arrived on Starknet", {
        description: "MorokPay paid the delivery fee",
      });
    }
  }

  async function send() {
    setError(null);
    setBusy("Starting");
    try {
      if (!parsed) throw new Error("Enter a USDC amount");
      if (!isConnected || !address) {
        const connector = connectors[0];
        if (!connector) throw new Error("Install MetaMask to fund from Base");
        connect({ connector, chainId: baseChain.id });
        throw new Error("Connect MetaMask, then send again");
      }
      const { transactionHash } = await bridgeUsdcFromBase({
        network,
        amount: parsed,
        destination,
        usdc,
        messenger,
        baseChainId: baseChain.id,
        currentChainId: chainId,
        allowance: allowance as bigint | undefined,
        baseBalance: baseUsdc as bigint | undefined,
        switchChain: (id) => switchChainAsync({ chainId: id }),
        writeContract: (config) => writeContractAsync(config as never),
        onProgress: setBusy,
        onBurn: (hash) =>
          txToast({
            title: "Sent from Base",
            txHash: hash,
            explorerUrl: `${cctp.explorer}/tx/${hash}`,
            explorerLabel: "Basescan",
          }),
        onAttested: setPending,
      });
      setPending(null);
      setAmount("");
      announce(transactionHash);
      await refreshBalances({ private: false });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The transfer failed");
    } finally {
      setBusy(null);
    }
  }

  /* The burn already happened, so the money exists and is owed to this
     address. Only the relayed mint is outstanding, and it can be asked for
     again without burning anything a second time. */
  async function retry() {
    if (!pending) return;
    setError(null);
    setBusy("Delivering on Starknet");
    try {
      const transactionHash = await deliverAttestation(network, pending);
      setPending(null);
      announce(transactionHash);
      await refreshBalances({ private: false });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delivery failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bring USDC from Base</CardTitle>
        <CardDescription>
          Burn on Base with MetaMask, and MorokPay pays to deliver it on
          Starknet. It lands on {shortenAddress(destination)} - the address the
          burn names, which nothing afterwards can redirect.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="fund-amount">USDC to bring over</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="fund-amount"
              inputMode="decimal"
              placeholder="10.00"
              value={amount}
              disabled={Boolean(busy)}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || baseUsdc === undefined}
              onClick={() =>
                setAmount(formatUsdc((baseUsdc as bigint) ?? BigInt(0)))
              }
            >
              Max
            </Button>
          </div>
          <FieldDescription>
            {baseUsdc !== undefined
              ? `${formatUsdc(baseUsdc as bigint)} USDC on Base in this wallet.`
              : "Connect MetaMask to see your Base balance."}{" "}
            Circle takes a small transfer fee on the way.
          </FieldDescription>
        </Field>

        {busy ? <p className="text-sm text-muted-foreground">{busy}</p> : null}

        {error ? (
          <Alert variant={pending ? "default" : "destructive"}>
            <AlertTitle>
              {pending ? "Burned, not yet delivered" : "That did not finish"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {pending ? (
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => void retry()}
          >
            Deliver it on Starknet
          </Button>
        ) : (
          <Button
            type="button"
            className="min-h-12"
            disabled={Boolean(busy) || !parsed}
            aria-busy={Boolean(busy)}
            onClick={() => void send()}
          >
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ArrowDownToLineIcon data-icon="inline-start" />
            )}
            {busy ? "Working" : "Send USDC from Base"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
