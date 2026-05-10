/**
 * check_currency — extracted from src/index.ts by
 * scripts/apply-sector-regulator-golden-standard.py.
 *
 * Original tool name: fi_fin_check_currency
 */

import { z } from "zod";
import { checkProvisionCurrency } from "../db.js";
import { textContent, errorContent } from "./_helpers.js";

const CheckCurrencyArgs = z.object({
  reference: z.string().min(1),
});

export const CHECK_CURRENCY_TOOL = {
  name: "check_currency",
  description: "Check whether a specific Finanssivalvonta provision reference is currently in force.",
  inputSchema: {
        type: "object" as const,
        properties: {
          reference: {
            type: "string",
            description: "Provision reference to check (e.g., 'FIVA_M_2021_01')",
          },
        },
        required: ["reference"],
      },
};

export async function handleCheckCurrency(args: unknown) {
  const parsed = CheckCurrencyArgs.parse(args);
  const currency = checkProvisionCurrency(parsed.reference);
  return textContent(currency);
}
