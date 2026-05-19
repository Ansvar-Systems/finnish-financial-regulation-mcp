#!/usr/bin/env node

/**
 * Finnish Financial Regulation MCP — stdio entry point.
 *
 * Provides MCP tools for querying Finanssivalvonta (FIN-FSA) regulatory documents:
 * regulations (maaraykset), guidelines (ohjeet), statements (kannanotot),
 * and enforcement actions.
 *
 * Tool prefix: fi_fin_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
  checkDataFreshness,
} from "./db.js";
import { buildCitation, buildProvenanceCitation } from "./citation.js";

// Provenance attribution constants for fi_fin_* tool envelopes.
// Used by buildProvenanceCitation per spec 2026-05-18 §6.
const PROV_PUBLISHER = "Finanssivalvonta (FIN-FSA)";
const PROV_LICENSE = "FI-Statutory-PD";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "finnish-financial-regulation-mcp";

// --- Tool definitions ---

const TOOLS = [
  {
    name: "fi_fin_search_regulations",
    description:
      "Full-text search across Finanssivalvonta (FIN-FSA) regulatory provisions. Returns matching regulations (maaraykset), guidelines (ohjeet), and statements (kannanotot) on financial services supervision in Finland.",
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
  },
  {
    name: "fi_fin_get_regulation",
    description:
      "Get a specific Finanssivalvonta provision by sourcebook and reference.",
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
  },
  {
    name: "fi_fin_list_sourcebooks",
    description:
      "List all Finanssivalvonta sourcebook categories with their names and descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "fi_fin_search_enforcement",
    description:
      "Search Finanssivalvonta enforcement actions — supervisory decisions, administrative fines (hallinnolliset sanktiot), activity prohibitions, and public warnings.",
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
  },
  {
    name: "fi_fin_check_currency",
    description:
      "Check whether a specific Finanssivalvonta provision reference is currently in force.",
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
  },
  {
    name: "fi_fin_about",
    description: "Return metadata about this MCP server: version, data source, tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "fi_fin_list_sources",
    description:
      "Return provenance metadata for the Finanssivalvonta data: official source URLs, supported languages, open-data license, and coverage categories.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "fi_fin_check_data_freshness",
    description:
      "Report data freshness: latest provision effective date, latest enforcement action date, and row counts for both tables. Useful for assessing how current the local database is.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Zod schemas ---

const SearchRegulationsArgs = z.object({
  query: z.string().min(1),
  sourcebook: z.string().optional(),
  status: z.enum(["in_force", "deleted", "not_yet_in_force"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetRegulationArgs = z.object({
  sourcebook: z.string().min(1),
  reference: z.string().min(1),
});

const SearchEnforcementArgs = z.object({
  query: z.string().min(1),
  action_type: z.enum(["fine", "ban", "restriction", "warning"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const CheckCurrencyArgs = z.object({
  reference: z.string().min(1),
});

// --- Helper ---

const _META = {
  disclaimer:
    "Not legal or regulatory advice. Verify all references against primary sources at finanssivalvonta.fi before making compliance decisions.",
  copyright:
    "Data sourced from Finanssivalvonta (FIN-FSA). Official public regulatory publications.",
  source_url: "https://www.finanssivalvonta.fi/",
  data_age:
    "Database is periodically updated. Use fi_fin_check_data_freshness to inspect current data timestamps.",
};

function textContent(data: unknown) {
  const payload =
    typeof data === "object" && data !== null
      ? { ...(data as unknown as Record<string, unknown>), _meta: _META }
      : data;
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// --- Server setup ---

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "fi_fin_search_regulations": {
        const parsed = SearchRegulationsArgs.parse(args);
        const rows = searchProvisions({
          query: parsed.query,
          sourcebook: parsed.sourcebook,
          status: parsed.status,
          limit: parsed.limit,
        });
        // Per spec §6: every search result carries the provenance envelope
        // on `_citation`. Rows without source_url are skipped from citation
        // emission (No Silent Fallbacks) but still returned with row data.
        const results = rows.map((row) => {
          const rec = row as unknown as Record<string, unknown>;
          const sourceUrl =
            typeof rec["source_url"] === "string"
              ? (rec["source_url"] as string)
              : "";
          if (!sourceUrl) return rec;
          return {
            ...rec,
            _citation: buildProvenanceCitation(
              { source_url: sourceUrl },
              PROV_PUBLISHER,
              PROV_LICENSE,
            ),
          };
        });
        return textContent({ results, count: results.length });
      }

      case "fi_fin_get_regulation": {
        const parsed = GetRegulationArgs.parse(args);
        const provision = getProvision(parsed.sourcebook, parsed.reference);
        if (!provision) {
          return errorContent(
            `Provision not found: ${parsed.sourcebook} ${parsed.reference}`,
          );
        }
        const provisionRecord = provision as unknown as Record<string, unknown>;
        const sourceUrl =
          typeof provisionRecord["source_url"] === "string"
            ? (provisionRecord["source_url"] as string)
            : null;
        // Per spec §6: provenance envelope on `_citation`; deterministic
        // canonical_ref envelope on `_entity_citation` (law-mcp §4.9c).
        const out: Record<string, unknown> = {
          ...provisionRecord,
          _entity_citation: buildCitation(
            String(provisionRecord["reference"] ?? parsed.reference),
            String(
              provisionRecord["title"] ??
                `${parsed.sourcebook} ${parsed.reference}`,
            ),
            "fi_fin_get_regulation",
            { sourcebook: parsed.sourcebook, reference: parsed.reference },
            sourceUrl,
          ),
        };
        if (sourceUrl) {
          out["_citation"] = buildProvenanceCitation(
            { source_url: sourceUrl },
            PROV_PUBLISHER,
            PROV_LICENSE,
          );
        }
        return textContent(out);
      }

      case "fi_fin_list_sourcebooks": {
        const sourcebooks = listSourcebooks();
        return textContent({ sourcebooks, count: sourcebooks.length });
      }

      case "fi_fin_search_enforcement": {
        const parsed = SearchEnforcementArgs.parse(args);
        const rows = searchEnforcement({
          query: parsed.query,
          action_type: parsed.action_type,
          limit: parsed.limit,
        });
        const results = rows.map((row) => {
          const rec = row as unknown as Record<string, unknown>;
          const sourceUrl =
            typeof rec["source_url"] === "string"
              ? (rec["source_url"] as string)
              : "";
          if (!sourceUrl) return rec;
          return {
            ...rec,
            _citation: buildProvenanceCitation(
              { source_url: sourceUrl },
              PROV_PUBLISHER,
              PROV_LICENSE,
            ),
          };
        });
        return textContent({ results, count: results.length });
      }

      case "fi_fin_check_currency": {
        const parsed = CheckCurrencyArgs.parse(args);
        const currency = checkProvisionCurrency(parsed.reference);
        return textContent(currency);
      }

      case "fi_fin_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "Finanssivalvonta (FIN-FSA) MCP server. Provides access to Finnish financial supervision regulations (maaraykset), guidelines (ohjeet), statements (kannanotot), and enforcement actions.",
          data_source: "Finanssivalvonta (https://www.finanssivalvonta.fi/)",
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      case "fi_fin_list_sources": {
        return textContent({
          jurisdiction: "FI",
          authority: "Finanssivalvonta (Finnish Financial Supervisory Authority)",
          authority_url: "https://www.finanssivalvonta.fi/",
          regulation_index_url:
            "https://www.finanssivalvonta.fi/en/regulation/FIN-FSA-regulations/",
          enforcement_url:
            "https://www.finanssivalvonta.fi/en/about-the-fin-fsa/powers-and-funding/powers-and-authority/supervisory-measures/",
          languages: ["fi", "sv", "en"],
          license: "Public regulatory publications — open for research use",
          coverage_categories: [
            "FINFSA_Maaraykset — Binding regulations (maaraykset)",
            "FINFSA_Ohjeet — Supervisory guidelines (ohjeet)",
            "FINFSA_Kannanotot — Regulatory statements (kannanotot)",
            "enforcement_actions — Supervisory decisions and administrative sanctions",
          ],
          coverage_notes:
            "Coverage may be incomplete. Always verify against primary sources at finanssivalvonta.fi.",
        });
      }

      case "fi_fin_check_data_freshness": {
        return textContent(checkDataFreshness());
      }

      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`);
  }
});

// --- Main ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
