# Tools Reference

All 8 tools exposed by this MCP server. Tool prefix: `fi_fin_`.

---

## `fi_fin_search_regulations`

Full-text search across Finanssivalvonta (FIN-FSA) regulatory provisions. Returns matching regulations (*maaraykset*), guidelines (*ohjeet*), and statements (*kannanotot*).

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Search query in Finnish or English (e.g., `riskienhallinta`, `AML`, `corporate governance`) |
| `sourcebook` | `string` | No | Filter by sourcebook ID (e.g., `FINFSA_Maaraykset`, `FINFSA_Ohjeet`, `FINFSA_Kannanotot`) |
| `status` | `"in_force" \| "deleted" \| "not_yet_in_force"` | No | Filter by provision status |
| `limit` | `number` | No | Maximum results (default: 20, max: 100) |

**Returns**

```json
{
  "results": [
    {
      "id": 1,
      "sourcebook_id": "FINFSA_MAARAYKSET",
      "reference": "FIVA_M_2021_01",
      "title": "ICT Risk Management",
      "text": "...",
      "type": "regulation",
      "status": "in_force",
      "effective_date": "2021-06-01",
      "chapter": null,
      "section": null
    }
  ],
  "count": 1,
  "_meta": { "disclaimer": "...", "copyright": "...", "source_url": "...", "data_age": "..." }
}
```

---

## `fi_fin_get_regulation`

Get a specific Finanssivalvonta provision by sourcebook and reference.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `sourcebook` | `string` | Yes | Sourcebook identifier (e.g., `FINFSA_Maaraykset`) |
| `reference` | `string` | Yes | Provision reference (e.g., `FIVA_M_2021_01`) |

**Returns**

The full provision record plus a `_citation` block for entity linking and a `_meta` block.

```json
{
  "id": 1,
  "sourcebook_id": "FINFSA_MAARAYKSET",
  "reference": "FIVA_M_2021_01",
  "title": "ICT Risk Management",
  "text": "...",
  "type": "regulation",
  "status": "in_force",
  "effective_date": "2021-06-01",
  "_citation": {
    "canonical_ref": "FIVA_M_2021_01",
    "display_text": "ICT Risk Management",
    "source_url": null,
    "lookup": { "tool": "fi_fin_get_regulation", "args": { "sourcebook": "FINFSA_Maaraykset", "reference": "FIVA_M_2021_01" } }
  },
  "_meta": { "..." }
}
```

Returns an error if the provision is not found.

---

## `fi_fin_list_sourcebooks`

List all Finanssivalvonta sourcebook categories with their names and descriptions.

**Parameters:** none

**Returns**

```json
{
  "sourcebooks": [
    { "id": "FINFSA_MAARAYKSET", "name": "Regulations", "description": "Binding FIN-FSA regulations" },
    { "id": "FINFSA_OHJEET", "name": "Guidelines", "description": "Supervisory guidelines" },
    { "id": "FINFSA_KANNANOTOT", "name": "Statements", "description": "Regulatory statements" }
  ],
  "count": 3,
  "_meta": { "..." }
}
```

---

## `fi_fin_search_enforcement`

Search Finanssivalvonta enforcement actions — supervisory decisions, administrative fines (*hallinnolliset sanktiot*), activity prohibitions, and public warnings.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Search query (firm name, breach type, e.g., `rahanpesu`, `sisapiiri`) |
| `action_type` | `"fine" \| "ban" \| "restriction" \| "warning"` | No | Filter by action type |
| `limit` | `number` | No | Maximum results (default: 20, max: 100) |

**Returns**

```json
{
  "results": [
    {
      "id": 1,
      "firm_name": "Nordea Bank Abp",
      "reference_number": "FIVA/1234/2022",
      "action_type": "fine",
      "amount": 2500000,
      "date": "2022-06-14",
      "summary": "AML/CFT violations...",
      "sourcebook_references": "FINFSA_MAARAYKSET/FIVA_M_2022_02"
    }
  ],
  "count": 1,
  "_meta": { "..." }
}
```

---

## `fi_fin_check_currency`

Check whether a specific Finanssivalvonta provision reference is currently in force.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `reference` | `string` | Yes | Provision reference (e.g., `FIVA_M_2021_01`) |

**Returns**

```json
{
  "reference": "FIVA_M_2021_01",
  "status": "in_force",
  "effective_date": "2021-06-01",
  "found": true,
  "_meta": { "..." }
}
```

`status` is `"unknown"` and `found` is `false` if the reference is not in the database.

---

## `fi_fin_about`

Return metadata about this MCP server: version, data source, and tool list.

**Parameters:** none

**Returns**

```json
{
  "name": "finnish-financial-regulation-mcp",
  "version": "0.1.0",
  "description": "...",
  "data_source": "Finanssivalvonta (https://www.finanssivalvonta.fi/)",
  "tools": [ { "name": "fi_fin_search_regulations", "description": "..." }, "..." ],
  "_meta": { "..." }
}
```

---

## `fi_fin_list_sources`

Return provenance metadata for the Finanssivalvonta data: official source URLs, supported languages, open-data license, and coverage categories.

**Parameters:** none

**Returns**

```json
{
  "jurisdiction": "FI",
  "authority": "Finanssivalvonta (Finnish Financial Supervisory Authority)",
  "authority_url": "https://www.finanssivalvonta.fi/",
  "regulation_index_url": "https://www.finanssivalvonta.fi/en/regulation/FIN-FSA-regulations/",
  "enforcement_url": "https://www.finanssivalvonta.fi/en/about-the-fin-fsa/...",
  "languages": ["fi", "sv", "en"],
  "license": "Public regulatory publications — open for research use",
  "coverage_categories": [
    "FINFSA_Maaraykset — Binding regulations (maaraykset)",
    "FINFSA_Ohjeet — Supervisory guidelines (ohjeet)",
    "FINFSA_Kannanotot — Regulatory statements (kannanotot)",
    "enforcement_actions — Supervisory decisions and administrative sanctions"
  ],
  "coverage_notes": "Coverage may be incomplete. Always verify against primary sources.",
  "_meta": { "..." }
}
```

---

## `fi_fin_check_data_freshness`

Report data freshness: latest provision effective date, latest enforcement action date, and row counts for both tables. Useful for assessing how current the local database is.

**Parameters:** none

**Returns**

```json
{
  "provisions_count": 9,
  "enforcement_count": 2,
  "latest_provision_date": "2024-03-15",
  "latest_enforcement_date": "2023-09-21",
  "checked_at": "2026-04-09T10:00:00.000Z",
  "_meta": { "..." }
}
```

`latest_provision_date` and `latest_enforcement_date` are `null` if the respective table is empty.
