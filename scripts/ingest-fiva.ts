#!/usr/bin/env npx tsx
/**
 * Ingestion crawler for Finanssivalvonta (FIN-FSA) regulatory data.
 *
 * Crawls finanssivalvonta.fi to populate the MCP database with:
 *   1. Regulations & guidelines (määräykset ja ohjeet) — provisions table
 *   2. Enforcement actions (valvontatoimet, seuraamusmaksut) — enforcement_actions table
 *
 * Usage:
 *   npx tsx scripts/ingest-fiva.ts                 # full crawl
 *   npx tsx scripts/ingest-fiva.ts --resume        # skip already-ingested references
 *   npx tsx scripts/ingest-fiva.ts --dry-run       # fetch and parse but do not write DB
 *   npx tsx scripts/ingest-fiva.ts --force         # drop existing data and re-crawl
 *   npx tsx scripts/ingest-fiva.ts --resume --dry-run  # combinable flags
 */

import Database from "better-sqlite3";
import * as cheerio from "cheerio";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["FINFSA_DB_PATH"] ?? "data/finfsa.db";

const BASE_URL = "https://www.finanssivalvonta.fi";
const REGULATIONS_INDEX = `${BASE_URL}/en/regulation/FIN-FSA-regulations/`;
const ENFORCEMENT_URL = `${BASE_URL}/en/about-the-fin-fsa/powers-and-funding/powers-and-authority/supervisory-measures/`;

const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 3000;
const REQUEST_TIMEOUT_MS = 30_000;

// Regulation category paths as discovered on the index page.
// These are the known top-level accordion sections. The crawler also
// discovers any new categories dynamically from the index page.
const KNOWN_CATEGORY_PATHS: Record<string, string> = {
  "commencement-of-activities": "Commencement of Activities",
  "organisation-of-supervised-entities-operations": "Organisation of Operations",
  "risk-management": "Risk Management",
  "accounting-financial-statements-and-management-report":
    "Accounting, Financial Statements and Management Report",
  "capital-adequacy": "Capital Adequacy",
  "code-of-conduct": "Conduct of Business",
  "operations-of-securities-markets": "Securities Market Operations",
  "insurance-operations": "Insurance Operations",
  "miscellaneous-regulations-and-guidelines": "Miscellaneous",
};

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FLAG_RESUME = args.includes("--resume");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_FORCE = args.includes("--force");

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

function warn(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.warn(`[${ts}] WARN: ${msg}`);
}

