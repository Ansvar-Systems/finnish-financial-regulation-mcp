# Coverage

Documents what regulatory content is indexed in this MCP server and any known gaps.

## Jurisdiction

**Finland (FI)** — Finanssivalvonta (Finnish Financial Supervisory Authority, FIN-FSA)

## Corpus

| Sourcebook ID | Name | Type | Source |
|---|---|---|---|
| `FINFSA_Maaraykset` | FIN-FSA Regulations (*Maaraykset*) | Binding regulation | [finanssivalvonta.fi](https://www.finanssivalvonta.fi/en/regulation/FIN-FSA-regulations/) |
| `FINFSA_Ohjeet` | FIN-FSA Guidelines (*Ohjeet*) | Supervisory guideline | [finanssivalvonta.fi](https://www.finanssivalvonta.fi/en/regulation/FIN-FSA-regulations/) |
| `FINFSA_Kannanotot` | FIN-FSA Regulatory Statements (*Kannanotot*) | Interpretive statement | [finanssivalvonta.fi](https://www.finanssivalvonta.fi/en/regulation/FIN-FSA-regulations/) |
| `enforcement_actions` | FIN-FSA Supervisory Measures | Enforcement/sanction | [finanssivalvonta.fi](https://www.finanssivalvonta.fi/en/about-the-fin-fsa/powers-and-funding/powers-and-authority/supervisory-measures/) |

## Languages

Content is sourced primarily in Finnish (`fi`) and Swedish (`sv`). English summaries and translations are included where Finanssivalvonta provides them.

## Completeness Caveats

- **Not exhaustive.** Coverage may be incomplete. Not all historical or archived documents may be indexed.
- **Periodic updates.** The database is rebuilt from source via `scripts/ingest-fiva.ts`. There may be a lag between official publications and database updates.
- **Language gaps.** Some provisions are only available in Finnish or Swedish; English translations may be partial or absent.
- **Enforcement actions.** Only publicly published supervisory measures are indexed; confidential decisions are not included.

## Data Freshness

Use the `fi_fin_check_data_freshness` tool to inspect current database timestamps:

```
fi_fin_check_data_freshness → { provisions_count, enforcement_count, latest_provision_date, latest_enforcement_date, checked_at }
```

The database is ingested from Finanssivalvonta's public portal. To rebuild:

```bash
npm run ingest        # Re-crawl finanssivalvonta.fi
npm run ingest -- --resume   # Skip already-ingested items
```

## Machine-Readable Coverage

See [`data/coverage.json`](data/coverage.json) for machine-readable coverage metadata.

## Primary Sources

Always verify regulatory content against the official Finanssivalvonta portal:

- **Regulations & guidelines:** <https://www.finanssivalvonta.fi/en/regulation/FIN-FSA-regulations/>
- **Enforcement actions:** <https://www.finanssivalvonta.fi/en/about-the-fin-fsa/powers-and-funding/powers-and-authority/supervisory-measures/>
