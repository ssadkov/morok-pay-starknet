"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, FlaskConicalIcon, LogOutIcon, WalletIcon } from "lucide-react";
import { recoverTypedDataAddress, type Address } from "viem";
import { useAccount, useConnect, useDisconnect, useSignTypedData } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { shortenAddress } from "@/lib/format";
import {
  privacyKeyTypedData,
  signatureFingerprint,
} from "@/lib/privacy/eip712-test";
import { cn } from "@/lib/utils";

type TestResult = {
  firstFingerprint: string;
  secondFingerprint: string;
  recoveredAddress: Address;
  signaturesMatch: boolean;
  signerMatches: boolean;
};

export function Eip712SignatureLab() {
  const { address, chainId, connector, isConnected, status } = useAccount();
  const { connectors, connect, isPending: connecting, error: connectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);

  async function testSignatures() {
    if (!address || !chainId) return;
    setSigning(true);
    setError(null);
    setResult(null);
    try {
      const typedData = privacyKeyTypedData({
        evmAddress: address,
        evmChainId: chainId,
      });
      const first = await signTypedDataAsync(typedData);
      const firstRecovered = await recoverTypedDataAddress({
        ...typedData,
        signature: first,
      });
      const second = await signTypedDataAsync(typedData);
      const secondRecovered = await recoverTypedDataAddress({
        ...typedData,
        signature: second,
      });

      setResult({
        firstFingerprint: signatureFingerprint(first),
        secondFingerprint: signatureFingerprint(second),
        recoveredAddress: secondRecovered,
        signaturesMatch: first === second,
        signerMatches:
          firstRecovered.toLowerCase() === address.toLowerCase() &&
          secondRecovered.toLowerCase() === address.toLowerCase(),
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The EIP-712 test failed",
      );
    } finally {
      setSigning(false);
    }
  }

  const busy = signing || connecting || status === "connecting";

  return (
    <div className="min-h-full bg-background">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div className="flex items-center gap-2">
            <FlaskConicalIcon className="size-5" aria-hidden="true" />
            <span className="font-semibold">MorokPay EVM lab</span>
          </div>
          <Link
            href="/"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            Back to MorokPay
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Sepolia experiment</Badge>
            <Badge variant="outline">No transaction</Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Test deterministic EIP-712 signatures
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Connect an injected EVM wallet and approve the same typed message
            twice. MetaMask, Rabby, Brave Wallet, and other EIP-1193 wallets can
            work if they support eth_signTypedData_v4.
          </p>
        </div>

        <Alert>
          <AlertTitle>This does not create a Starknet wallet yet</AlertTitle>
          <AlertDescription>
            The test only checks whether this wallet returns repeatable valid
            signatures for a fixed privacy-key derivation request. It sends no
            transaction and costs no gas.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>1. Connect an EVM wallet</CardTitle>
            <CardDescription>
              Only the public account and chain ID are read. Seed phrases and
              private keys are never requested.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isConnected && address ? (
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Wallet</p>
                  <p className="font-medium">{connector?.name ?? "Injected wallet"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Public account</p>
                  <p className="font-mono font-medium">{shortenAddress(address)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">EVM chain ID</p>
                  <p className="font-mono font-medium">{chainId}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a browser wallet announced through injected provider
                discovery.
              </p>
            )}
            {connectError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not connect</AlertTitle>
                <AlertDescription>{connectError.message}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {!isConnected
              ? connectors.map((available) => (
                  <Button
                    type="button"
                    key={available.uid}
                    variant="outline"
                    disabled={busy}
                    onClick={() => connect({ connector: available })}
                  >
                    {busy ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <WalletIcon data-icon="inline-start" />
                    )}
                    Connect {available.name}
                  </Button>
                ))
              : null}
            {isConnected ? (
              <Button type="button" variant="ghost" onClick={() => disconnect()}>
                <LogOutIcon data-icon="inline-start" />
                Disconnect
              </Button>
            ) : null}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Sign the same request twice</CardTitle>
            <CardDescription>
              You will see two wallet confirmations. MorokPay compares the raw
              signatures in memory, then keeps only short SHA-256 fingerprints.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {result ? (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">Signature 1</p>
                    <p className="font-mono font-medium">{result.firstFingerprint}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Signature 2</p>
                    <p className="font-mono font-medium">{result.secondFingerprint}</p>
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col gap-2 text-sm">
                  <p className="flex items-center gap-2">
                    <CheckCircle2Icon
                      className={result.signerMatches ? "size-4 text-emerald-600" : "size-4 text-destructive"}
                      aria-hidden="true"
                    />
                    Both signatures recover the connected public account: {result.signerMatches ? "yes" : "no"}
                  </p>
                  <p>
                    Recovered signer: <span className="font-mono">{shortenAddress(result.recoveredAddress)}</span>
                  </p>
                  <p>
                    Signature bytes are identical: <strong>{result.signaturesMatch ? "yes" : "no"}</strong>
                  </p>
                </div>
                <Alert variant={result.signaturesMatch && result.signerMatches ? "default" : "destructive"}>
                  <AlertTitle>
                    {result.signaturesMatch && result.signerMatches
                      ? "This wallet passed the repeatability test"
                      : "Do not derive a persistent viewing key from these signatures"}
                  </AlertTitle>
                  <AlertDescription>
                    EIP-712 itself does not require byte-for-byte deterministic
                    signatures. A mismatch is a compatibility result, not proof
                    that the wallet is broken.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No signatures have been requested in this browser session.
              </p>
            )}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Signature test stopped</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              size="lg"
              disabled={!isConnected || !address || !chainId || busy}
              aria-busy={signing}
              onClick={() => void testSignatures()}
            >
              {signing ? <Spinner data-icon="inline-start" /> : null}
              {signing ? "Waiting for wallet" : "Request two test signatures"}
            </Button>
          </CardFooter>
        </Card>

        <p className="text-xs text-muted-foreground">
          Raw signatures are not rendered, logged, sent to a server, or written
          to browser storage. They necessarily exist briefly in this page&apos;s
          memory so their fingerprints and recovered signer can be checked.
        </p>
      </main>
    </div>
  );
}
