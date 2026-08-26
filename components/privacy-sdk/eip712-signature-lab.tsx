"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  LogOutIcon,
  RocketIcon,
  WalletIcon,
} from "lucide-react";
import {
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { RpcProvider } from "starknet";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSignTypedData,
} from "wagmi";

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
import { useNetwork } from "@/components/network-provider";
import { PublicStrkTransferLab } from "@/components/privacy-sdk/public-strk-transfer-lab";
import { Strk20RegistrationLab } from "@/components/privacy-sdk/strk20-registration-lab";
import { Strk20ShieldLab } from "@/components/privacy-sdk/strk20-shield-lab";
import { Strk20UsdcLab } from "@/components/privacy-sdk/strk20-usdc-lab";
import { shortenAddress } from "@/lib/format";
import {
  inspectEth712Account,
  OWNERSHIP_MESSAGE,
  type Eth712AccountInspection,
} from "@/lib/privacy/eth712-account";
import {
  privacyKeyTypedData,
  signatureFingerprint,
} from "@/lib/privacy/eip712-test";
import { privacySdkOf } from "@/lib/privacy/network";
import {
  bounded,
  pollTransactionReceipt,
  WALLET_SUBMISSION_TIMEOUT_MS,
} from "@/lib/starknet/transaction-confirmation";
import { cn } from "@/lib/utils";

type TestResult = {
  firstFingerprint: string;
  secondFingerprint: string;
  recoveredAddress: Address;
  signaturesMatch: boolean;
  signerMatches: boolean;
};

type OwnershipResult = {
  fingerprint: string;
  recoveredAddress: Address;
  signerMatches: boolean;
};

type DeploymentResult = {
  status: "unknown" | "pending" | "confirmed" | "failed";
  txHash?: string;
  message: string;
};

async function responseMessage(response: Response) {
  const value = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return value?.error ?? `Request failed with status ${response.status}`;
}

