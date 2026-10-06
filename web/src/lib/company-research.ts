import { DEFAULT_INCLUDED_CHANGE_IDS } from "@/lib/change-options";
import industryLinks from "@/mail-config/industry-training-links.json";
import { MailInput } from "@/lib/mail-engine";

type Course = {
  id: string;
  keywords: string[];
};

type ActivityProfile = {
  id: string;
  evidencePatterns: RegExp[];
  droneUsePatterns: RegExp[];
  assetIds: string[];
};

type CompanyDeliveryModel = "internal" | "reseller_or_service" | "uncertain";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCompanyProfileQuery(companyName: string) {
  const company = companyName.trim();
  return `${company} what does this company do products industry operations`.trim();
}

function buildCompanyDroneUseQuery(companyName: string, useCase: string) {
  const company = companyName.trim();
  const useCasePart = useCase.trim();
  const guidingQuestion = "where or for what could the company use the drone for";
  const scope = "indoor inspection use cases confined spaces tanks vessels stacks pipelines";
  return `${company} ${useCasePart} ${guidingQuestion} ${scope}`.trim();
}

function buildUseCaseDroneUseQuery(useCase: string) {
  const useCasePart = useCase.trim();
  const guidingQuestion = "which drone resources are useful for this use case";
  const scope = "indoor inspection use cases";
  return `${useCasePart} ${guidingQuestion} ${scope}`.trim();
}

async function fetchWebContext(query: string) {
  if (!query) return "";

  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Flya-Space/1.0",
      },
      cache: "no-store",
    });
    if (!response.ok) return "";
    const html = await response.text();
    return stripHtml(html).slice(0, 4000);
  } catch {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

function countKeywordHits(source: string, keywords: string[]) {
  if (!source) return 0;
  let count = 0;
  for (const kw of keywords) {
    const needle = kw.toLowerCase().trim();
    if (!needle) continue;
    if (needle.includes(" ")) {
      if (source.includes(needle)) count += 1;
      continue;
    }
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    if (pattern.test(source)) count += 1;
  }
  return count;
}

function includesAny(source: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(source));
}

function applyCodewordAssetRules(source: string, included: Set<string>) {
  if (!source) return;
  const rules: Array<{ patterns: RegExp[]; ids: string[] }> = [
    {
      patterns: [/\b(point cloud|pointcloud|scan to bim|bim|faro|reality capture)\b/],
      ids: ["useful_nubigon", "thinkific_faro_connect"],
    },
    {
      patterns: [/\b(ut|ultrasonic|thickness|ndt|corrosion)\b/],
      ids: ["useful_intro_ut"],
    },
    {
      patterns: [/\b(gas sensor|gas detection|methane|h2s|voc)\b/],
      ids: ["thinkific_gas_sensor"],
    },
    {
      patterns: [/\b(cement|kiln|clinker)\b/],
      ids: ["thinkific_cement"],
    },
    {
      patterns: [/\b(mining|mine shaft|stope|ore pass)\b/],
      ids: ["thinkific_mining"],
    },
    {
      patterns: [/\b(wastewater|sewer|wwtp|treatment plant)\b/],
      ids: ["thinkific_wastewater"],
    },
    {
      patterns: [/\b(regulation|compliance|authority|approval)\b/],
      ids: ["thinkific_regulation"],
    },
  ];
  for (const rule of rules) {
    if (!includesAny(source, rule.patterns)) continue;
    for (const id of rule.ids) included.add(id);
  }
}

function hasDroneUseSignal(source: string) {
  return /\b(inspection|inspect|maintenance|asset integrity|monitoring|confined space|tank|vessel|boiler|stack|chimney|silo|tunnel|shaft|pipeline|plant|facility)\b/.test(
    source,
  );
}

function inferCompanyDeliveryModel(companyProfileSource: string, companyDroneUseSource: string): CompanyDeliveryModel {
  const source = `${companyProfileSource} ${companyDroneUseSource}`.toLowerCase();
  if (!source.trim()) return "uncertain";

  const resellerOrServicePatterns = [
    /\b(service provider|inspection service|contractor|consulting|consultancy)\b/,
    /\b(reseller|distributor|channel partner|dealer)\b/,
    /\b(offer services|provides services|for clients|for customers)\b/,
  ];
  const internalPatterns = [
    /\b(manufacturer|producer|plant operator|asset owner|owner operator)\b/,
    /\b(in-house|internal operations|own facilities|own plants)\b/,
    /\b(production|manufacturing|operates plants|operates facilities)\b/,
  ];

  const resellerHits = resellerOrServicePatterns.filter((pattern) => pattern.test(source)).length;
  const internalHits = internalPatterns.filter((pattern) => pattern.test(source)).length;

  if (resellerHits > internalHits && resellerHits >= 1) return "reseller_or_service";
  if (internalHits > resellerHits && internalHits >= 1) return "internal";
  return "uncertain";
}

