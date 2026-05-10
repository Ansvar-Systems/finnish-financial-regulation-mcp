/**
 * list_sourcebooks — extracted from src/index.ts by
 * scripts/apply-sector-regulator-golden-standard.py.
 *
 * Original tool name: fi_fin_list_sourcebooks
 */

import { listSourcebooks } from "../db.js";
import { textContent, errorContent } from "./_helpers.js";



export const LIST_SOURCEBOOKS_TOOL = {
  name: "list_sourcebooks",
  description: "List all Finanssivalvonta sourcebook categories with their names and descriptions.",
  inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
};

export async function handleListSourcebooks(args: unknown) {
  const sourcebooks = listSourcebooks();
  return textContent({ sourcebooks, count: sourcebooks.length });
}
