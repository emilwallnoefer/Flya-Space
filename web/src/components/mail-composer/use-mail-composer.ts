"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import {
  CHANGE_OPTIONS,
  DEFAULT_INCLUDED_CHANGE_IDS,
  getOtherTrainingsOptionsInOrder,
  getThinkificOnlineCoursesInOrder,
  type MailLanguage,
  RESOURCE_SECTION_ORDER,
} from "@/lib/change-options";
import type { TrainingDiscipline } from "@/lib/training-disciplines";
import { playUiSound, playUiSoundWithCrossfadeFill, stopUiSound } from "@/lib/ui-sounds";
import type { UserRole } from "@/lib/user-role";
import type { GroupedChangeOptions } from "./asset-checklist";
import {
  type BriefContent,
  DAY_DISCIPLINE_KEYS,
  type FormState,
  type GenerateResponse,
  INITIAL_FORM_STATE,
  type PostTrainingType,
} from "./types";

const SUBJECT_WRITE_STEP = 2;
const BODY_WRITE_STEP = 10;
const SUBJECT_WRITE_INTERVAL_MS = 20;
const BODY_WRITE_INTERVAL_MS = 17;

/** All Mail Composer state: the guided form's progressive-reveal flow, Brief
 * mode, generation/draft calls, and the live-preview typing animation. */