function hasCompanyNearbyEvidence(companyWebSource: string, companyName: string, evidencePattern: RegExp) {
  const normalizedCompany = companyName.trim().toLowerCase();
  if (!normalizedCompany) return false;
  const companyParts = normalizedCompany.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (companyParts.length === 0) return false;
  const companyPattern = companyParts.join("\\s+");
  const evidenceSource = evidencePattern.source;
  const nearby = new RegExp(`(${companyPattern}).{0,120}(${evidenceSource})|(${evidenceSource}).{0,120}(${companyPattern})`, "i");
  return nearby.test(companyWebSource);
}

function inferCompanyActivityAssets(
  companyName: string,
  companyProfileSource: string,
  companyDroneUseSource: string,
  included: Set<string>,
) {
  if (!companyProfileSource && !companyDroneUseSource) return;
  const profiles: ActivityProfile[] = [
    {
      id: "chemical-gas",
      evidencePatterns: [/\b(chemical|chemicals|polymer|petrochemical|latex|resin|process plant|industrial chemicals)\b/],
      droneUsePatterns: [/\b(inspection|process|reactor|tank|vessel|pipeline|flare|stack|safety|gas)\b/],
      assetIds: ["thinkific_gas_sensor"],
    },
    {
      id: "mining",
      evidencePatterns: [/\b(mining|underground mine|ore pass|stope|shaft)\b/],
      droneUsePatterns: [/\b(inspection|underground|shaft|stope|tunnel|safety)\b/],
      assetIds: ["thinkific_mining"],
    },
    {
      id: "wastewater",
      evidencePatterns: [/\b(wastewater|sewer|water treatment|wwtp|drainage)\b/],
      droneUsePatterns: [/\b(inspection|confined space|tunnel|sewer|asset)\b/],
      assetIds: ["thinkific_wastewater"],
    },
    {
      id: "cement",
      evidencePatterns: [/\b(cement|clinker|kiln)\b/],
      droneUsePatterns: [/\b(inspection|kiln|stack|silo|plant)\b/],
      assetIds: ["thinkific_cement"],
    },
    {
      id: "point-cloud",
      evidencePatterns: [/\b(point cloud|scan to bim|bim|faro|survey|mapping)\b/],
      droneUsePatterns: [/\b(survey|mapping|model|digital twin|inspection)\b/],
      assetIds: ["useful_nubigon", "thinkific_faro_connect"],
    },
    {
      id: "ut-ndt",
      evidencePatterns: [/\b(ultrasonic|ndt|thickness|corrosion)\b/],
      droneUsePatterns: [/\b(inspection|asset integrity|thickness|corrosion)\b/],
      assetIds: ["useful_intro_ut"],
    },
  ];

  for (const profile of profiles) {
    const evidenceHits = profile.evidencePatterns.filter((pattern) =>
      hasCompanyNearbyEvidence(companyProfileSource, companyName, pattern),
    ).length;
    const droneUseHits = profile.droneUsePatterns.filter(
      (pattern) => pattern.test(companyDroneUseSource) || pattern.test(companyProfileSource),
    ).length;
    const isChemicalGas = profile.id === "chemical-gas";
    // Balanced: evidence + drone-use signal, with a small chemical-company fallback.
    if ((evidenceHits >= 1 && droneUseHits >= 1) || (isChemicalGas && evidenceHits >= 1)) {
      for (const id of profile.assetIds) included.add(id);
    }
  }
}

