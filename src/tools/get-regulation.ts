/**
 * get_regulation — extracted from src/index.ts by
 * scripts/apply-sector-regulator-golden-standard.py.
 *
 * Original tool name: fi_fin_get_regulation
 */

import { z } from "zod";
import { getProvision } from "../db.js";
import { buildCitation } from "../citation.js";
import { textContent, errorContent } from "./_helpers.js";

const GetRegulationArgs = z.object({
  sourcebook: z.string().min(1),
  reference: z.string().min(1),
});

export const GET_REGULATION_TOOL = {
  name: "get_regulation",
  description: "Get a specific Finanssivalvonta provision by sourcebook and reference.",
  inputSchema: {
        type: "object" as const,
        properties: {
          sourcebook: {
            type: "string",
            description: "Sourcebook identifier (e.g., FINFSA_Maaraykset, FINFSA_Ohjeet)",
          },
          reference: {
            type: "string",
            description: "Provision reference (e.g., 'FIVA_M_2021_01', 'FIVA_O_2023_03')",
          },
        },
        required: ["sourcebook", "reference"],
      },
};

export async function handleGetRegulation(args: unknown) {
  const parsed = GetRegulationArgs.parse(args);
  const provision = getProvision(parsed.sourcebook, parsed.reference);
  if (!provision) {
    return errorContent(
      `Provision not found: ${parsed.sourcebook} ${parsed.reference}`,
    );
  }
  const provisionRecord = provision as unknown as Record<string, unknown>;
  return textContent({
    ...provisionRecord,
    _citation: buildCitation(
      String(provisionRecord.reference ?? parsed.reference),
      String(provisionRecord.title ?? `${parsed.sourcebook} ${parsed.reference}`),
      "fi_fin_get_regulation",
      { sourcebook: parsed.sourcebook, reference: parsed.reference },
      provisionRecord.url as string | undefined,
    ),
  });
}
