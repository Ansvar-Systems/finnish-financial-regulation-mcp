/**
 * search_regulations — extracted from src/index.ts by
 * scripts/apply-sector-regulator-golden-standard.py.
 *
 * Original tool name: fi_fin_search_regulations
 */

import { z } from "zod";
import { searchProvisions } from "../db.js";
import { textContent, errorContent } from "./_helpers.js";

const SearchRegulationsArgs = z.object({
  query: z.string().min(1),
  sourcebook: z.string().optional(),
  status: z.enum(["in_force", "deleted", "not_yet_in_force"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const SEARCH_REGULATIONS_TOOL = {
  name: "search_regulations",
  description: "Full-text search across Finanssivalvonta (FIN-FSA) regulatory provisions. Returns matching regulations (maaraykset), guidelines (ohjeet), and statements (kannanotot) on financial services supervision in Finland.",
  inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query in Finnish or English (e.g., 'riskienhallinta', 'tietoturva', 'AML', 'corporate governance')",
          },
          sourcebook: {
            type: "string",
            description: "Filter by sourcebook ID (e.g., FINFSA_Maaraykset, FINFSA_Ohjeet, FINFSA_Kannanotot). Optional.",
          },
          status: {
            type: "string",
            enum: ["in_force", "deleted", "not_yet_in_force"],
            description: "Filter by provision status. Defaults to all statuses.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return. Defaults to 20.",
          },
        },
        required: ["query"],
      },
};

export async function handleSearchRegulations(args: unknown) {
  const parsed = SearchRegulationsArgs.parse(args);
  const results = searchProvisions({
    query: parsed.query,
    sourcebook: parsed.sourcebook,
    status: parsed.status,
    limit: parsed.limit,
  });
  return textContent({ results, count: results.length });
}