function applyIndustryCourseRules(
  primarySource: string,
  webSource: string,
  courses: Course[],
  included: Set<string>,
  mode: "company" | "use_case",
) {
  for (const course of courses) {
    const strongHits = countKeywordHits(primarySource, course.keywords);
    const weakHits = countKeywordHits(webSource, course.keywords);
    if (mode === "company") {
      // Company research should be conservative: add only if we have clear evidence and drone-use context.
      const hasContext = hasDroneUseSignal(webSource);
      if ((strongHits >= 2 || weakHits >= 2) && hasContext) {
        included.add(`thinkific_${course.id}`);
      }
      continue;
    }
    // Use-case mode can be more direct because user input is explicit intent.
    if (strongHits >= 1 || weakHits >= 2) {
      included.add(`thinkific_${course.id}`);
    }
  }
}

export async function enrichWithAutoResearch(input: MailInput): Promise<MailInput> {
  if (input.mail_type !== "post") return input;

  // Honor post-training selection deterministically, even if client passes explicit changes.
  if (input.training_type === "intro_1day") {
    const explicit = (input.included_change_ids ?? DEFAULT_INCLUDED_CHANGE_IDS).filter((id) => id !== "material_aiim");
    if (input.included_change_ids && input.included_change_ids.length > 0) {
      return { ...input, included_change_ids: explicit };
    }
  }
  if (input.included_change_ids && input.included_change_ids.length > 0) return input;
  const rawUseCase = (input.use_case ?? "").trim();
  const skipUseCaseResearch = rawUseCase.includes("/");
  const effectiveUseCase = skipUseCaseResearch ? "" : rawUseCase;

  const [companyProfileContext, companyDroneUseContext, useCaseWebContext] = await Promise.all([
    fetchWebContext(buildCompanyProfileQuery(input.company_name)),
    fetchWebContext(buildCompanyDroneUseQuery(input.company_name, effectiveUseCase)),
    effectiveUseCase ? fetchWebContext(buildUseCaseDroneUseQuery(effectiveUseCase)) : Promise.resolve(""),
  ]);

  const companyPrimarySource = input.company_name.toLowerCase();
  const useCasePrimarySource = effectiveUseCase.toLowerCase();
  const companyProfileSource = companyProfileContext.toLowerCase();
  const companyDroneUseSource = companyDroneUseContext.toLowerCase();
  const companyWebSource = `${companyProfileSource} ${companyDroneUseSource}`.trim();
  const useCaseWebSource = useCaseWebContext.toLowerCase();

  const included = new Set(DEFAULT_INCLUDED_CHANGE_IDS);
  const introPatterns = [/\b(intro|basic|one day|1day)\b/];
  const advancedPatterns = [/\b(aiim|advanced|complex inspection|inspection methodology)\b/];
  const allCompanySource = `${companyPrimarySource} ${companyWebSource}`.trim();
  const allUseCaseSource = `${useCasePrimarySource} ${useCaseWebSource}`.trim();
  const hasIntroSignal = includesAny(allCompanySource, introPatterns) || includesAny(allUseCaseSource, introPatterns);
  const hasAdvancedSignal = includesAny(allCompanySource, advancedPatterns) || includesAny(allUseCaseSource, advancedPatterns);

  if (hasAdvancedSignal) {
    included.add("material_aiim");
  } else if (hasIntroSignal) {
    included.delete("material_aiim");
  }
  if (input.training_type === "intro_1day") {
    included.delete("material_aiim");
  } else if (input.training_type === "aiim_3day") {
    included.add("material_aiim");
  }

  const deliveryModel = inferCompanyDeliveryModel(companyProfileSource, companyDroneUseSource);
  if (deliveryModel === "internal") {
    included.delete("material_method_statement");
    included.delete("material_sop");
    included.delete("material_risk_assessment");
  }

  // Company and use-case are inferred independently, then merged to avoid missing useful assets.
  inferCompanyActivityAssets(input.company_name, companyProfileSource, companyDroneUseSource, included);
  applyCodewordAssetRules(allUseCaseSource, included);

  const courses = ((industryLinks.courses as Course[]) ?? []).filter((course) => course.id && course.keywords?.length);
  // Company-only course inference is intentionally conservative and activity-based (handled above).
  applyIndustryCourseRules(useCasePrimarySource, useCaseWebSource, courses, included, "use_case");

  const combinedWebContext = [
    companyProfileContext ? `Company profile research:\n${companyProfileContext}` : "",
    companyDroneUseContext ? `Company drone-use research:\n${companyDroneUseContext}` : "",
    useCaseWebContext ? `Use-case research:\n${useCaseWebContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    ...input,
    company_research_text: combinedWebContext,
    included_change_ids: [...included],
  };
}