function error(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.error(`[${ts}] ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// HTTP with retry + rate limiting
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      lastRequestTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "AnsvarBot/1.0 (compliance-research; contact: hello@ansvar.ai)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en,fi;q=0.9",
        },
      });
      clearTimeout(timeout);

      if (resp.status === 429) {
        const retryAfter = parseInt(resp.headers.get("Retry-After") ?? "10", 10);
        warn(`Rate limited (429) on ${url} — waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }

      return resp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS * attempt;
        warn(
          `Attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${lastError.message} — retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
  }

  throw new Error(
    `Failed after ${MAX_RETRIES} attempts for ${url}: ${lastError?.message}`,
  );
}

async function fetchHtml(url: string): Promise<cheerio.CheerioAPI> {
  const resp = await rateLimitedFetch(url);
  const html = await resp.text();
  return cheerio.load(html);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Database bootstrap
// ---------------------------------------------------------------------------

function initDb(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (FLAG_FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    log(`Deleted existing database (--force)`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------------------------------------------------------------------------
// Sourcebook definitions
// ---------------------------------------------------------------------------

interface SourcebookDef {
  id: string;
  name: string;
  description: string;
}

const SOURCEBOOKS: SourcebookDef[] = [
  {
    id: "FINFSA_MAARAYKSET",
    name: "Finanssivalvonnan Määräykset (Regulations)",
    description:
      "Binding regulations (määräykset) issued by Finanssivalvonta under authority delegated by Finnish financial services legislation.",
  },
  {
    id: "FINFSA_OHJEET",
    name: "Finanssivalvonnan Ohjeet (Guidelines)",
    description:
      "Supervisory guidelines (ohjeet) issued by Finanssivalvonta, implementing EBA, ESMA, and EIOPA guidelines in Finland.",
  },
  {
    id: "FINFSA_KANNANOTOT",
    name: "Finanssivalvonnan Kannanotot (Statements)",
    description:
      "Supervisory statements (kannanotot) by Finanssivalvonta setting out interpretive positions and supervisory expectations.",
  },
  {
    id: "FINFSA_VALVONTATOIMET",
    name: "Finanssivalvonnan Valvontatoimet (Supervisory Measures)",
    description:
      "Enforcement actions, administrative sanctions, penalty payments, and public warnings issued by Finanssivalvonta.",
  },
];

function ensureSourcebooks(db: Database.Database): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
  );
  for (const sb of SOURCEBOOKS) {
    stmt.run(sb.id, sb.name, sb.description);
  }
  log(`Ensured ${SOURCEBOOKS.length} sourcebooks`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegulationLink {
  /** Relative path, e.g. /en/regulation/FIN-FSA-regulations/risk-management/08_2014/ */
  path: string;
  /** Display title from the index page */
  title: string;
  /** Category slug */
  category: string;
  /** Category display name */
  categoryName: string;
}

interface ParsedRegulation {
  reference: string;
  title: string;
  text: string;
  type: "regulation" | "guideline";
  status: string;
  effectiveDate: string | null;
  chapter: string | null;
  section: string | null;
  category: string;
  pdfUrl: string | null;
  /** Authoritative finanssivalvonta.fi detail-page URL for this provision. */
  sourceUrl: string;
}

interface ParsedEnforcement {
  firmName: string;
  referenceNumber: string | null;
  actionType: string;
  amount: number | null;
  date: string | null;
  summary: string;
  sourcebookReferences: string | null;
  pressReleaseUrl: string | null;
}

// ---------------------------------------------------------------------------
// Phase 1: Discover regulation links from the index page
// ---------------------------------------------------------------------------

async function discoverRegulations(): Promise<RegulationLink[]> {
  log(`Fetching regulation index: ${REGULATIONS_INDEX}`);
  const $ = await fetchHtml(REGULATIONS_INDEX);

  const links: RegulationLink[] = [];

  // The index page uses an accordion. Each category section contains <a> links
  // to individual regulation detail pages.
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Match regulation detail page URLs:
    //   /en/regulation/FIN-FSA-regulations/{category}/{slug}/
    const match = href.match(
      /^\/en\/regulation\/FIN-FSA-regulations\/([^/]+)\/([^/]+)\/?$/,
    );
    if (!match) return;

    const categorySlug = match[1]!;
    const title = $(el).text().trim();
    if (!title) return;

    // Skip if it looks like a PDF link
    if (href.endsWith(".pdf")) return;

    const categoryName =
      KNOWN_CATEGORY_PATHS[categorySlug] ?? slugToTitle(categorySlug);

    links.push({
      path: href,
      title,
      category: categorySlug,
      categoryName,
    });
  });

  // Deduplicate by path
  const seen = new Set<string>();
  const unique = links.filter((l) => {
    if (seen.has(l.path)) return false;
    seen.add(l.path);
    return true;
  });

  log(`Discovered ${unique.length} regulation links across ${new Set(unique.map((l) => l.category)).size} categories`);
  return unique;
}

function slugToTitle(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Phase 2: Parse individual regulation pages
// ---------------------------------------------------------------------------

async function parseRegulationPage(
  link: RegulationLink,
): Promise<ParsedRegulation[]> {
  const url = `${BASE_URL}${link.path}`;
  log(`  Parsing regulation: ${link.title} (${url})`);

  const $ = await fetchHtml(url);
  const results: ParsedRegulation[] = [];

  // Extract reference number from the path or title.
  // Paths like /08_2014/ or /02_2023/ map to references like "8/2014" or "2/2023".
  // Some use descriptive slugs instead — extract from title.
  const pathSlug = link.path.split("/").filter(Boolean).pop() ?? "";
  const refFromPath = parseReferenceFromSlug(pathSlug);
  const refFromTitle = parseReferenceFromTitle(link.title);
  const reference = refFromPath ?? refFromTitle ?? `FIVA_${pathSlug}`;

  // Title: prefer the <h1> on the detail page, fall back to index title
  const pageTitle = $("h1").first().text().trim() || link.title;

  // Status and effective date
  const bodyText = $("body").text();
  const validFromMatch = bodyText.match(
    /[Vv]alid\s+from[:\s]*(\d{1,2}\s+\w+\s+\d{4})/,
  );
  const effectiveDate = validFromMatch
    ? parseDate(validFromMatch[1]!)
    : null;
  const status = bodyText.includes("repealed") || bodyText.includes("kumottu")
    ? "repealed"
    : "in_force";

  // Determine type: "regulation" if title/body mentions Regulation/Määräys,
  // otherwise "guideline"
  const lowerTitle = pageTitle.toLowerCase();
  const isRegulation =
    lowerTitle.includes("regulation") ||
    lowerTitle.includes("määräys") ||
    lowerTitle.includes("maarays");
  const type: "regulation" | "guideline" = isRegulation
    ? "regulation"
    : "guideline";

  // Extract the main content text. The page body area after the h1 and before
  // footers contains the regulation description, linked guidelines, and metadata.
  // We scrape the text from .page-content, .regulation-content, or main article area.
  const contentSelectors = [
    ".regulation-content",
    ".page-content",
    "#page-main-content",
    "article",
    "main",
  ];

  let contentText = "";
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      contentText = el.text().trim();
      break;
    }
  }

  // Strip navigation noise, cookie banners, menu text
  contentText = cleanBodyText(contentText);

  // If content is too thin, use the index title + page title as description
  if (contentText.length < 50) {
    contentText = `${pageTitle}. ${link.title}`;
  }

  // Find PDF links for the regulation document
  let pdfUrl: string | null = null;
  $("a[href$='.pdf']").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // Prefer English PDF
    if (href.includes("_en") || href.includes("/en/")) {
      pdfUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    } else if (!pdfUrl) {
      pdfUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    }
  });

  // Extract referenced EBA/ESMA guidelines and EU regulations from links
  const euReferences: string[] = [];
  $("a[href]").each((_i, el) => {
    const text = $(el).text().trim();
    if (
      text.match(/EBA\/GL\/\d{4}\/\d+/) ||
      text.match(/ESMA\/\d{4}\/\d+/) ||
      text.match(/EIOPA-BoS-\d{2}\/\d+/) ||
      text.match(/\(EU\)\s*(No\s*)?\d{4}\/\d+/) ||
      text.match(/Regulation\s*\(EU\)/)
    ) {
      euReferences.push(text);
    }
  });

  // Build the full text for the provision, incorporating EU references
  let fullText = contentText;
  if (euReferences.length > 0) {
    fullText += `\n\nReferenced EU instruments: ${euReferences.join("; ")}`;
  }

  // Limit text length to avoid bloating the DB with navigation fragments
  if (fullText.length > 15_000) {
    fullText = fullText.slice(0, 15_000) + "...";
  }

  results.push({
    reference,
    title: pageTitle,
    text: fullText,
    type,
    status,
    effectiveDate,
    chapter: link.categoryName,
    section: null,
    category: link.category,
    pdfUrl,
    sourceUrl: url,
  });

  return results;
}

function parseReferenceFromSlug(slug: string): string | null {
  // Pattern: "08_2014" → "8/2014", "02_2023" → "2/2023"
  const m = slug.match(/^0?(\d+)_(\d{4})$/);
  if (m) return `${m[1]}/${m[2]}`;
  return null;
}

function parseReferenceFromTitle(title: string): string | null {
  // Pattern: "Regulations and guidelines 8/2014" or "2/2023"
  const m = title.match(/(\d{1,3})\/(\d{4})/);
  if (m) return `${m[1]}/${m[2]}`;
  return null;
}

function parseDate(dateStr: string): string | null {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function cleanBodyText(text: string): string {
  return (
    text
      // Collapse whitespace
      .replace(/\s+/g, " ")
      // Remove common navigation/cookie text fragments
      .replace(/We use cookies.*?accept/gi, "")
      .replace(/Skip to (main )?content/gi, "")
      .replace(/Frontpage.*?FIN-FSA regulations/gi, "")
      .replace(/Share.*?(Twitter|LinkedIn|BlueSky|Facebook)/gi, "")
      .replace(/Updated\s+\d{1,2}\s+\w+\s+\d{4}/gi, "")
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Phase 3: Crawl enforcement actions from supervisory measures page
// ---------------------------------------------------------------------------

async function crawlEnforcementActions(): Promise<ParsedEnforcement[]> {
  log(`Fetching enforcement actions: ${ENFORCEMENT_URL}`);
  const $ = await fetchHtml(ENFORCEMENT_URL);

  const actions: ParsedEnforcement[] = [];

  // The supervisory measures page has a table with Date, Decision, Legal validity columns.
  // Each row has a link to a press release with details.
  $("table tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const dateText = $(cells[0]).text().trim();
    const decisionCell = $(cells[1]);
    const decisionText = decisionCell.text().trim();
    const decisionLink = decisionCell.find("a").attr("href") ?? null;

    if (!decisionText || !dateText) return;

    const parsed = parseEnforcementEntry(dateText, decisionText, decisionLink);
    if (parsed) {
      actions.push(parsed);
    }
  });

  log(`Found ${actions.length} enforcement entries in table`);

  // Enrich entries by fetching individual press release pages
  const enrichedActions: ParsedEnforcement[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    log(
      `  Enriching enforcement ${i + 1}/${actions.length}: ${action.firmName}`,
    );

    if (action.pressReleaseUrl) {
      try {
        const enriched = await enrichEnforcementFromPressRelease(action);
        enrichedActions.push(enriched);
      } catch (err) {
        warn(
          `Failed to enrich ${action.firmName}: ${err instanceof Error ? err.message : String(err)}`,
        );
        enrichedActions.push(action);
      }
    } else {
      enrichedActions.push(action);
    }
  }

  return enrichedActions;
}

function parseEnforcementEntry(
  dateText: string,
  decisionText: string,
  link: string | null,
): ParsedEnforcement | null {
  // Parse the date (format: "6 Nov 2025" or "23 May 2025")
  const date = parseDate(dateText);

  // Extract firm name — usually the first entity mentioned
  // Decision text patterns:
  //   "Combined penalty payment of EUR 7,670,000 and public warning for S-Bank Plc"
  //   "Penalty payment of EUR 15,000 to Alami Services Oy"
  //   "Administrative fine imposed on Keva"
  const firmName = extractFirmName(decisionText);

  // Extract amount
  const amount = extractAmount(decisionText);

  // Determine action type
  const actionType = classifyActionType(decisionText);

  // Build press release URL
  const pressReleaseUrl =
    link && !link.startsWith("http") ? `${BASE_URL}${link}` : link;

  return {
    firmName: firmName || decisionText.slice(0, 100),
    referenceNumber: null,
    actionType,
    amount,
    date,
    summary: decisionText,
    sourcebookReferences: null,
    pressReleaseUrl,
  };
}

function extractFirmName(text: string): string {
  // Try "for {name}" pattern
  const forMatch = text.match(
    /(?:for|to)\s+(.+?)(?:\s+for\s+(?:failures|omissions|breaches|violations|late)|$)/i,
  );
  if (forMatch) {
    let name = forMatch[1]!.trim();
    // Remove trailing clause starters
    name = name.replace(
      /\s+(?:for|due|regarding|in respect|relating).*$/i,
      "",
    );
    return name;
  }

  // Try "imposed on {name}" pattern
  const onMatch = text.match(/imposed\s+on\s+(.+?)(?:\s+for\s|$)/i);
  if (onMatch) return onMatch[1]!.trim();

  // Try "{Name} Oy/Oyj/Plc/Ltd" pattern
  const companyMatch = text.match(
    /([A-Z][A-Za-zÀ-ÿ\s-]+(?:Oy|Oyj|Plc|Ltd|Ab|osk|coop)[A-Za-z]*)/,
  );
  if (companyMatch) return companyMatch[1]!.trim();

  // Fallback: use first 80 chars
  return text.slice(0, 80).trim();
}

function extractAmount(text: string): number | null {
  // Match EUR amounts: "EUR 7,670,000" or "EUR 15,000" or "EUR 500,000"
  const m = text.match(/EUR\s+([\d,]+)/i);
  if (!m) return null;
  return parseInt(m[1]!.replace(/,/g, ""), 10) || null;
}

function classifyActionType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("administrative fine")) return "administrative_fine";
  if (lower.includes("public warning") && lower.includes("penalty"))
    return "penalty_and_warning";
  if (lower.includes("public warning")) return "public_warning";
  if (lower.includes("penalty payment") || lower.includes("penalty"))
    return "penalty_payment";
  if (lower.includes("prohibition")) return "prohibition";
  if (lower.includes("authorisation") && lower.includes("withdraw"))
    return "authorisation_withdrawal";
  if (lower.includes("authorised representative") || lower.includes("authorized representative"))
    return "authorised_representative";
  if (lower.includes("registration") && lower.includes("withdraw"))
    return "registration_withdrawal";
  if (lower.includes("conditional fine")) return "conditional_fine";
  if (lower.includes("restriction")) return "restriction";
  return "other";
}

async function enrichEnforcementFromPressRelease(
  action: ParsedEnforcement,
): Promise<ParsedEnforcement> {
  if (!action.pressReleaseUrl) return action;

  const $ = await fetchHtml(action.pressReleaseUrl);

  // Extract the press release body text
  const contentSelectors = [
    ".page-content",
    "#page-main-content",
    "article",
    "main",
  ];

  let bodyText = "";
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      bodyText = el.text().trim();
      break;
    }
  }

  bodyText = cleanBodyText(bodyText);

  if (bodyText.length > 50) {
    // Use richer text as summary (truncated)
    action.summary =
      bodyText.length > 3000 ? bodyText.slice(0, 3000) + "..." : bodyText;
  }

  // Try to extract FIN-FSA reference number (Dnro / Journal Number)
  const refMatch = bodyText.match(
    /(?:FIVA|Dnro|Journal\s+Number)[/\s]*([\d/]+)/i,
  );
  if (refMatch) {
    action.referenceNumber = `FIVA/${refMatch[1]}`;
  }

  // Try to extract referenced regulations
  const regRefs: string[] = [];
  const regMatches = bodyText.matchAll(
    /(?:Regulations?\s+(?:and\s+guidelines?\s+)?)(\d{1,2}\/\d{4})/gi,
  );
  for (const m of regMatches) {
    if (m[1]) regRefs.push(m[1]);
  }
  if (regRefs.length > 0) {
    action.sourcebookReferences = regRefs.join(", ");
  }

  // Re-extract amount if not found earlier
  if (action.amount === null) {
    action.amount = extractAmount(bodyText);
  }

  return action;
}

// ---------------------------------------------------------------------------
// Phase 4: Crawl supervision releases for statements (kannanotot)
// ---------------------------------------------------------------------------

async function crawlSupervisionReleases(): Promise<ParsedRegulation[]> {
  const results: ParsedRegulation[] = [];
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

  for (const year of years) {
    const url = `${BASE_URL}/en/publications-and-press-releases/supervision-releases/${year}/`;
    log(`Fetching supervision releases for ${year}: ${url}`);

    let $: cheerio.CheerioAPI;
    try {
      $ = await fetchHtml(url);
    } catch (err) {
      warn(
        `Could not fetch supervision releases for ${year}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    // Supervision release pages list articles with links.
    // We look for entries that relate to regulations, guidelines, or statements.
    const releaseLinks: Array<{ href: string; title: string }> = [];

    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (!href || !text) return;

      // Match supervision release links
      if (
        href.includes("/supervision-releases/") &&
        href.includes(`/${year}/`) &&
        text.length > 20
      ) {
        // Filter to regulatory-relevant releases
        const lower = text.toLowerCase();
        if (
          lower.includes("regulation") ||
          lower.includes("guideline") ||
          lower.includes("määräy") ||
          lower.includes("ohje") ||
          lower.includes("kannano") ||
          lower.includes("statement") ||
          lower.includes("position") ||
          lower.includes("interpretation") ||
          lower.includes("requirement") ||
          lower.includes("enter into force") ||
          lower.includes("amendment") ||
          lower.includes("supervisory") ||
          lower.includes("thematic review") ||
          lower.includes("risk assessment")
        ) {
          const fullHref = href.startsWith("http")
            ? href
            : `${BASE_URL}${href}`;
          releaseLinks.push({ href: fullHref, title: text });
        }
      }
    });

    // Deduplicate
    const seen = new Set<string>();
    const uniqueLinks = releaseLinks.filter((l) => {
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    });

    log(
      `  Found ${uniqueLinks.length} regulatory supervision releases for ${year}`,
    );

    for (const link of uniqueLinks) {
      try {
        const release = await parseSupervisionRelease(link.href, link.title, year);
        if (release) results.push(release);
      } catch (err) {
        warn(
          `Failed to parse release "${link.title}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  log(`Parsed ${results.length} supervision release statements`);
  return results;
}

async function parseSupervisionRelease(
  url: string,
  indexTitle: string,
  year: number,
): Promise<ParsedRegulation | null> {
  const $ = await fetchHtml(url);

  const pageTitle = $("h1").first().text().trim() || indexTitle;

  const contentSelectors = [
    ".page-content",
    "#page-main-content",
    "article",
    "main",
  ];

  let bodyText = "";
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      bodyText = el.text().trim();
      break;
    }
  }

  bodyText = cleanBodyText(bodyText);

  if (bodyText.length < 80) return null;

  // Truncate very long releases
  if (bodyText.length > 8000) {
    bodyText = bodyText.slice(0, 8000) + "...";
  }

  // Generate a reference based on title and year
  const refFromTitle = parseReferenceFromTitle(pageTitle);
  const slug = url.split("/").filter(Boolean).pop() ?? "";
  const reference =
    refFromTitle ??
    `FIVA_SR_${year}_${slug.slice(0, 40).replace(/[^a-z0-9-]/gi, "_")}`;

  // Parse date from page
  const dateMatch = bodyText.match(/(\d{1,2}\s+\w+\s+\d{4})/);
  const effectiveDate = dateMatch ? parseDate(dateMatch[1]!) : `${year}-01-01`;

  return {
    reference,
    title: pageTitle,
    text: bodyText,
    type: "guideline",
    status: "in_force",
    effectiveDate,
    chapter: "Supervision Releases",
    section: String(year),
    category: "supervision-releases",
    pdfUrl: null,
    sourceUrl: url,
  };
}

// ---------------------------------------------------------------------------
// Database write operations
// ---------------------------------------------------------------------------

function getExistingReferences(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT reference FROM provisions")
    .all() as Array<{ reference: string }>;
  return new Set(rows.map((r) => r.reference));
}

function getExistingEnforcementFirms(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT firm_name || '|' || COALESCE(date, '') as key FROM enforcement_actions")
    .all() as Array<{ key: string }>;
  return new Set(rows.map((r) => r.key));
}

function insertProvisions(
  db: Database.Database,
  provisions: ParsedRegulation[],
  existingRefs: Set<string>,
): { inserted: number; skipped: number } {
  const stmt = db.prepare(`
    INSERT INTO provisions (sourcebook_id, reference, source_url, title, text, type, status, effective_date, chapter, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let skipped = 0;

  const txn = db.transaction(() => {
    for (const p of provisions) {
      if (FLAG_RESUME && existingRefs.has(p.reference)) {
        skipped++;
        continue;
      }

      // Determine sourcebook based on type and category
      let sourcebookId: string;
      if (p.category === "supervision-releases") {
        sourcebookId = "FINFSA_KANNANOTOT";
      } else if (p.type === "regulation") {
        sourcebookId = "FINFSA_MAARAYKSET";
      } else {
        sourcebookId = "FINFSA_OHJEET";
      }

      stmt.run(
        sourcebookId,
        p.reference,
        p.sourceUrl,
        p.title,
        p.text,
        p.type,
        p.status,
        p.effectiveDate,
        p.chapter,
        p.section,
      );
      inserted++;
    }
  });

  txn();
  return { inserted, skipped };
}

/**
 * Drop low-signal rows where the firm-name extractor failed to find a real
 * counterparty: identical firm_name and summary (the extractor fell through
 * to "first 80 chars of summary") or sub-4-char firm names. Observed on
 * v1.0.0 of the sample DB as the 1/103 "Decision/Decision/other" class.
 */
function isWellFormedEnforcement(a: ParsedEnforcement): boolean {
  if (!a.firmName || a.firmName.length < 4) return false;
  if (a.firmName.trim() === a.summary.trim()) return false;
  return true;
}

function insertEnforcementActions(
  db: Database.Database,
  actions: ParsedEnforcement[],
  existingKeys: Set<string>,
): { inserted: number; skipped: number; dropped: number } {
  const stmt = db.prepare(`
    INSERT INTO enforcement_actions (firm_name, source_url, reference_number, action_type, amount, date, summary, sourcebook_references)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let skipped = 0;
  let dropped = 0;

  const txn = db.transaction(() => {
    for (const a of actions) {
      if (!isWellFormedEnforcement(a)) {
        dropped++;
        continue;
      }
      const key = `${a.firmName}|${a.date ?? ""}`;
      if (FLAG_RESUME && existingKeys.has(key)) {
        skipped++;
        continue;
      }

      stmt.run(
        a.firmName,
        a.pressReleaseUrl,
        a.referenceNumber,
        a.actionType,
        a.amount,
        a.date,
        a.summary,
        a.sourcebookReferences,
      );
      inserted++;
    }
  });

  txn();
  return { inserted, skipped, dropped };
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

class ProgressTracker {
  private total: number;
  private current = 0;
  private startTime: number;
  private phase: string;

  constructor(phase: string, total: number) {
    this.phase = phase;
    this.total = total;
    this.startTime = Date.now();
  }

  tick(label: string): void {
    this.current++;
    const pct = ((this.current / this.total) * 100).toFixed(1);
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    const remaining =
      this.current > 0
        ? (
            ((Date.now() - this.startTime) / this.current) *
            (this.total - this.current) /
            1000
          ).toFixed(0)
        : "?";
    log(
      `[${this.phase}] ${this.current}/${this.total} (${pct}%) — ${label} — ${elapsed}s elapsed, ~${remaining}s remaining`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("=== Finanssivalvonta (FIN-FSA) Ingestion Crawler ===");
  log(`Mode: ${FLAG_DRY_RUN ? "DRY RUN" : "LIVE"} | Resume: ${FLAG_RESUME} | Force: ${FLAG_FORCE}`);
  log(`Database: ${DB_PATH}`);
  log("");

  // ── Phase 0: Init DB ─────────────────────────────────────────────────
  let db: Database.Database | null = null;
  let existingRefs = new Set<string>();
  let existingEnforcementKeys = new Set<string>();

  if (!FLAG_DRY_RUN) {
    db = initDb();
    ensureSourcebooks(db);
    existingRefs = getExistingReferences(db);
    existingEnforcementKeys = getExistingEnforcementFirms(db);
    log(
      `Existing data: ${existingRefs.size} provisions, ${existingEnforcementKeys.size} enforcement actions`,
    );
  }

  const allProvisions: ParsedRegulation[] = [];
  const allEnforcements: ParsedEnforcement[] = [];

  // ── Phase 1: Discover regulation links ────────────────────────────────
  log("");
  log("── Phase 1: Discover regulation links ──");
  const regulationLinks = await discoverRegulations();

  // ── Phase 2: Parse individual regulation pages ────────────────────────
  log("");
  log("── Phase 2: Parse regulation detail pages ──");
  const regProgress = new ProgressTracker("Regulations", regulationLinks.length);

  for (const link of regulationLinks) {
    try {
      // Skip if in resume mode and we already have this reference
      const probableRef =
        parseReferenceFromSlug(link.path.split("/").filter(Boolean).pop() ?? "") ??
        parseReferenceFromTitle(link.title);

      if (FLAG_RESUME && probableRef && existingRefs.has(probableRef)) {
        regProgress.tick(`SKIP (exists): ${link.title}`);
        continue;
      }

      const parsed = await parseRegulationPage(link);
      allProvisions.push(...parsed);
      regProgress.tick(link.title);
    } catch (err) {
      error(
        `Failed to parse "${link.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
      regProgress.tick(`FAILED: ${link.title}`);
    }
  }

  // ── Phase 3: Crawl enforcement actions ────────────────────────────────
  log("");
  log("── Phase 3: Crawl enforcement actions ──");
  try {
    const enforcements = await crawlEnforcementActions();
    allEnforcements.push(...enforcements);
  } catch (err) {
    error(
      `Enforcement crawl failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Phase 4: Crawl supervision releases ───────────────────────────────
  log("");
  log("── Phase 4: Crawl supervision releases ──");
  try {
    const releases = await crawlSupervisionReleases();
    allProvisions.push(...releases);
  } catch (err) {
    error(
      `Supervision releases crawl failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Phase 5: Write to database ────────────────────────────────────────
  log("");
  log("── Phase 5: Write to database ──");
  log(`Total provisions parsed: ${allProvisions.length}`);
  log(`Total enforcement actions parsed: ${allEnforcements.length}`);

  if (FLAG_DRY_RUN) {
    log("DRY RUN — no data written.");
    log("");
    log("Provisions by category:");
    const byCat = new Map<string, number>();
    for (const p of allProvisions) {
      byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);
    }
    for (const [cat, count] of Array.from(byCat.entries()).sort()) {
      log(`  ${cat}: ${count}`);
    }
    log("");
    log("Enforcement actions by type:");
    const byType = new Map<string, number>();
    for (const e of allEnforcements) {
      byType.set(e.actionType, (byType.get(e.actionType) ?? 0) + 1);
    }
    for (const [type, count] of Array.from(byType.entries()).sort()) {
      log(`  ${type}: ${count}`);
    }
  } else {
    const provResult = insertProvisions(db!, allProvisions, existingRefs);
    log(
      `Provisions: ${provResult.inserted} inserted, ${provResult.skipped} skipped`,
    );

    const enfResult = insertEnforcementActions(
      db!,
      allEnforcements,
      existingEnforcementKeys,
    );
    log(
      `Enforcement actions: ${enfResult.inserted} inserted, ${enfResult.skipped} skipped, ${enfResult.dropped} dropped (malformed)`,
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────
  log("");
  log("=== Ingestion complete ===");

  if (!FLAG_DRY_RUN && db) {
    const provCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions").get() as {
        cnt: number;
      }
    ).cnt;
    const sbCount = (
      db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as {
        cnt: number;
      }
    ).cnt;
    const enfCount = (
      db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as {
        cnt: number;
      }
    ).cnt;
    const ftsCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as {
        cnt: number;
      }
    ).cnt;

    log(`Database summary (${DB_PATH}):`);
    log(`  Sourcebooks:          ${sbCount}`);
    log(`  Provisions:           ${provCount}`);
    log(`  Enforcement actions:  ${enfCount}`);
    log(`  FTS entries:          ${ftsCount}`);

    db.close();
  }
}

main().catch((err) => {
  error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
