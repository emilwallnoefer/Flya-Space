import type { MailLanguage } from "@/lib/change-options";
import { DEFAULT_INCLUDED_CHANGE_IDS } from "@/lib/change-options";
import type { LausanneSite, TrainingDiscipline } from "@/lib/training-disciplines";

/** The LLM-written prose of a Brief-mode email, held so assets can be re-rendered without another LLM call. */
export type BriefContent = {
  subject: string;
  opener: string;
  recap_intro: string;
  feedback_ask: string;
  closing: string;
};

export type GenerateResponse = {
  template_id: string;
  subject: string;
  body: string;
  html_body: string;
  selected_change_ids?: string[];
  inline_attachments?: Array<{ contentId: string; mimeType: string; base64: string }>;
  /** Present only for Brief-mode results. */
  brief_content?: BriefContent;
};

/** Post-training mail still uses these two coarse presets. */
export type PostTrainingType = "intro_1day" | "aiim_3day";

export type FormState = {
  mail_type: "" | "pre" | "post";
  template_variant: "" | "lausanne" | "abroad";
  language: "" | MailLanguage;
  /** Post-mail only. Pre-mails use day_count + per-day disciplines instead. */
  training_type: "" | PostTrainingType;
  recipient_name: string;
  recipient_optional: string;
  company_name: string;
  use_case: string;
  date: string;
  location: string;
  /** Pre-mail: number of training days and the disciplines taught each day. */
  day_count: 0 | 1 | 2 | 3;
  day1_disciplines: TrainingDiscipline[];
  day2_disciplines: TrainingDiscipline[];
  day3_disciplines: TrainingDiscipline[];
  /** Pre-mail Lausanne: the flight site (asset) used on each day. */
  day1_site: "" | LausanneSite;
  day2_site: "" | LausanneSite;
  day3_site: "" | LausanneSite;
  to: string;
  included_change_ids: string[];
  /** Post-mail only. Link to the collected flight data; renders the Add-ons section. */
  datasets_link: string;
};

export const DAY_DISCIPLINE_KEYS = ["day1_disciplines", "day2_disciplines", "day3_disciplines"] as const;
export const DAY_SITE_KEYS = ["day1_site", "day2_site", "day3_site"] as const;

export const INITIAL_FORM_STATE: FormState = {
  mail_type: "",
  template_variant: "",
  language: "",
  training_type: "",
  recipient_name: "",
  recipient_optional: "",
  company_name: "",
  use_case: "",
  date: "",
  location: "",
  day_count: 0,
  day1_disciplines: [],
  day2_disciplines: [],
  day3_disciplines: [],
  day1_site: "",
  day2_site: "",
  day3_site: "",
  to: "",
  included_change_ids: [...DEFAULT_INCLUDED_CHANGE_IDS],
  datasets_link: "",
};
