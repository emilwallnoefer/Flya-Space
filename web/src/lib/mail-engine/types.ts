import type { MailLanguage } from "@/lib/change-options";
import type { LausanneSite, TrainingDiscipline } from "@/lib/training-disciplines";

/** Post-training mail still uses these two coarse presets. */
export type PostTrainingType = "intro_1day" | "aiim_3day";

export type MailInput = {
  mail_type: "pre" | "post";
  template_variant?: "lausanne" | "abroad";
  language: MailLanguage;
  /** Post-mail only. Pre-mails use day_count + per-day disciplines instead. */
  training_type?: PostTrainingType;
  recipient_name: string;
  recipient_optional?: string;
  company_name: string;
  use_case?: string;
  date: string;
  location: string;
  /** Pre-mail: number of training days (1–3) and the disciplines taught each day. */
  day_count?: 1 | 2 | 3;
  day1_disciplines?: TrainingDiscipline[];
  day2_disciplines?: TrainingDiscipline[];
  day3_disciplines?: TrainingDiscipline[];
  /** Pre-mail Lausanne: the flight site (asset) used on each day. */
  day1_site?: LausanneSite;
  day2_site?: LausanneSite;
  day3_site?: LausanneSite;
  custom_opener_note?: string;
  industry_course_ids?: string;
  include_certification_note?: boolean;
  include_simulator_note?: boolean;
  /** Post-mail only. Link to the flight data collected during the training; renders the Add-ons section. */
  datasets_link?: string;
  include_customer_toolkit?: boolean;
  company_research_text?: string;
  included_change_ids?: string[];
  /** Shown in the template closing; defaults in renderMail when omitted. */
  signature_name?: string;
};

export type MailInlineAttachment = {
  contentId: string;
  mimeType: string;
  base64: string;
};

export type RenderResult = {
  template_id: string;
  subject: string;
  body: string;
  html_body: string;
  /** For Gmail: inline PNG so <img src="cid:…"> resolves without a public URL. */
  inline_attachments?: MailInlineAttachment[];
};

export type Course = {
  id: string;
  label_en: string;
  label_de: string;
  label_fr?: string;
  url: string;
  keywords: string[];
};

export type BriefRenderInput = {
  language: MailLanguage;
  recipient_name: string;
  /** Post-mail only: link to the flight data collected during the training; renders the Add-ons section. */
  datasets_link?: string;
  /** Sender's name in the closing; the routes derive it from the session user. */
  signature_name?: string;
};
