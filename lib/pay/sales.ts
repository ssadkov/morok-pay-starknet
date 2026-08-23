import { parseUsdc } from "@/lib/amount";

import type { MerchantInvoice } from "./invoices";

export type ProductSales = {
  product: string;
  count: number;
  revenueRaw: bigint;
};

export type SalesSummary = {
  paidCount: number;
  fulfilledCount: number;
  revenueRaw: bigint;
  products: ProductSales[];
};

export function summarizeSales(sales: MerchantInvoice[]): SalesSummary {
  const paid = sales.filter((sale) => sale.status === "paid");
  const products = new Map<string, ProductSales>();
  let revenueRaw = BigInt(0);

  for (const sale of paid) {
    let amountRaw = BigInt(0);
    try {
      amountRaw = parseUsdc(sale.amount);
    } catch {
      // Keep malformed legacy records visible without adding them to revenue.
    }
    revenueRaw += amountRaw;
    const product = sale.label.trim() || "Unnamed product";
    const current = products.get(product) ?? {
      product,
      count: 0,
      revenueRaw: BigInt(0),
    };
    current.count += 1;
    current.revenueRaw += amountRaw;
    products.set(product, current);
  }

  return {
    paidCount: paid.length,
    fulfilledCount: paid.filter((sale) => sale.fulfilledAt).length,
    revenueRaw,
    products: Array.from(products.values()).sort(
      (left, right) => right.count - left.count || left.product.localeCompare(right.product),
    ),
  };
}
