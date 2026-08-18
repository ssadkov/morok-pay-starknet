"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SendIcon, WalletIcon } from "lucide-react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { isAddress, type Address } from "viem";

import { useNetwork } from "@/components/network-provider";
import { TokenPicker } from "@/components/treasury/token-picker";
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
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseTokenAmount, parseUsdc } from "@/lib/amount";
import { waitForAttestation } from "@/lib/cctp/attestation";
import {
  approveUsdcCall,
  depositForBurnCall,
  evmAddressToBytes32,
  irisTransactionHash,
  toHexBytes,
} from "@/lib/cctp/bytes";
import {
  CCTP_DOMAIN_STARKNET,
  messageTransmitterV2Abi,
} from "@/lib/cctp/constants";
import { shortenAddress } from "@/lib/format";
import { recordActivity } from "@/lib/pay/activity";
import { payoutToken } from "@/lib/starknet/actions";
import { formatStrk20Error } from "@/lib/starknet/errors";
import { formatShieldAmount, formatUsdc } from "@/lib/starknet/status";
import { getShieldToken } from "@/lib/starknet/tokens";
import { wagmiConfig } from "@/lib/wagmi";

type Destination = "base" | "starknet";
type PayoutStep =
  | "idle"
  | "unshielding"
  | "burning"
  | "attesting"
  | "minting"
  | "done";

const STEP_LABEL: Record<PayoutStep, string> = {
  idle: "",
  unshielding: "Unshield to this Ready account",
  burning: "Burn USDC on Starknet",
  attesting: "Waiting for Circle attestation",
  minting: "Mint USDC on Base with MetaMask",
  done: "USDC arrived on Base",
};

