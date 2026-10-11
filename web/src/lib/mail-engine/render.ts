import { CHANGE_OPTIONS, type MailLanguage } from "@/lib/change-options";
import industryLinks from "@/mail-config/industry-training-links.json";
import trainingLinks from "@/mail-config/training-links.json";
import type { BriefLlmResult } from "@/lib/mail-brief-llm";
import { buildAgendaBlock, facilityPrepBlock, flightSiteLine } from "@/lib/training-disciplines";
import type { BriefRenderInput, Course, MailInput, RenderResult } from "./types";
import {
  applyGrammaticalNumber,
  chooseTemplateId,
  extractSubjectAndBody,
  isSingularRecipient,
  normalize,
  parseTemplates,
  readTemplates,
  replacePlaceholders,
} from "./templates";
import { markdownToHtml, stripMarkdownLinks } from "./html";
import { stripLeadingGreeting } from "./greeting";
import {
  addonsBlock,
  buildIndustryTrainingBlock,
  buildTrainingMaterialsBlock,
  buildUsefulLinksBlock,
  buildUsefulLinksBlockFromChanges,
  certificationNote,
  inferIndustryCourseIds,
  resolveFeedbackQr,
  resolveIncludedChangeIds,
  simulatorNote,
} from "./links";

/**
 * The API routes always pass the signed-in sender's name (`displayNameFor`), so
 * this only covers direct callers that leave it out.
 */
const FALLBACK_SIGNATURE_NAME = "Flyability Team";

export function renderMail(input: MailInput): RenderResult {
  const templates = parseTemplates(readTemplates());
  const templateId = chooseTemplateId(input);
  const template = templates[templateId];
  if (!template) throw new Error(`Template not found: ${templateId}`);

  const extracted = extractSubjectAndBody(template);
  const body = extracted.body;
  let subject = extracted.subject;
  const isPre = templateId.startsWith("pre_");
  const singular = isSingularRecipient(input.recipient_name);

  const catalog = (industryLinks.courses as Course[]) ?? [];
  const selected = inferIndustryCourseIds(input, catalog);
  const includedChangeIds = resolveIncludedChangeIds(input);

  const links = trainingLinks as Record<string, string>;
  const feedbackQr = resolveFeedbackQr(input);
  const replacements: Record<string, string> = {
    ...links,
    FEEDBACK_QR_IMAGE_URL: feedbackQr.url,
    RECIPIENT_NAME: input.recipient_name || "",
    RECIPIENT_OPTIONAL: input.recipient_optional || "",
    COMPANY_NAME: input.company_name || "",
    TRAINING_DATE: input.date || "",
    LOCATION: input.location || "",
    CUSTOM_OPENER_NOTE: input.custom_opener_note || "",
    AGENDA_BLOCK: isPre ? buildAgendaBlock(input) : "",
    FLIGHT_SITE_LINE: isPre ? flightSiteLine(input) : "",
    FACILITY_PREP_BLOCK: isPre ? facilityPrepBlock(input, singular) : "",
    TRAINING_MATERIALS_BLOCK: isPre ? "" : buildTrainingMaterialsBlock(input.language, includedChangeIds),
    USEFUL_LINKS_BLOCK: isPre
      ? ""
      : input.included_change_ids && input.included_change_ids.length > 0
        ? buildUsefulLinksBlockFromChanges(input.language, includedChangeIds)
        : buildUsefulLinksBlock(input.language, selected, input),
    INDUSTRY_TRAINING_BLOCK: isPre
      ? ""
      : input.included_change_ids && input.included_change_ids.length > 0
        ? ""
        : buildIndustryTrainingBlock(input.language, selected, catalog),
    CERTIFICATION_NOTE_BLOCK: certificationNote(input.language, input.include_certification_note, singular),
    SIMULATOR_NOTE_BLOCK: simulatorNote(input.language, input.include_simulator_note),
    ADDONS_BLOCK: isPre ? "" : addonsBlock(input.language, input.datasets_link, singular),
    COMPANY_CONTEXT_LINE: "",
    SIGNATURE_NAME: (input.signature_name && input.signature_name.trim()) || FALLBACK_SIGNATURE_NAME,
  };

  subject = normalize(replacePlaceholders(applyGrammaticalNumber(subject, singular), replacements)).trim();
  const markdownBody = replacePlaceholders(applyGrammaticalNumber(body, singular), replacements);
  return {
    template_id: templateId,
    subject,
    body: normalize(stripMarkdownLinks(markdownBody)),
    html_body: markdownToHtml(markdownBody),
    inline_attachments: feedbackQr.attachment ? [feedbackQr.attachment] : undefined,
  };
}

const BRIEF_GREETING: Record<MailLanguage, string> = { en: "Hello", de: "Hallo", fr: "Bonjour" };
const BRIEF_SIGNOFF: Record<MailLanguage, string> = {
  en: "Best regards,",
  de: "Mit freundlichen Grüßen,",
  fr: "Cordialement,",
};
const BRIEF_ROLE = "Flyability Pilot & Trainer";

/**
 * Brief mode render: hybrid of LLM prose + deterministic tracked-link blocks.
 * The LLM (`generateBriefDraft`) supplies the human prose and the chosen asset IDs; here we
 * render the actual click-tracked link blocks from those IDs with the SAME builders the
 * structured post-mail path uses, so links + tracking are identical and never model-authored.
 */
export function renderBriefMail(input: BriefRenderInput, llm: BriefLlmResult): RenderResult {
  const language = input.language;
  const singular = isSingularRecipient(input.recipient_name);

  // Defensive: only render blocks for asset IDs that exist in the catalog.
  const validIds = new Set(CHANGE_OPTIONS.map((opt) => opt.id));
  const selectedChangeIds = llm.selected_change_ids.filter((id) => validIds.has(id));

  const feedbackQr = resolveFeedbackQr({ mail_type: "post", language } as MailInput);
  const signature = (input.signature_name && input.signature_name.trim()) || FALLBACK_SIGNATURE_NAME;

  const greeting = `${BRIEF_GREETING[language]} ${input.recipient_name},`;
  // The model is told not to repeat the greeting but often does; strip it so it can't show twice.
  const opener = stripLeadingGreeting(llm.opener, language);
  const feedbackAsk = llm.feedback_ask.trim();
  const feedbackSection = feedbackAsk
    ? `${feedbackAsk}\n\n![Training feedback](${feedbackQr.url})`
    : "";
  const signoff = `${llm.closing.trim()}\n\n${BRIEF_SIGNOFF[language]}\n${signature}\n${BRIEF_ROLE}`;

  // Joined per-part so a stripped-to-empty opener can't leave a blank gap after the greeting.
  const intro = [greeting, opener, llm.recap_intro.trim()].filter((part) => part.length > 0).join("\n\n");

  const sections = [
    intro,
    buildTrainingMaterialsBlock(language, selectedChangeIds),
    buildUsefulLinksBlockFromChanges(language, selectedChangeIds),
    addonsBlock(language, input.datasets_link, singular),
    feedbackSection,
    signoff.trim(),
  ].filter((section) => section.trim().length > 0);

  const markdownBody = sections.join("\n\n---\n\n");
  const subject = normalize(llm.subject).trim();

  return {
    template_id: `brief_${language}`,
    subject,
    body: normalize(stripMarkdownLinks(markdownBody)),
    html_body: markdownToHtml(markdownBody),
    inline_attachments: feedbackQr.attachment ? [feedbackQr.attachment] : undefined,
  };
}
