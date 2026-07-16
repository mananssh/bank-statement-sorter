import { looksLikeCamsCas } from "@/lib/parsers/cas/cams";
import { looksLikeNsdlCas } from "@/lib/parsers/cas/nsdl";

export type CasKind = "cams" | "nsdl";

/**
 * CAMS detailed CAS is checked first on its strongest markers (per-scheme
 * "Opening Unit Balance" / "Registrar :" rows) — an NSDL e-CAS never has
 * those, while both documents mention folios and "Consolidated Account
 * Statement".
 */
export function detectCasKind(pages: string[][]): CasKind | null {
  const text = pages.flat().join("\n");
  if (/opening unit balance|registrar\s*:/i.test(text) && looksLikeCamsCas(pages)) return "cams";
  if (looksLikeNsdlCas(pages)) return "nsdl";
  if (looksLikeCamsCas(pages)) return "cams";
  return null;
}
