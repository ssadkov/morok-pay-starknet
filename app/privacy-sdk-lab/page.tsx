import type { Metadata } from "next";

import { Eip712SignatureLab } from "@/components/privacy-sdk/eip712-signature-lab";

export const metadata: Metadata = {
  title: "EVM signature lab — MorokPay",
  description:
    "Test repeatable EIP-712 signatures before deriving a MorokPay Privacy SDK wallet.",
};

export default function PrivacySdkLabPage() {
  return <Eip712SignatureLab />;
}