export function useMailComposer(userRole: UserRole | null) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [loading, setLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [changesTouched, setChangesTouched] = useState(false);
  /** Which mail generator the composer uses; switched at the top of the composer. */
  const [mailGenMode, setMailGenMode] = useState<"guided" | "brief">("guided");
  /** The one-time AI brief cost note. Hidden until the stored flag loads, so it never flashes for someone who dismissed it. */
  const [briefCostNoticeSeen, setBriefCostNoticeSeen] = useState(true);
  const [mailGenSaving, setMailGenSaving] = useState(false);
  /** Free-text brief for the AI ("brief") generator. */
  const [briefText, setBriefText] = useState("");
  /** Prose from the last Brief-mode generation, kept so assets can be re-rendered without the LLM. */
  const [briefContent, setBriefContent] = useState<BriefContent | null>(null);
  /** Whether the Brief-mode asset editor is open, and whether a re-render is in flight. */
  const [editingAssets, setEditingAssets] = useState(false);
  const [savingAssets, setSavingAssets] = useState(false);
  const [animatedPreviewSubject, setAnimatedPreviewSubject] = useState("");
  const [animatedPreviewBody, setAnimatedPreviewBody] = useState("");
  const [draftInfo, setDraftInfo] = useState<{ draftId: string; messageId: string } | null>(null);
  const previousPreviewWritingRef = useRef(false);

  const shouldShowLanguage = Boolean(form.mail_type);
  const isPre = form.mail_type === "pre";
  const isPost = form.mail_type === "post";
  const isPreLausanne = isPre && form.template_variant === "lausanne";
  const isPreAbroad = isPre && form.template_variant === "abroad";
  const preDayCount = form.day_count;

  const shouldShowVariant = shouldShowLanguage && isPre;
  const shouldShowPostTrainingType = isPost && shouldShowLanguage;
  const shouldShowDayCount = shouldShowVariant && Boolean(form.template_variant);
  const shouldShowDisciplines = shouldShowDayCount && preDayCount > 0;
  const shouldShowLausanneSite = isPreLausanne && preDayCount > 0;
  const shouldShowAbroadLocation = isPreAbroad && preDayCount > 0;
  const preFinalSelectionDone = isPreLausanne
    ? preDayCount > 0 // Lausanne flight site is optional, so day count is enough to proceed.
    : isPreAbroad
      ? Boolean(form.location)
      : false;

  const shouldShowRecipient = isPost
    ? shouldShowPostTrainingType && Boolean(form.training_type)
    : preFinalSelectionDone;
  const shouldShowCompany = isPost && shouldShowRecipient && Boolean(form.recipient_name);
  const shouldShowUseCase = isPost && shouldShowCompany && Boolean(form.company_name);
  const shouldShowDate = isPre ? shouldShowRecipient && Boolean(form.recipient_name) : false;
  // Resource attachments (slide decks / links) are a post-training recap concern only.
  const shouldShowChanges = isPost && shouldShowUseCase && Boolean(form.use_case);
  const shouldShowRecipientOptional = isPost ? shouldShowChanges : Boolean(form.date);

  const composerMailLang: MailLanguage =
    userRole === "us_pilot"
      ? "en"
      : form.language === "en" || form.language === "de" || form.language === "fr"
        ? form.language
        : "en";

  const languageReady = userRole === "us_pilot" || Boolean(form.language);

  const generateDisabled =
    !form.mail_type ||
    !languageReady ||
    !form.recipient_name ||
    (isPost && (!form.training_type || !form.company_name || !form.use_case)) ||
    (isPre &&
      (!form.template_variant || !form.day_count || !form.date || (isPreAbroad && !form.location)));

  const groupedChangeOptions = useMemo<GroupedChangeOptions>(() => {
    const materials = CHANGE_OPTIONS.filter((o) => o.category === "training_material");
    const usefulSections = RESOURCE_SECTION_ORDER.map((sectionId) => ({
      sectionId,
      options:
        sectionId === "online_courses"
          ? getThinkificOnlineCoursesInOrder(CHANGE_OPTIONS)
          : sectionId === "other_trainings"
            ? getOtherTrainingsOptionsInOrder(CHANGE_OPTIONS)
            : CHANGE_OPTIONS.filter((o) => o.category === "useful_link" && o.resourceSection === sectionId),
    })).filter((s) => s.options.length > 0);
    return { materials, usefulSections };
  }, []);

  const selectTemplateVariant = useCallback((nextVariant: FormState["template_variant"]) => {
    if (!nextVariant) return;
    setForm((prev) => ({
      ...prev,
      template_variant: nextVariant,
      // Lausanne uses a named flight site; abroad uses a free-text location. Reset the other.
      location:
        nextVariant === "lausanne"
          ? "Lausanne"
          : prev.location === "Lausanne"
            ? ""
            : prev.location,
      day1_site: nextVariant === "lausanne" ? prev.day1_site : "",
      day2_site: nextVariant === "lausanne" ? prev.day2_site : "",
      day3_site: nextVariant === "lausanne" ? prev.day3_site : "",
    }));
    setChangesTouched(false);
  }, []);

  const selectDayCount = useCallback((nextCount: 1 | 2 | 3) => {
    setForm((prev) => {
      // On the first day-count pick, seed Day 1 with the Intro topic (the fundamentals day).
      const seedDay1 =
        prev.day_count === 0 && prev.day1_disciplines.length === 0
          ? (["intro"] as TrainingDiscipline[])
          : prev.day1_disciplines;
      return {
        ...prev,
        day_count: nextCount,
        day1_disciplines: seedDay1,
        day2_disciplines: nextCount >= 2 ? prev.day2_disciplines : [],
        day3_disciplines: nextCount >= 3 ? prev.day3_disciplines : [],
        day2_site: nextCount >= 2 ? prev.day2_site : "",
        day3_site: nextCount >= 3 ? prev.day3_site : "",
      };
    });
  }, []);

  const toggleDiscipline = useCallback((dayIndex: 0 | 1 | 2, discipline: TrainingDiscipline) => {
    const key = DAY_DISCIPLINE_KEYS[dayIndex];
    setForm((prev) => {
      const current = prev[key];
      const nextList = current.includes(discipline)
        ? current.filter((d) => d !== discipline)
        : [...current, discipline];
      return { ...prev, [key]: nextList };
    });
  }, []);

  const selectTrainingType = useCallback((nextTrainingType: PostTrainingType) => {
    setForm((prev) => {
      const hasAiim = prev.included_change_ids.includes("material_aiim");
      if (nextTrainingType === "intro_1day") {
        return {
          ...prev,
          training_type: nextTrainingType,
          included_change_ids: prev.included_change_ids.filter((id) => id !== "material_aiim"),
        };
      }
      if (nextTrainingType === "aiim_3day" && !hasAiim) {
        return {
          ...prev,
          training_type: nextTrainingType,
          included_change_ids: [...prev.included_change_ids, "material_aiim"],
        };
      }
      return { ...prev, training_type: nextTrainingType };
    });
    setChangesTouched(false);
  }, []);

  // Generation mode: load the stored mode once.
  useEffect(() => {
    (async () => {
      if (userRole === "sales" || userRole === "hr") return;
      const response = await fetch("/api/settings/mail-generation");
      if (!response.ok) return;
      const data = (await response.json()) as { mode?: string; briefCostNoticeSeen?: boolean };
      setMailGenMode(data.mode === "brief" ? "brief" : "guided");
      setBriefCostNoticeSeen(data.briefCostNoticeSeen === true);
    })();
  }, [userRole]);

  // Persist a mode change made via the composer's header switch.
  async function handleSetMailGenMode(mode: "guided" | "brief") {
    if (mode === mailGenMode || mailGenSaving) return;
    const previous = mailGenMode;
    setMailGenMode(mode); // optimistic
    setMailGenSaving(true);
    try {
      const response = await fetch("/api/settings/mail-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) setMailGenMode(previous);
    } catch {
      setMailGenMode(previous);
    } finally {
      setMailGenSaving(false);
    }
  }

  // Hide the cost note now and remember it on the account, so it never shows again on any device.
  function dismissBriefCostNotice() {
    setBriefCostNoticeSeen(true);
    void fetch("/api/settings/brief-cost-notice", { method: "POST" }).catch(() => {
      // Not saved: the note shows once more next visit, which is harmless.
    });
  }

  // Live-preview typing animation.
  useEffect(() => {
    if (!result?.subject) {
      setAnimatedPreviewSubject("");
      return;
    }
    const text = result.subject;
    let cursor = 0;
    let timeoutId: number | null = null;
    const step = () => {
      cursor = Math.min(text.length, cursor + SUBJECT_WRITE_STEP);
      setAnimatedPreviewSubject(text.slice(0, cursor));
      if (cursor < text.length) timeoutId = window.setTimeout(step, SUBJECT_WRITE_INTERVAL_MS);
    };
    step();
    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [result?.subject]);

  useEffect(() => {
    if (!result?.body) {
      setAnimatedPreviewBody("");
      return;
    }
    const text = result.body;
    let cursor = 0;
    let timeoutId: number | null = null;
    const step = () => {
      cursor = Math.min(text.length, cursor + BODY_WRITE_STEP);
      setAnimatedPreviewBody(text.slice(0, cursor));
      if (cursor < text.length) timeoutId = window.setTimeout(step, BODY_WRITE_INTERVAL_MS);
    };
    step();
    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [result?.body]);

  const previewIsWriting = Boolean(result) && (
    animatedPreviewSubject.length < (result?.subject.length ?? 0) ||
    animatedPreviewBody.length < (result?.body.length ?? 0)
  );

  // Typing sound: start on write begin (crossfade-filled for the estimated
  // duration), stop when the animation catches up.
  useEffect(() => {
    const wasWriting = previousPreviewWritingRef.current;
    previousPreviewWritingRef.current = previewIsWriting;

    if (!wasWriting && previewIsWriting) {
      const subjectLen = result?.subject.length ?? 0;
      const bodyLen = result?.body.length ?? 0;
      const subjectSteps = subjectLen > 0 ? Math.ceil(subjectLen / SUBJECT_WRITE_STEP) : 0;
      const bodySteps = bodyLen > 0 ? Math.ceil(bodyLen / BODY_WRITE_STEP) : 0;
      const subjectMs = subjectSteps > 0 ? (subjectSteps - 1) * SUBJECT_WRITE_INTERVAL_MS : 0;
      const bodyMs = bodySteps > 0 ? (bodySteps - 1) * BODY_WRITE_INTERVAL_MS : 0;
      const rawEstimateMs = Math.max(subjectMs, bodyMs);
      const paddedEstimateMs = Math.max(2200, Math.round(rawEstimateMs * 2.2));
      playUiSoundWithCrossfadeFill("previewWrite", paddedEstimateMs, {
        fadeInMs: 110,
        fadeOutMs: 220,
        crossfadeMs: 1000,
      });
      return;
    }

    if (wasWriting && !previewIsWriting) {
      stopUiSound("previewWrite", { fadeOutMs: 220 });
    }
  }, [previewIsWriting, result?.subject, result?.body]);

  useEffect(() => {
    return () => {
      stopUiSound("previewWrite", { fadeOutMs: 120 });
    };
  }, []);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          language: userRole === "us_pilot" ? "en" : form.language,
          template_variant: form.template_variant || undefined,
          training_type: isPost ? form.training_type || undefined : undefined,
          to: form.to || form.recipient_optional || undefined,
          recipient_optional: form.recipient_optional || undefined,
          day_count: isPre && form.day_count ? form.day_count : undefined,
          day1_disciplines: isPre ? form.day1_disciplines : undefined,
          day2_disciplines: isPre && form.day_count >= 2 ? form.day2_disciplines : undefined,
          day3_disciplines: isPre && form.day_count >= 3 ? form.day3_disciplines : undefined,
          day1_site: isPreLausanne ? form.day1_site || undefined : undefined,
          day2_site: isPreLausanne && form.day_count >= 2 ? form.day2_site || undefined : undefined,
          day3_site: isPreLausanne && form.day_count >= 3 ? form.day3_site || undefined : undefined,
          included_change_ids: isPost && changesTouched ? form.included_change_ids : undefined,
          datasets_link: isPost ? form.datasets_link.trim() || undefined : undefined,
        }),
      });
      const data = (await response.json()) as GenerateResponse | { error: string };
      if (!response.ok) throw new Error((data as { error: string }).error || "Generate failed");
      const generated = data as GenerateResponse;
      setResult(generated);
      if (generated.selected_change_ids && generated.selected_change_ids.length > 0) {
        setForm((prev) => ({
          ...prev,
          included_change_ids: generated.selected_change_ids ?? prev.included_change_ids,
        }));
        setChangesTouched(false);
      }
      setDraftInfo(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateBrief() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/generate-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: userRole === "us_pilot" ? "en" : form.language || "en",
          recipient_name: form.recipient_name,
          brief: briefText,
          datasets_link: form.datasets_link.trim() || undefined,
        }),
      });
      const data = (await response.json()) as GenerateResponse | { error: string };
      if (!response.ok) throw new Error((data as { error: string }).error || "Generate failed");
      const generated = data as GenerateResponse;
      setResult(generated);
      setBriefContent(generated.brief_content ?? null);
      setEditingAssets(false);
      setForm((prev) => ({
        ...prev,
        included_change_ids: generated.selected_change_ids ?? [],
      }));
      setChangesTouched(false);
      setDraftInfo(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveBriefAssets() {
    if (!briefContent) return;
    setSavingAssets(true);
    setError(null);
    try {
      const response = await fetch("/api/render-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: userRole === "us_pilot" ? "en" : form.language || "en",
          recipient_name: form.recipient_name,
          datasets_link: form.datasets_link.trim() || undefined,
          prose: briefContent,
          selected_change_ids: form.included_change_ids,
        }),
      });
      const data = (await response.json()) as GenerateResponse | { error: string };
      if (!response.ok) throw new Error((data as { error: string }).error || "Update failed");
      setResult(data as GenerateResponse);
      setDraftInfo(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingAssets(false);
    }
  }

  async function handleCreateDraft() {
    if (!result) {
      setError("Generate a draft first.");
      return;
    }

    setDraftLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/gmail/create-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: form.to || form.recipient_optional || undefined,
          subject: result.subject,
          body: result.body,
          html_body: result.html_body,
          inline_attachments: result.inline_attachments,
          tracking_meta: form.recipient_name
            ? {
                recipient_name: form.recipient_name,
                recipient_email: form.to || form.recipient_optional || undefined,
                company_name: form.company_name || undefined,
                mail_type: form.mail_type || "unknown",
                language: form.language || undefined,
                template_variant: form.template_variant || undefined,
                training_type: form.training_type || undefined,
              }
            : undefined,
        }),
      });
      const data = (await response.json()) as { draftId: string; messageId: string } | { error: string };
      if (!response.ok) throw new Error((data as { error: string }).error || "Failed to create draft");
      setDraftInfo(data as { draftId: string; messageId: string });
      playUiSound("mailSend");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDraftLoading(false);
    }
  }

  function handleResetComposer() {
    setForm({
      ...INITIAL_FORM_STATE,
      included_change_ids: [...DEFAULT_INCLUDED_CHANGE_IDS],
    });
    setResult(null);
    setError(null);
    setDraftInfo(null);
    setChangesTouched(false);
    setBriefText("");
    setBriefContent(null);
    setEditingAssets(false);
  }

  const handleResourceDetailsToggle = useCallback((e: SyntheticEvent<HTMLDetailsElement>) => {
    const el = e.currentTarget;
    if (!el.open) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        /* nearest: only scroll enough to show expanded content; avoids hiding fields above the accordions. */
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      });
    });
  }, []);

  return {
    form,
    setForm,
    setChangesTouched,
    loading,
    draftLoading,
    error,
    result,
    mailGenMode,
    mailGenSaving,
    handleSetMailGenMode,
    showBriefCostNotice: !briefCostNoticeSeen,
    dismissBriefCostNotice,
    briefText,
    setBriefText,
    briefContent,
    editingAssets,
    setEditingAssets,
    savingAssets,
    animatedPreviewSubject,
    animatedPreviewBody,
    draftInfo,
    groupedChangeOptions,
    composerMailLang,
    generateDisabled,
    preDayCount,
    shouldShowLanguage,
    shouldShowVariant,
    shouldShowPostTrainingType,
    shouldShowDayCount,
    shouldShowDisciplines,
    shouldShowLausanneSite,
    shouldShowAbroadLocation,
    shouldShowRecipient,
    shouldShowCompany,
    shouldShowUseCase,
    shouldShowDate,
    shouldShowChanges,
    shouldShowRecipientOptional,
    selectTemplateVariant,
    selectDayCount,
    toggleDiscipline,
    selectTrainingType,
    handleGenerate,
    handleGenerateBrief,
    handleSaveBriefAssets,
    handleCreateDraft,
    handleResetComposer,
    handleResourceDetailsToggle,
  };
}

export type MailComposerState = ReturnType<typeof useMailComposer>;
