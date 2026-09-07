"use client";

import { useState } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { toast } from "sonner";
import { isAddress, type Address } from "viem";
import {
  useAccount,
  useConnect,
  useSignMessage,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { txToast } from "@/components/pay/tx-toast";
import { useNetwork } from "@/components/network-provider";
import { useTreasury } from "@/components/treasury/treasury-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { parseUsdc } from "@/lib/amount";
import { waitForAttestation } from "@/lib/cctp/attestation";
import { irisTransactionHash } from "@/lib/cctp/bytes";
import { CCTP_DOMAIN_STARKNET, messageTransmitterV2Abi } from "@/lib/cctp/constants";
import { relayedBurnToBase } from "@/lib/cctp/relayed-burn-client";
import { describeError } from "@/lib/starknet/errors";
import { formatUsdc } from "@/lib/starknet/status";

/**
 * Bridging public USDC out of Starknet to Base, without holding STRK.
 *
 * The burn is relayed - the owner signs an outside execution, MorokPay submits
 * it and pays the Starknet gas. That is the half worth sponsoring: somebody
 * who just unshielded their last USDC has no STRK to send it anywhere with.
 *
 * The mint on Base is the user's own transaction and needs ETH there. Circle
 * does not deliver: Fast Transfer buys a faster attestation, not a delivery,
 * so somebody must call `receiveMessage` on the destination. Paying that for a
 * recipient who already holds an EVM wallet would be doing the wallet's job,
 * and the dialog says so rather than letting the gasless half imply both.
 */
export function BridgeOutButton() {
  const { session, balances, refreshBalances } = useTreasury();
  const { network, starknet, cctp, baseChain } = useNetwork();
  const { address: evmAddress, chainId, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [burnHash, setBurnHash] = useState<string | null>(null);

  const publicUsdc = balances?.usdcRaw ?? BigInt(0);

  /* Only the EVM rail can sign an outside execution - a Ready X session has no
     way to hand its gas bill to somebody else here. */
  if (session?.kind !== "evm") return null;
  const evm = session;
  const busy = step !== null;

  async function mintOnBase(message: string, attestation: string) {
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("Install MetaMask to mint on Base");
      connect({ connector, chainId: baseChain.id });
      throw new Error("Connect MetaMask on Base, then retry the mint");
    }
    if (chainId !== baseChain.id) {
      setStep(`Switch MetaMask to ${baseChain.name}`);
      await switchChainAsync({ chainId: baseChain.id });
    }
    setStep("Confirm the mint on Base - this one needs ETH for gas");
    const hash = await writeContractAsync({
      address: cctp.messageTransmitter as Address,
      abi: messageTransmitterV2Abi,
      functionName: "receiveMessage",
      args: [message as `0x${string}`, attestation as `0x${string}`],
      chainId: baseChain.id,
    });
    toast.success("USDC minted on Base", { description: hash });
  }

  async function run() {
    setError(null);
    try {
      if (!evmAddress || !chainId) {
        throw new Error("Connect the wallet that owns this account");
      }
      /* Always this wallet. A field here would only be a chance to mistype an
         address that nothing can undo once the burn lands, to serve a case the
         connected wallet already covers - it is the one signing, and it is
         where somebody cashing out wants the money. Sending elsewhere is a
         second transaction on Base, from a wallet that by then holds the USDC. */
      const destination = evmAddress;
      if (!isAddress(destination)) {
        throw new Error("That is not an Ethereum address");
      }
      const parsed = amount.trim() ? parseUsdc(amount) : publicUsdc;
      if (parsed <= BigInt(0)) throw new Error("Enter a USDC amount");
      if (parsed > publicUsdc) throw new Error("More than this account's public USDC");

      const { transactionHash } = await relayedBurnToBase({
        network,
        starknetAddress: evm.address,
        evmAddress,
        evmChainId: chainId,
        recipient: destination,
        amount: parsed,
        signTypedData: (data) => signTypedDataAsync(data as never),
        signMessage: (message) => signMessageAsync({ message }),
        onProgress: setStep,
      });
      setBurnHash(transactionHash);
      txToast({
        title: "Burn submitted on Starknet",
        txHash: transactionHash,
        explorerUrl: `${starknet.explorer}/tx/${transactionHash}`,
        explorerLabel: "Voyager",
        note: "Gas paid by MorokPay",
      });

      setStep("Waiting for Circle to attest - usually about a minute");
      const attested = await waitForAttestation(irisTransactionHash(transactionHash), {
        sourceDomain: CCTP_DOMAIN_STARKNET,
        network,
      });

      await mintOnBase(attested.message, attested.attestation);
      await refreshBalances();
      setStep(null);
      setOpen(false);
      setAmount("");
    } catch (caught) {
      setError(describeError(caught));
      setStep(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? null : setOpen(next))}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" disabled={publicUsdc <= BigInt(0)}>
            <ArrowUpRightIcon data-icon="inline-start" />
            To Base
          </Button>
        }
      />
      <DialogContent>
        <div className="flex flex-col gap-1">
          <DialogTitle>Send USDC to Base</DialogTitle>
          <DialogDescription>
            Bridged over Circle&apos;s CCTP Fast Transfer. MorokPay pays the
            Starknet side, so this works with no STRK on your account.
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/10">
            <p className="text-xs text-muted-foreground">
              Arrives on {baseChain.name} at this wallet
            </p>
            <p className="mt-1 break-all font-mono text-xs tabular-nums">
              {evmAddress ?? "Connect a wallet"}
            </p>
          </div>

          <Field>
            <FieldLabel htmlFor="bridge-amount">Amount</FieldLabel>
            <Input
              id="bridge-amount"
              inputMode="decimal"
              placeholder={formatUsdc(publicUsdc)}
              value={amount}
              disabled={busy}
              onChange={(event) => setAmount(event.target.value)}
            />
            <FieldDescription>
              Public USDC on this account: {formatUsdc(publicUsdc)}. Leave empty
              to send all of it.
            </FieldDescription>
          </Field>

          <Alert>
            <AlertTitle>The mint on Base is yours to sign</AlertTitle>
            <AlertDescription>
              Circle attests the burn but does not deliver it - the last step is
              a transaction on {baseChain.name}, so that wallet needs a little
              ETH. Nothing about this bridge is private: the amount and both
              addresses are public on each chain.
            </AlertDescription>
          </Alert>

          {burnHash ? (
            <Alert>
              <AlertTitle>Burn submitted</AlertTitle>
              <AlertDescription className="break-all font-mono text-xs">
                {burnHash}
              </AlertDescription>
            </Alert>
          ) : null}

          {step ? (
            <Alert>
              <AlertTitle className="flex items-center gap-2">
                <Spinner />
                {step}
              </AlertTitle>
              <AlertDescription>
                Leave this open until it finishes.
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Bridge stopped</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy} aria-busy={busy} onClick={() => void run()}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? "Bridging" : "Bridge to Base"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