export function Eip712SignatureLab() {
  const { network, starknet } = useNetwork();
  const { address, chainId, connector, isConnected, status } = useAccount();
  const { connectors, connect, isPending: connecting, error: connectError } =
    useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { signMessageAsync } = useSignMessage();
  const ownershipSignature = useRef<Hex | null>(null);
  const [signing, setSigning] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [signingOwnership, setSigningOwnership] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [inspection, setInspection] =
    useState<Eth712AccountInspection | null>(null);
  const [ownership, setOwnership] = useState<OwnershipResult | null>(null);
  const [deployment, setDeployment] = useState<DeploymentResult | null>(null);
  const sdk = privacySdkOf(network);
  const isMainnet = network === "mainnet";
  const networkLabel = isMainnet ? "mainnet" : "Sepolia";

  function clearAccountState() {
    ownershipSignature.current = null;
    setOwnership(null);
    setInspection(null);
    setResult(null);
    setDeployment(null);
    setError(null);
  }

  async function inspectAccount() {
    if (!address) return;
    setInspecting(true);
    setError(null);
    setInspection(null);
    setOwnership(null);
    ownershipSignature.current = null;
    try {
      setInspection(
        await inspectEth712Account(
          address,
          new RpcProvider({ nodeUrl: starknet.rpc }),
          sdk.accountFactory,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `Could not inspect the ${networkLabel} account factory`,
      );
    } finally {
      setInspecting(false);
    }
  }

  async function testSignatures() {
    if (!address || !chainId) return;
    setSigning(true);
    setError(null);
    setResult(null);
    try {
      const typedData = privacyKeyTypedData({
        evmAddress: address,
        evmChainId: chainId,
        starknetChain: sdk.snChainName,
        privacyPool: BigInt(sdk.poolAddress),
        accountFactory: BigInt(sdk.accountFactory),
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

  async function signOwnership() {
    if (!address) return;
    setSigningOwnership(true);
    setError(null);
    setOwnership(null);
    ownershipSignature.current = null;
    try {
      const signature = await signMessageAsync({ message: OWNERSHIP_MESSAGE });
      const recoveredAddress = await recoverMessageAddress({
        message: OWNERSHIP_MESSAGE,
        signature,
      });
      const signerMatches =
        recoveredAddress.toLowerCase() === address.toLowerCase();
      if (signerMatches) ownershipSignature.current = signature;
      setOwnership({
        fingerprint: signatureFingerprint(signature),
        recoveredAddress,
        signerMatches,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The ownership signature failed",
      );
    } finally {
      setSigningOwnership(false);
    }
  }

  async function refreshDeployedAccount() {
    if (!address) return null;
    const next = await inspectEth712Account(
      address,
      new RpcProvider({ nodeUrl: starknet.rpc }),
      sdk.accountFactory,
    );
    setInspection(next);
    if (next.deployed) {
      ownershipSignature.current = null;
      const expectedClass = BigInt(next.configuredAccountClassHash);
      const deployedClass = next.deployedClassHash
        ? BigInt(next.deployedClassHash)
        : null;
      setDeployment((current) => ({
        status:
          deployedClass === expectedClass ? "confirmed" : "failed",
        txHash: current?.txHash,
        message:
          deployedClass === expectedClass
            ? "The account is deployed with the expected class. A successful factory initialization proves that the stored EVM owner authorized this deployment."
            : "The account is deployed with an unexpected class. Do not fund or use it.",
      }));
    }
    return next;
  }

  async function checkDeployment() {
    setInspecting(true);
    try {
      await refreshDeployedAccount();
    } catch (caught) {
      setDeployment((current) => ({
        status: "failed",
        txHash: current?.txHash,
        message:
          caught instanceof Error
            ? caught.message
            : `Could not read the account from ${networkLabel}`,
      }));
    } finally {
      setInspecting(false);
    }
  }

  async function deployAccount() {
    const signature = ownershipSignature.current;
    if (!address || !currentInspection || !signature) return;
    setDeploying(true);
    setError(null);
    setDeployment(null);
    try {
      const submission = await bounded(
        fetch("/api/privacy-sdk/deploy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evmAddress: address, signature, network }),
        }),
        WALLET_SUBMISSION_TIMEOUT_MS,
      );
      if (submission.status === "timed_out") {
        setDeployment({
          status: "unknown",
          message:
            "MorokPay did not return a hash within 90 seconds. Do not submit again; check deployment first because the original request may still complete.",
        });
        return;
      }
      if (!submission.value.ok) {
        throw new Error(await responseMessage(submission.value));
      }
      const submitted = (await submission.value.json()) as {
        status: "pending" | "already_deployed";
        transactionHash?: string;
        sponsoredAmount?: string;
        sponsoredBalance?: string;
      };
      if (submitted.status === "already_deployed") {
        await refreshDeployedAccount();
        return;
      }
      if (!submitted.transactionHash) {
        throw new Error("MorokPay relayer returned no transaction hash");
      }
      const txHash = submitted.transactionHash;
      setDeployment({
        status: "pending",
        txHash,
        message:
          network === "mainnet"
            ? "MorokPay submitted the factory call from the deployed address's own public STRK. Waiting for mainnet confirmation."
            : "MorokPay submitted one public transaction to fund the account to 20 STRK and deploy it. Waiting for Sepolia confirmation.",
      });

      const receipt = await pollTransactionReceipt({
        read: () =>
          new RpcProvider({ nodeUrl: starknet.rpc }).getTransactionReceipt(
            txHash,
          ),
      });
      const refreshed = await refreshDeployedAccount();
      if (refreshed?.deployed) return;
      if (receipt === "failed") {
        setDeployment({
          status: "failed",
          txHash,
          message: "The public deployment transaction failed on Starknet.",
        });
        return;
      }
      setDeployment({
        status: "pending",
        txHash,
        message:
          "The hash is known, but the account is not visible through this RPC yet. Check again before doing anything else.",
      });
    } catch (caught) {
      setDeployment({
        status: "failed",
        message:
          caught instanceof Error
            ? caught.message
            : "MorokPay failed to submit the deployment",
      });
    } finally {
      setDeploying(false);
    }
  }

  const busy =
    signing ||
    signingOwnership ||
    deploying ||
    inspecting ||
    connecting ||
    status === "connecting";
  const currentInspection =
    inspection &&
    address &&
    inspection.evmAddress.toLowerCase() === address.toLowerCase()
      ? inspection
      : null;

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
            <Badge variant="outline">{isMainnet ? "Mainnet" : "Sepolia"} experiment</Badge>
            <Badge variant="outline">MetaMask onboarding</Badge>
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
                  <p className="break-all font-mono font-medium">{address}</p>
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
                    onClick={() => {
                      clearAccountState();
                      connect({ connector: available });
                    }}
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  clearAccountState();
                  disconnect();
                }}
              >
                <LogOutIcon data-icon="inline-start" />
                Disconnect
              </Button>
            ) : null}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Resolve the deterministic Starknet account</CardTitle>
            <CardDescription>
              This is a read-only call to the live {networkLabel} AccountFactory.
              The result is derived from the connected public EVM address.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {inspecting ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner data-icon="inline-start" />
                Reading {networkLabel} factory
              </p>
            ) : currentInspection ? (
              <div className="flex flex-col gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">
                    Deterministic Starknet address
                  </p>
                  <p className="break-all font-mono font-medium">
                    {currentInspection.starknetAddress}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">Deployment state</p>
                    <p className="font-medium">
                      {currentInspection.deployed
                        ? "Already deployed"
                        : "Not deployed"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Account class</p>
                    <p className="break-all font-mono font-medium">
                      {currentInspection.configuredAccountClassHash}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Factory: {currentInspection.factoryAddress} · class {" "}
                  {currentInspection.factoryClassHash}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect an EVM wallet to calculate its Starknet account.
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!address || busy}
              aria-busy={inspecting}
              onClick={() => void inspectAccount()}
            >
              {inspecting ? <Spinner data-icon="inline-start" /> : null}
              {inspecting
                ? `Reading ${networkLabel} factory`
                : "Resolve Starknet account"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Prove EVM ownership for one-time deployment</CardTitle>
            <CardDescription>
              MetaMask signs the exact fixed message expected by
              StarknetEth712Account. This is not a transaction and costs no
              gas.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-xl border bg-muted/40 p-3 font-mono text-sm">
              {OWNERSHIP_MESSAGE}
            </div>
            {ownership ? (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  Ownership fingerprint: {" "}
                  <span className="font-mono">{ownership.fingerprint}</span>
                </p>
                <p>
                  Recovered signer: {" "}
                  <span className="font-mono">
                    {shortenAddress(ownership.recoveredAddress)}
                  </span>
                </p>
                <Alert
                  variant={ownership.signerMatches ? "default" : "destructive"}
                >
                  <AlertTitle>
                    {ownership.signerMatches
                      ? "Ownership signature is ready in memory"
                      : "Recovered signer does not match"}
                  </AlertTitle>
                  <AlertDescription>
                    {ownership.signerMatches
                      ? "It has not been submitted. Reloading or disconnecting discards it."
                      : "Do not deploy an account with this signature."}
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No ownership signature has been requested.
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              size="lg"
              disabled={
                !currentInspection || currentInspection.deployed || busy
              }
              aria-busy={signingOwnership}
              onClick={() => void signOwnership()}
            >
              {signingOwnership ? <Spinner data-icon="inline-start" /> : null}
              {currentInspection?.deployed
                ? "Account already deployed"
                : signingOwnership
                  ? "Waiting for MetaMask"
                  : "Request ownership signature"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              4.{" "}
              {isMainnet
                ? "Deploy the self-funded Starknet account"
                : "Create the sponsored Starknet account"}
            </CardTitle>
            <CardDescription>
              {isMainnet
                ? "The generated address must already hold public STRK before this step - MorokPay does not top it up on mainnet. The relayer only submits the factory call and pays its own gas."
                : "MorokPay uses one public Sepolia transaction to fund the deterministic address to 20 STRK and deploy it through the AccountFactory."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Generated account</p>
                <p className="break-all font-mono font-medium">
                  {currentInspection?.starknetAddress ?? "Resolve step 2 first"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Public gas payer</p>
                <p className="break-all font-mono font-medium">
                  Dedicated MorokPay {networkLabel} relayer
                </p>
              </div>
            </div>
            {isMainnet ? (
              <Alert variant="destructive">
                <AlertTitle>Fund this address first</AlertTitle>
                <AlertDescription>
                  Send at least 15 STRK of real public STRK to the generated
                  account above before deploying - it pays the mainnet pool fee
                  and gas for the registration step that follows. This is real
                  money; MorokPay never sends it for you on mainnet.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertTitle>20 test STRK, ownership stays with MetaMask</AlertTitle>
                <AlertDescription>
                  The sponsored balance and deployment are public. The
                  ownership signature fixes the EVM owner; the MorokPay
                  relayer never becomes the generated account or its owner.
                </AlertDescription>
              </Alert>
            )}
            {deployment ? (
              <Alert
                variant={
                  deployment.status === "failed" ? "destructive" : "default"
                }
              >
                <AlertTitle>Deployment {deployment.status}</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <span>{deployment.message}</span>
                  {deployment.txHash ? (
                    <a
                      href={`${starknet.explorer}/tx/${deployment.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono underline underline-offset-4"
                    >
                      {deployment.txHash}
                      <ExternalLinkIcon className="size-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              disabled={
                busy ||
                !currentInspection ||
                currentInspection.deployed ||
                !ownership?.signerMatches ||
                !ownershipSignature.current ||
                deployment?.status === "unknown" ||
                deployment?.status === "pending"
              }
              aria-busy={deploying}
              onClick={() => void deployAccount()}
            >
              {deploying ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RocketIcon data-icon="inline-start" />
              )}
              {deploying
                ? "Deploying"
                : isMainnet
                  ? "Deploy (self-funded)"
                  : "Get 20 STRK and deploy"}
            </Button>
            {deployment?.status === "unknown" ||
            deployment?.status === "pending" ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy || !address}
                onClick={() => void checkDeployment()}
              >
                {inspecting ? `Checking ${networkLabel}` : "Check deployment"}
              </Button>
            ) : null}
          </CardFooter>
        </Card>

        <PublicStrkTransferLab
          key={`${currentInspection?.starknetAddress ?? "none"}:${address ?? "none"}:${chainId ?? "none"}`}
          inspection={currentInspection}
        />

        <Card>
          <CardHeader>
            <CardTitle>6. Sign the same request twice</CardTitle>
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

        <Strk20RegistrationLab
          key={`strk20:${currentInspection?.starknetAddress ?? "none"}:${address ?? "none"}:${chainId ?? "none"}`}
          inspection={currentInspection}
          signatureTestPassed={Boolean(
            result?.signaturesMatch && result.signerMatches,
          )}
          onAccountChanged={refreshDeployedAccount}
        />

        <Strk20ShieldLab
          key={`strk20-shield:${currentInspection?.starknetAddress ?? "none"}:${address ?? "none"}:${chainId ?? "none"}`}
          inspection={currentInspection}
        />

        <Strk20UsdcLab
          key={`strk20-usdc:${currentInspection?.starknetAddress ?? "none"}:${address ?? "none"}:${chainId ?? "none"}`}
          inspection={currentInspection}
        />

        <p className="text-xs text-muted-foreground">
          Raw privacy-key signatures are not rendered, logged, sent to a server,
          or written to browser storage. The separate ownership signature is
          sent to the MorokPay onboarding routes and AccountFactory, but is not
          persisted by this page or intentionally logged by the server.
        </p>
      </main>
    </div>
  );
}