export function PayoutPanel() {
  const {
    session,
    token,
    setTokenId,
    privateRaw,
    balances,
    refreshBalances,
  } = useTreasury();
  const { network, starknet, cctp, baseChain } = useNetwork();
  const transmitter = cctp.messageTransmitter as Address;
  const usdcToken = getShieldToken("usdc", network);
  const { address, isConnected, chainId, status } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const connector = connectors[0];
  const connecting = isPending || status === "connecting";

  const [destination, setDestination] = useState<Destination>("base");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [step, setStep] = useState<PayoutStep>("idle");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMint, setPendingMint] = useState<{
    message: string;
    attestation: string;
  } | null>(null);

  const publicUsdc = balances?.usdcRaw ?? BigInt(0);
  const toBase = destination === "base";

  useEffect(() => {
    setAmount("");
    setError(null);
  }, [token.id, destination]);

  useEffect(() => {
    if (token.id !== "usdc" && destination === "base") {
      setDestination("starknet");
    }
  }, [token.id, destination]);

  if (!session) return null;
  const ready = session;

  async function mintOnBase(message: string, attestation: string) {
    if (!isConnected || !address) {
      if (!connector) throw new Error("Install MetaMask to mint on Base");
      connect({ connector, chainId: baseChain.id });
      throw new Error("Connect MetaMask on Base, then retry mint");
    }
    if (chainId !== baseChain.id) {
      await switchChainAsync({ chainId: baseChain.id });
    }
    setStep("minting");
    const mintHash = await writeContractAsync({
      address: transmitter,
      abi: messageTransmitterV2Abi,
      functionName: "receiveMessage",
      args: [toHexBytes(message), toHexBytes(attestation)],
      chainId: baseChain.id,
    });
    await waitForTransactionReceipt(wagmiConfig, {
      hash: mintHash,
      chainId: baseChain.id,
    });
    toast.success("USDC minted on Base", {
      description: mintHash,
      action: {
        label: "Basescan",
        onClick: () =>
          window.open(
            `${cctp.explorer}/tx/${mintHash}`,
            "_blank",
            "noopener,noreferrer",
          ),
      },
    });
    setPendingMint(null);
    setStep("done");
  }

  async function handleStarknetPayout() {
    const parsed = amount.trim()
      ? parseTokenAmount(amount, token.decimals)
      : privateRaw;
    const response = await payoutToken(
      ready.account,
      token,
      parsed,
      recipient,
    );
    if (token.id === "usdc") {
      recordActivity({
        network,
        kind: "unshield",
        source: "morok",
        amount: formatShieldAmount(parsed, token),
        amountRaw: parsed.toString(),
        counterparty: recipient,
        address: ready.address,
        txHash: response.transaction_hash,
      });
    }
    toast.success("Payout submitted", {
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
    setAmount("");
    await refreshBalances();
  }

  async function handleBasePayout() {
    if (!isAddress(recipient)) {
      throw new Error("Enter a valid Base address");
    }
    const parsed = amount.trim()
      ? parseUsdc(amount)
      : privateRaw > BigInt(0)
        ? privateRaw
        : publicUsdc;
    if (parsed <= BigInt(0)) throw new Error("Enter a USDC amount");

    let availablePublic = publicUsdc;
    if (availablePublic < parsed) {
      const need = parsed - availablePublic;
      if (privateRaw < need) {
        throw new Error("Not enough public and private USDC for this payout");
      }
      setStep("unshielding");
      const withdraw = await payoutToken(
        ready.account,
        usdcToken,
        need,
        ready.address,
      );
      recordActivity({
        network,
        kind: "unshield",
        source: "morok",
        amount: formatUsdc(need),
        amountRaw: need.toString(),
        counterparty: ready.address,
        address: ready.address,
        txHash: withdraw.transaction_hash,
      });
      toast.success("Unshield submitted", {
        description: withdraw.transaction_hash,
        action: {
          label: "Voyager",
          onClick: () =>
            window.open(
              `${starknet.explorer}/tx/${withdraw.transaction_hash}`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
      });
      await ready.account.provider.waitForTransaction(withdraw.transaction_hash);
      await refreshBalances();
    }

    setStep("burning");
    const mintRecipient = evmAddressToBytes32(recipient);
    const burn = await ready.account.execute([
      approveUsdcCall(parsed, starknet.usdc, starknet.tokenMessengerMinter),
      depositForBurnCall({
        amount: parsed,
        mintRecipient,
        usdc: starknet.usdc,
        minter: starknet.tokenMessengerMinter,
      }),
    ]);
    toast.success("Burn submitted on Starknet", {
      description: burn.transaction_hash,
      action: {
        label: "Voyager",
        onClick: () =>
          window.open(
            `${starknet.explorer}/tx/${burn.transaction_hash}`,
            "_blank",
            "noopener,noreferrer",
          ),
      },
    });
    await ready.account.provider.waitForTransaction(burn.transaction_hash);

    setStep("attesting");
    const attested = await waitForAttestation(
      irisTransactionHash(burn.transaction_hash),
      { sourceDomain: CCTP_DOMAIN_STARKNET, network },
    );
    setPendingMint(attested);
    await mintOnBase(attested.message, attested.attestation);
    setAmount("");
    await refreshBalances();
  }

  async function handlePayout() {
    setError(null);
    setSending(true);
    try {
      if (toBase) {
        await handleBasePayout();
      } else {
        await handleStarknetPayout();
      }
    } catch (caught) {
      setError(
        toBase
          ? caught instanceof Error
            ? caught.message
            : "Base payout failed"
          : formatStrk20Error(caught, "payout"),
      );
      setStep((current) => (current === "done" ? current : "idle"));
    } finally {
      setSending(false);
    }
  }

  async function retryMint() {
    if (!pendingMint) return;
    setError(null);
    setSending(true);
    try {
      await mintOnBase(pendingMint.message, pendingMint.attestation);
      await refreshBalances();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mint failed");
      setStep("idle");
    } finally {
      setSending(false);
    }
  }

  const busy = sending || (step !== "idle" && step !== "done");
  const availableForBase = publicUsdc + privateRaw;
  const canPayout = toBase
    ? availableForBase > BigInt(0) && Boolean(recipient.trim())
    : privateRaw > BigInt(0) && Boolean(recipient.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {toBase ? "Payout to Base" : "Payout to a fresh address"}
        </CardTitle>
        <CardDescription>
          {toBase
            ? "Unshield private USDC if needed, burn it on Starknet, then mint native USDC on Base. Use a fresh Base address so the payout is not linked to the MetaMask you funded with."
            : `Unshield private ${token.symbol} to a Starknet address you paste. Use a new wallet so the payout is not linked to this Ready account.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field orientation="horizontal">
          <FieldTitle id="payout-destination-label">Destination</FieldTitle>
          <ToggleGroup
            aria-labelledby="payout-destination-label"
            spacing={2}
            value={[destination]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "base" || value === "starknet") {
                if (value === "base") setTokenId("usdc");
                setDestination(value);
              }
            }}
          >
            <ToggleGroupItem value="base">Base</ToggleGroupItem>
            <ToggleGroupItem value="starknet">Starknet</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        {toBase ? null : <TokenPicker labelledBy="payout-token-label" />}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="payout-recipient">Recipient</FieldLabel>
            <Input
              id="payout-recipient"
              placeholder="0x…"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
            <FieldDescription>
              {toBase
                ? "A Base address you control. Do not reuse the MetaMask that funded this treasury."
                : "A public Starknet address. Do not reuse this Ready account."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="payout-amount">Amount</FieldLabel>
            <Input
              id="payout-amount"
              inputMode="decimal"
              placeholder={
                toBase
                  ? availableForBase > BigInt(0)
                    ? formatUsdc(
                        privateRaw > BigInt(0) ? privateRaw : publicUsdc,
                      )
                    : "0.00"
                  : privateRaw > BigInt(0)
                    ? formatShieldAmount(privateRaw, token)
                    : "0.00"
              }
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <FieldDescription>
              {toBase
                ? `Leave empty to send the private balance first (${formatUsdc(privateRaw)} USDC private, ${formatUsdc(publicUsdc)} public).`
                : `Leave empty to unshield the full private balance (${formatShieldAmount(privateRaw, token)} ${token.symbol}).`}
            </FieldDescription>
          </Field>
        </FieldGroup>
        {toBase && isConnected && address ? (
          <p className="text-sm text-muted-foreground">
            MetaMask {shortenAddress(address)}
            {chainId !== baseChain.id ? ` — switch to ${baseChain.name}` : ""}
            . Needed for ETH gas on the Base mint.
          </p>
        ) : toBase ? (
          <p className="text-sm text-muted-foreground">
            Ready burns on Starknet. MetaMask only submits the Base mint and
            needs a little ETH for gas.
          </p>
        ) : null}
        {toBase && step !== "idle" ? (
          <p className="text-sm text-muted-foreground">{STEP_LABEL[step]}</p>
        ) : null}
        {error ? (
          <Alert variant={pendingMint ? "default" : "destructive"}>
            <AlertTitle>
              {pendingMint ? "Mint on Base still needed" : "Payout failed"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {toBase && !isConnected ? (
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
        ) : null}
        {toBase && isConnected ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="min-h-10"
            onClick={() => disconnect()}
          >
            Disconnect MetaMask
          </Button>
        ) : null}
        <Button
          type="button"
          size="lg"
          className="min-h-10"
          disabled={busy || !canPayout}
          aria-busy={busy}
          onClick={() => {
            void handlePayout();
          }}
        >
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {busy
            ? toBase
              ? STEP_LABEL[step] || "Sending"
              : "Sending"
            : toBase
              ? "Payout USDC to Base"
              : `Payout ${token.symbol}`}
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
            Retry Base mint
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
