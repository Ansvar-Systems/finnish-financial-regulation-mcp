/**
 * Seed the Finanssivalvonta database with sample provisions for testing.
 *
 * Inserts representative provisions from FIN-FSA regulations, guidelines,
 * and statements so MCP tools can be tested without running a full crawl.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["FINFSA_DB_PATH"] ?? "data/finfsa.db";
const force = process.argv.includes("--force");

// -- Bootstrap database --

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// -- Sourcebooks --

interface SourcebookRow {
  id: string;
  name: string;
  description: string;
}

const sourcebooks: SourcebookRow[] = [
  {
    id: "FINFSA_MAARAYKSET",
    name: "Finanssivalvonnan Määräykset (Regulations)",
    description:
      "Binding regulations (maaraykset) issued by Finanssivalvonta under authority delegated by Finnish financial services legislation.",
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
];

const insertSourcebook = db.prepare(
  "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
);

for (const sb of sourcebooks) {
  insertSourcebook.run(sb.id, sb.name, sb.description);
}

console.log(`Inserted ${sourcebooks.length} sourcebooks`);

// -- Sample provisions --

interface ProvisionRow {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string;
  chapter: string;
  section: string;
}

const provisions: ProvisionRow[] = [
  // -- FINFSA_MAARAYKSET — Binding Regulations --
  {
    sourcebook_id: "FINFSA_MAARAYKSET",
    reference: "FIVA_M_2021_01",
    title: "Maarays ICT-riskien hallinnasta (Regulation on ICT Risk Management)",
    text: "Luottolaitosten ja sijoituspalveluyritysten on luotava kattava ICT-riskienhallintakehys, joka kattaa tietojärjestelmien turvallisuuden, tietojen eheyden ja toiminnan jatkuvuuden. Kehyksen on sisällettävä vuotuinen riskiarviointi, tapausmenettelyt ja testausohjelmat vaatimustenmukaisuuden varmistamiseksi DORA-asetuksen (EU 2022/2554) mukaisesti.",
    type: "regulation",
    status: "in_force",
    effective_date: "2021-06-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "FINFSA_MAARAYKSET",
    reference: "FIVA_M_2022_02",
    title: "Maarays rahanpesun ja terrorismin rahoituksen estamisesta (AML/CFT Regulation)",
    text: "Kaikkien Finanssivalvonnan valvomien toimijoiden on sovellettava asiakkaan tunnistamista ja tuntemista koskevia menettelyjä (KYC), jatkuvaa liiketoimintasuhteen seurantaa ja epäilyttävistä liiketoimista ilmoittamista koskevat vaatimukset Rahanpesulain (444/2017) mukaisesti. Vaatimusten noudattaminen on varmistettava sisäisin politiikoin ja menettelyin.",
    type: "regulation",
    status: "in_force",
    effective_date: "2022-01-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "FINFSA_MAARAYKSET",
    reference: "FIVA_M_2023_03",
    title: "Maarays vakavaraisuusvaatimuksista (Capital Adequacy Regulation)",
    text: "Luottolaitosten on yllapidettava riittavia omia varoja suhteessa riskipainotettuihin saamisiin vaatimustenmukaisuuden varmistamiseksi CRR III -asetuksen ja CRD VI -direktiivin kanssa. Finanssivalvonta edellyttaa vuotuista ICAAP-prosessia ja stressitestausta vakavaraisuusaseman arvioimiseksi.",
    type: "regulation",
    status: "in_force",
    effective_date: "2023-01-01",
    chapter: "3",
    section: "3.1",
  },
  // -- FINFSA_OHJEET — Guidelines --
  {
    sourcebook_id: "FINFSA_OHJEET",
    reference: "FIVA_O_2021_01",
    title: "Ohje hallinto- ja ohjausjarjestelmista (Corporate Governance Guideline)",
    text: "Finanssivalvonta edellyttaa, etta luottolaitoksilla ja sijoituspalveluyrityksilla on tehokas hallinto- ja ohjausjarjestelma, joka kasittaa selkean vastuunjaon, riittavan monipuolisen hallituksen ja tehokkaan sisaisen valvontajarjestelman. Hallituksen jasenilla on oltava riittava soveltuvuus ja ammatillinen sopivuus EBA:n soveltuvuusohjeisiin perustuen.",
    type: "guideline",
    status: "in_force",
    effective_date: "2021-09-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "FINFSA_OHJEET",
    reference: "FIVA_O_2022_02",
    title: "Ohje tietoturvallisuuden hallinnasta (IT Security Management Guideline)",
    text: "Finanssivalvonta ohjeistaa, etta toimivaltaisten rahoituslaitosten on nimettava tietoturvallisuuspaallikkoa vastaava henkilo ja perustettava selkea tietoturvallisuuden hallintakehys, joka kattaa kaytonvalvonnan, salauksen, hairiotilanteiden hallinnan ja kolmansien osapuolien riskienhallinnan EBA IKT-suuntaviivojen mukaisesti.",
    type: "guideline",
    status: "in_force",
    effective_date: "2022-04-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "FINFSA_OHJEET",
    reference: "FIVA_O_2023_03",
    title: "Ohje ESG-riskien hallinnasta (ESG Risk Management Guideline)",
    text: "Finanssivalvonta ohjeistaa luottolaitoksia ja sijoituspalveluyrityksia integroimaan ymparisto-, yhteiskuntavastuu- ja hallintoriskit (ESG) riskienhallintakehyksiinsa. Toimijoiden on arvioitava ilmastonmuutosriskit sekä SFDR:n mukaiset kestavan rahoituksen tiedonantovelvollisuudet ja raportoitava saannollisesti hallinnollisille elimille.",
    type: "guideline",
    status: "in_force",
    effective_date: "2023-06-01",
    chapter: "3",
    section: "3.1",
  },
  // -- FINFSA_KANNANOTOT — Statements --
  {
    sourcebook_id: "FINFSA_KANNANOTOT",
    reference: "FIVA_K_2023_01",
    title: "Kannanotto DORA-vaatimusten tulkinnasta",
    text: "Finanssivalvonta toteaa, etta DORA-asetus (EU 2022/2554) astuu voimaan 17. tammikuuta 2025 ja sita sovelletaan kaikkiin Finanssivalvonnan valvomiin rahoituslaitoksiin. Toimijoiden on varmistettava ICT-riskienhallintakehyksen, kolmansien osapuolten riskienhallinnan ja digitaalisen toimintakykyisyyden testausohjelmien vaatimustenmukaisuus ennen tuota paivaa.",
    type: "statement",
    status: "in_force",
    effective_date: "2023-11-01",
    chapter: "1",
    section: "1.1",
  },
  {
    sourcebook_id: "FINFSA_KANNANOTOT",
    reference: "FIVA_K_2024_01",
    title: "Kannanotto sisapiirikauppojen ehkaisemisesta",
    text: "Finanssivalvonta korostaa, etta rahoituslaitosten on yllapidettava tiukkoja sisapiiri-informaation hallintamenettelyjaan ja sisapiirirekisterejaan MAR-asetuksen mukaisesti. Sisapiirikauppoihin viittaavat poikkeamat on ilmoitettava Finanssivalvonnalle viipymatta ja kyseisten henkiloiden kaupankaynnin seuranta on hoidettava asianmukaisesti.",
    type: "statement",
    status: "in_force",
    effective_date: "2024-02-01",
    chapter: "2",
    section: "2.1",
  },
  {
    sourcebook_id: "FINFSA_KANNANOTOT",
    reference: "FIVA_K_2024_02",
    title: "Kannanotto tekoalyn kaytosta rahoituspalveluissa",
    text: "Finanssivalvonta seuraa tekoalyn kaytton lisaantymista rahoituspalveluissa ja edellyttaa, etta toimijat arvioivat tekoalyjarjestelmiin liittyvia riskeja osana riskienhallintakehystaan. Tekoalyjarjestelmia kaytettaessa on varmistettava lapinakywyys, selitettavyys ja syrjimattomyys erityisesti luottopaatosten ja markkinoinnin osalta.",
    type: "statement",
    status: "in_force",
    effective_date: "2024-03-15",
    chapter: "3",
    section: "3.1",
  },
];

const insertProvision = db.prepare(`
  INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const p of provisions) {
    insertProvision.run(
      p.sourcebook_id,
      p.reference,
      p.title,
      p.text,
      p.type,
      p.status,
      p.effective_date,
      p.chapter,
      p.section,
    );
  }
});

insertAll();

console.log(`Inserted ${provisions.length} sample provisions`);

// -- Sample enforcement actions --

interface EnforcementRow {
  firm_name: string;
  reference_number: string;
  action_type: string;
  amount: number;
  date: string;
  summary: string;
  sourcebook_references: string;
}

const enforcements: EnforcementRow[] = [
  {
    firm_name: "Nordea Bank Abp Suomen sivuliike",
    reference_number: "FIVA_RAT_2022_001",
    action_type: "fine",
    amount: 2_500_000,
    date: "2022-06-14",
    summary:
      "Finanssivalvonta maarasi Nordea Bank Abp Suomen sivuliikkeelle 2,5 miljoonan euron hallinnollisen seuraamusmaksun puutteista rahanpesun ehkaisemiseen liittyvissa asiakkaan tuntemismenettelyissa. Puutteet koskivat korkeariskisten asiakkaiden tehostettua tuntemista ja liiketoiminnan seurantaa.",
    sourcebook_references: "FIVA_M_2022_02",
  },
  {
    firm_name: "Evli Pankki Oyj",
    reference_number: "FIVA_RAT_2023_005",
    action_type: "restriction",
    amount: 800_000,
    date: "2023-09-21",
    summary:
      "Finanssivalvonta maarasi Evli Pankki Oyj:lle 800 000 euron julkisen varoituksen ja seuraamusmaksun vakavista puutteista sijoituspalvelujen soveltuvuusarvioinnissa. Pankki ei ollut asianmukaisesti arvioinut asiakkaiden sijoitustavoitteita ja riskinsietokykyaa MiFID II -direktiivin vaatimusten mukaisesti.",
    sourcebook_references: "FIVA_O_2021_01, FIVA_M_2021_01",
  },
];

const insertEnforcement = db.prepare(`
  INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertEnforcementsAll = db.transaction(() => {
  for (const e of enforcements) {
    insertEnforcement.run(
      e.firm_name,
      e.reference_number,
      e.action_type,
      e.amount,
      e.date,
      e.summary,
      e.sourcebook_references,
    );
  }
});

insertEnforcementsAll();

console.log(`Inserted ${enforcements.length} sample enforcement actions`);

// -- Summary --

const provisionCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions").get() as { cnt: number }
).cnt;
const sourcebookCount = (
  db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as { cnt: number }
).cnt;
const enforcementCount = (
  db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as { cnt: number }
).cnt;
const ftsCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as { cnt: number }
).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Sourcebooks:          ${sourcebookCount}`);
console.log(`  Provisions:           ${provisionCount}`);
console.log(`  Enforcement actions:  ${enforcementCount}`);
console.log(`  FTS entries:          ${ftsCount}`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
