import { describe, expect, it } from "vitest";

import {
  parsePaymentLink,
  parsePaymentRequest,
  paymentPath,
  paymentUrl,
} from "./request";

describe("payment request", () => {
  const request = {
    network: "sepolia" as const,
    to: "0x1234",
    amount: "12.50",
    invoice: "INV-9K2M",
    label: "Coffee",
    kind: "invoice" as const,
  };

  it("round-trips query params", () => {
    const path = paymentPath(request);
    const params = new URL(path, "https://morokpay.local").searchParams;
    expect(parsePaymentRequest(params, "mainnet")).toEqual(request);
  });

  it("builds an absolute pay URL", () => {
    expect(paymentUrl("https://morok-pay-starknet.vercel.app/", request)).toBe(
      "https://morok-pay-starknet.vercel.app/pay?n=sepolia&to=0x1234&amount=12.50&inv=INV-9K2M&label=Coffee",
    );
  });

  it("parses a pasted link", () => {
    expect(parsePaymentLink(paymentPath(request), "mainnet")).toEqual(request);
  });

  it("round-trips a reusable donation request without a fixed amount", () => {
    const donation = {
      ...request,
      amount: "",
      kind: "donation" as const,
      label: "Support my channel",
    };
    expect(parsePaymentLink(paymentPath(donation), "mainnet")).toEqual(donation);
  });

  it("migrates an old private drop link to a donation", () => {
    expect(
      parsePaymentLink(
        "/pay?n=mainnet&to=0x1234&kind=drop&inv=DROP-OLD",
        "sepolia",
      ),
    ).toEqual({
      network: "mainnet",
      to: "0x1234",
      amount: "",
      invoice: "DROP-OLD",
      label: "",
      kind: "donation",
    });
  });

  it("rejects missing amount or address", () => {
    expect(
      parsePaymentRequest(new URLSearchParams("to=0x1234"), "mainnet"),
    ).toBeNull();
    expect(
      parsePaymentRequest(new URLSearchParams("amount=1"), "mainnet"),
    ).toBeNull();
  });
});
