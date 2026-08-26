"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownToLineIcon, WalletIcon } from "lucide-react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { zeroHash, type Address } from "viem";

import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import { waitForAttestation } from "@/lib/cctp/attestation";
import { receiveMessageCall, starkAddressToBytes32 } from "@/lib/cctp/bytes";
import {
  CCTP_DOMAIN_BASE,
  CCTP_DOMAIN_STARKNET,
  CCTP_MIN_FINALITY_THRESHOLD,
  erc20Abi,
  tokenMessengerV2Abi,
} from "@/lib/cctp/constants";
import { shortenAddress } from "@/lib/format";
import { formatUsdc } from "@/lib/starknet/status";
import { wagmiConfig } from "@/lib/wagmi";

type FundStep =
  | "idle"
  | "approving"
  | "burning"
  | "attesting"
  | "minting"
  | "done";

const STEP_LABEL: Record<FundStep, string> = {
  idle: "",
  approving: "Approve USDC on Base",
  burning: "Burn USDC on Base",
  attesting: "Waiting for Circle attestation",
  minting: "Mint USDC on Starknet with Ready",
  done: "USDC arrived on Ready",
};

export function FundPanel() {
  const { session, refreshBalances } = useTreasury();
  const { network, starknet, cctp, baseChain } = useNetwork();
  const usdc = cctp.usdc as Address;
  const messenger = cctp.tokenMessenger as Address;
  const { address, isConnected, chainId, status } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const connector = connectors[0];
  const connecting = isPending || status === "connecting";

  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<FundStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingMint, setPendingMint] = useState<{
    message: string;
    attestation: string;
  } | null>(null);

  const parsedAmount = useMemo(() => {
    try {
      return amount.trim() ? parseUsdc(amount) : null;
    } catch {
      return null;
    }
  }, [amount]);

  const { data: baseUsdc, refetch: refetchBaseUsdc } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: baseChain.id,
    query: { enabled: Boolean(address) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, messenger] : undefined,
    chainId: baseChain.id,
    query: { enabled: Boolean(address) },
  });

  if (!session || session.kind !== "ready") return null;
  const ready = session;

  async function mintOnStarknet(message: string, attestation: string) {
    setStep("minting");
    const response = await ready.account.execute(
      receiveMessageCall(message, attestation, starknet.messageTransmitter),
    );
    toast.success("USDC minted on Starknet", {
      description: response.transaction_hash,
      action: {
        label: "Voyager",
        onClick: () =>
          window.open(
            `${starknet.explorer}/tx/${response.transaction_hash}`,
            "_blank",
            "noopener,noreferrer",
          ),
      },
    });
    setPendingMint(null);
    setStep("done");
    await refreshBalances();
  }

  async function handleFund() {
    setError(null);
    try {
      const value = parsedAmount;
      if (!value) throw new Error("Enter a USDC amount");
      if (!isConnected || !address) {
        if (!connector) throw new Error("Install MetaMask to fund from Base");
        connect({ connector, chainId: baseChain.id });
        throw new Error("Connect MetaMask, then tap Fund Ready again");
      }
      if (chainId !== baseChain.id) {
        await switchChainAsync({ chainId: baseChain.id });
      }

      const balance = baseUsdc ?? (await refetchBaseUsdc()).data ?? BigInt(0);
      if (balance < value) throw new Error("Not enough USDC in MetaMask");

      const currentAllowance =
        allowance ?? (await refetchAllowance()).data ?? BigInt(0);
      if (currentAllowance < value) {
        setStep("approving");
        const approveHash = await writeContractAsync({
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [messenger, value],
          chainId: baseChain.id,
        });
        await waitForTransactionReceipt(wagmiConfig, {
          hash: approveHash,
          chainId: baseChain.id,
        });
      }

      setStep("burning");
      const burnHash = await writeContractAsync({
        address: messenger,
        abi: tokenMessengerV2Abi,
        functionName: "depositForBurn",
        args: [
          value,
          CCTP_DOMAIN_STARKNET,
          starkAddressToBytes32(ready.address),
          usdc,
          zeroHash,
          BigInt(0),
          CCTP_MIN_FINALITY_THRESHOLD,
        ],
        chainId: baseChain.id,
      });
      toast.success("Burn submitted on Base", {
        description: burnHash,
        action: {
          label: "Basescan",
          onClick: () =>
            window.open(
              `${cctp.explorer}/tx/${burnHash}`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
      });
      await waitForTransactionReceipt(wagmiConfig, {
        hash: burnHash,
        chainId: baseChain.id,
      });

      setStep("attesting");
      const attested = await waitForAttestation(burnHash, {
        sourceDomain: CCTP_DOMAIN_BASE,
        network,
      });
      setPendingMint(attested);
      await mintOnStarknet(attested.message, attested.attestation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Funding failed");
      setStep((current) => (current === "done" ? current : "idle"));
    }
  }

  async function retryMint() {
    if (!pendingMint) return;
    setError(null);
    try {
      await mintOnStarknet(pendingMint.message, pendingMint.attestation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mint failed");
      setStep("idle");
    }
  }

  const busy = step !== "idle" && step !== "done";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {network === "sepolia" ? "Fund from Base Sepolia" : "Fund from Base"}
        </CardTitle>
        <CardDescription>
          {network === "sepolia"
            ? "Burn test USDC on Base Sepolia. Circle sandbox attests, then Ready mints on Starknet Sepolia. Get USDC from faucet.circle.com."
            : "Burn USDC on Base with MetaMask. Circle attests the message, then Ready mints native USDC on Starknet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="fund-amount">USDC amount</FieldLabel>
            <Input
              id="fund-amount"
              inputMode="decimal"
              placeholder="10.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <FieldDescription>
              {network === "sepolia" ? "Base Sepolia" : "Base"} USDC in MetaMask
              {baseUsdc !== undefined ? `: ${formatUsdc(baseUsdc)}` : ""}.
            </FieldDescription>
          </Field>
        </FieldGroup>
        {isConnected && address ? (
          <p className="text-sm text-muted-foreground">
            MetaMask {shortenAddress(address)}
            {chainId !== baseChain.id ? ` — switch to ${baseChain.name}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            MetaMask is only used for the Base burn. Ready stays the Starknet
            wallet.
          </p>
        )}
        {step !== "idle" ? (
          <p className="text-sm text-muted-foreground">{STEP_LABEL[step]}</p>
        ) : null}
        {error ? (
          <Alert variant={pendingMint ? "default" : "destructive"}>
            <AlertTitle>
              {pendingMint ? "Mint on Starknet still needed" : "Funding paused"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {!isConnected ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-10"
            disabled={!connector || connecting}
            aria-busy={connecting}
            onClick={() => {
              if (connector) connect({ connector, chainId: baseChain.id });
            }}
          >
            {connecting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <WalletIcon data-icon="inline-start" />
            )}
            {connecting ? "Connecting" : "Connect MetaMask"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-10"
            onClick={() => disconnect()}
          >
            Disconnect MetaMask
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          className="min-h-10"
          disabled={busy || !parsedAmount}
          aria-busy={busy}
          onClick={() => {
            void handleFund();
          }}
        >
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowDownToLineIcon data-icon="inline-start" />
          )}
          {busy ? STEP_LABEL[step] : "Fund Ready"}
        </Button>
        {pendingMint ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-10"
            onClick={() => {
              void retryMint();
            }}
          >
            Retry Starknet mint
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
