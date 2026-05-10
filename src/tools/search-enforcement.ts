/**
 * search_enforcement — extracted from src/index.ts by
 * scripts/apply-sector-regulator-golden-standard.py.
 *
 * Original tool name: fi_fin_search_enforcement
 */

import { z } from "zod";
import { searchEnforcement } from "../db.js";
import { textContent, errorContent } from "./_helpers.js";

const SearchEnforcementArgs = z.object({
  query: z.string().min(1),
  action_type: z.enum(["fine", "ban", "restriction", "warning"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const SEARCH_ENFORCEMENT_TOOL = {
  name: "search_enforcement",
  description: "Search Finanssivalvonta enforcement actions \u2014 supervisory decisions, administrative fines (hallinnolliset sanktiot), activity prohibitions, and public warnings.",
  inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g., firm name, breach type, 'rahanpesu', 'sisapiiri')",
          },
          action_type: {
            type: "string",
            enum: ["fine", "ban", "restriction", "warning"],
            description: "Filter by action type. Optional.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return. Defaults to 20.",
          },
        },
        required: ["query"],
      },
};

export async function handleSearchEnforcement(args: unknown) {
  const parsed = SearchEnforcementArgs.parse(args);
  const results = searchEnforcement({
    query: parsed.query,
    action_type: parsed.action_type,
    limit: parsed.limit,
  });
  return textContent({ results, count: results.length });
}
