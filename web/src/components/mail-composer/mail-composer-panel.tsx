"use client";

import type { CSSProperties } from "react";
import { Input, Textarea } from "@/components/ui";
import {
  DISCIPLINE_LABEL,
  LAUSANNE_SITE_OPTIONS,
  TRAINING_DISCIPLINES,
} from "@/lib/training-disciplines";
import type { UserRole } from "@/lib/user-role";
import { LazyEliosGame } from "@/components/elios-game-lazy";
import { AssetChecklist } from "./asset-checklist";
import { ComposerChoiceRow, composerSegmentClass, ProgressiveField } from "./composer-fields";
import { LivePreview } from "./live-preview";
import { DAY_DISCIPLINE_KEYS, DAY_SITE_KEYS } from "./types";
import type { MailComposerState } from "./use-mail-composer";

const COMPOSER_BUBBLES = [
  { left: "8%", size: "9px", duration: "9s", delay: "0s" },
  { left: "20%", size: "7px", duration: "11s", delay: "-2.5s" },
  { left: "36%", size: "10px", duration: "10s", delay: "-1.5s" },
  { left: "52%", size: "8px", duration: "12s", delay: "-4s" },
  { left: "68%", size: "9px", duration: "9.5s", delay: "-3s" },
  { left: "84%", size: "11px", duration: "13s", delay: "-5s" },
];

/** The Mail Composer module: guided/brief form on the left, live preview on the right. */
export function MailComposerPanel({
  composer,
  userRole,
  gmailConnected,
}: {
  composer: MailComposerState;
  userRole: UserRole | null;
  gmailConnected: boolean;
}) {
  const {
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
  } = composer;

  /**
   * Has the mail started appearing in the preview?
   *
   * Keyed off the animated subject rather than `result`, because the typing
   * effect is what actually fills the space — the moment a character lands is
   * the moment the game should start getting out of the way. `result` alone
   * would hand the slot over a beat early, while the card is still blank.
   */
  const mailIsWriting = Boolean(animatedPreviewSubject || animatedPreviewBody || result);

  return (
    <section className="underwater-panel relative grid items-start gap-6 overflow-hidden rounded-2xl lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="relative min-h-0 min-w-0 w-full lg:col-start-1 lg:row-start-1">
        <div className="bubble-layer pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          {COMPOSER_BUBBLES.map((bubble, idx) => (
            <span
              key={`${bubble.left}-${idx}`}
              className="bubble"
              style={
                {
                  "--bubble-left": bubble.left,
                  "--bubble-size": bubble.size,
                  "--bubble-duration": bubble.duration,
                  "--bubble-delay": bubble.delay,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="glass-card hourlogger-surface relative z-[1] w-full min-w-0 rounded-2xl p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold md:text-xl">Mail Composer</h2>
            <div
              role="group"
              aria-label="Mail generation mode"
              className="inline-flex rounded-lg border border-glass/15 bg-glass/10 p-0.5"
            >
              <button
                type="button"
                aria-pressed={mailGenMode === "guided"}
                disabled={mailGenSaving}
                onClick={() => void handleSetMailGenMode("guided")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/90 ${
                  mailGenMode === "guided" ? "bg-accent/90 text-slate-900" : "text-ink-2 hover:text-ink"
                }`}
              >
                Guided
              </button>
              <button
                type="button"
                aria-pressed={mailGenMode === "brief"}
                disabled={mailGenSaving}
                onClick={() => void handleSetMailGenMode("brief")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/90 ${
                  mailGenMode === "brief" ? "bg-accent/90 text-slate-900" : "text-ink-2 hover:text-ink"
                }`}
              >
                AI brief
              </button>
            </div>
          </div>
          {mailGenMode === "brief" ? (
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-ink-3/80">Recipient name(s)</label>
                <Input
                  type="text"
                  placeholder="e.g. Marco, or Marco and Hans"
                  value={form.recipient_name}
                  onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-ink-3/80">Recipient email</label>
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="name@company.com (Optional)"
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                />
              </div>
              {userRole !== "us_pilot" ? (
                <ComposerChoiceRow label="Language" columns={3}>
                  {(["de", "en", "fr"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      aria-pressed={form.language === lang}
                      className={composerSegmentClass(form.language === lang)}
                      onClick={() => setForm({ ...form, language: lang })}
                    >
                      {lang.toUpperCase()}
                    </button>
                  ))}
                </ComposerChoiceRow>
              ) : null}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-ink-3/80">Training brief</label>
                <Textarea
                  rows={6}
                  placeholder="Who the client was, which assets to include, and what was special about this training…"
                  value={briefText}
                  onChange={(e) => setBriefText(e.target.value)}
                />
                <p className="text-[11px] leading-4 text-ink-4/80">
                  Claude (Opus 4.8) writes the email from this. The asset links stay exact and tracked.
                </p>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-ink-3/80">Add-ons</label>
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="Link to collected flight data (Optional)"
                  value={form.datasets_link}
                  onChange={(e) => setForm({ ...form, datasets_link: e.target.value })}
                />
              </div>

              {result && briefContent ? (
                <div className="space-y-2 border-t border-glass/10 pt-3">
                  <button
                    type="button"
                    onClick={() => setEditingAssets(!editingAssets)}
                    aria-expanded={editingAssets}
                    className="flex w-full items-center justify-between rounded-lg border border-glass/15 bg-glass/5 px-3 py-2 text-sm font-medium text-ink transition hover:bg-glass/10"
                  >
                    <span>Edit assets</span>
                    <span className={`text-xs text-ink-4 transition ${editingAssets ? "rotate-180" : ""}`}>▼</span>
                  </button>
                  {editingAssets ? (
                    <div className="space-y-3">
                      <p className="text-[11px] leading-4 text-ink-4/80">
                        Add or remove assets, then save. This re-renders the email without re-running the AI, so the
                        written text stays exactly as it is.
                      </p>
                      <AssetChecklist
                        grouped={groupedChangeOptions}
                        selectedIds={form.included_change_ids}
                        lang={composerMailLang}
                        onDetailsToggle={composer.handleResourceDetailsToggle}
                        onToggle={(id, checked) => {
                          setForm((prev) => ({
                            ...prev,
                            included_change_ids: checked
                              ? [...prev.included_change_ids, id]
                              : prev.included_change_ids.filter((existing) => existing !== id),
                          }));
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void composer.handleSaveBriefAssets();
                        }}
                        disabled={savingAssets}
                        className="h-10 w-full rounded-lg bg-accent/90 px-4 text-sm font-semibold text-slate-900 transition hover:-translate-y-px hover:bg-accent disabled:translate-y-0 disabled:opacity-70"
                      >
                        {savingAssets ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                <ComposerChoiceRow label="Mail type">
                  <button
                    type="button"
                    aria-pressed={form.mail_type === "pre"}
                    className={composerSegmentClass(form.mail_type === "pre")}
                    onClick={() => {
                      setForm({ ...form, mail_type: "pre" });
                      setChangesTouched(false);
                    }}
                  >
                    Before training
                  </button>
                  <button
                    type="button"
                    aria-pressed={form.mail_type === "post"}
                    className={composerSegmentClass(form.mail_type === "post")}
                    onClick={() => {
                      setForm({ ...form, mail_type: "post" });
                      setChangesTouched(false);
                    }}
                  >
                    After training
                  </button>
                </ComposerChoiceRow>

                <ProgressiveField show={composer.shouldShowLanguage && userRole !== "us_pilot"}>
                  <ComposerChoiceRow label="Language" columns={3}>
                    {(["de", "en", "fr"] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        aria-pressed={form.language === lang}
                        className={composerSegmentClass(form.language === lang)}
                        onClick={() => {
                          setForm({ ...form, language: lang });
                          setChangesTouched(false);
                        }}
                      >
                        {lang.toUpperCase()}
                      </button>
                    ))}
                  </ComposerChoiceRow>
                </ProgressiveField>

                <ProgressiveField show={composer.shouldShowVariant}>
                  <ComposerChoiceRow label="Training venue">
                    <button
                      type="button"
                      aria-pressed={form.template_variant === "abroad"}
                      className={composerSegmentClass(form.template_variant === "abroad")}
                      onClick={() => composer.selectTemplateVariant("abroad")}
                    >
                      Abroad
                    </button>
                    <button
                      type="button"
                      aria-pressed={form.template_variant === "lausanne"}
                      className={composerSegmentClass(form.template_variant === "lausanne")}
                      onClick={() => composer.selectTemplateVariant("lausanne")}
                    >
                      In Lausanne
                    </button>
                  </ComposerChoiceRow>
                </ProgressiveField>

                <ProgressiveField show={composer.shouldShowPostTrainingType}>
                  <ComposerChoiceRow label="Training type">
                    <button
                      type="button"
                      aria-pressed={form.training_type === "intro_1day"}
                      className={composerSegmentClass(form.training_type === "intro_1day")}
                      onClick={() => composer.selectTrainingType("intro_1day")}
                    >
                      Intro (1 day)
                    </button>
                    <button
                      type="button"
                      aria-pressed={form.training_type === "aiim_3day"}
                      className={composerSegmentClass(form.training_type === "aiim_3day")}
                      onClick={() => composer.selectTrainingType("aiim_3day")}
                    >
                      AIIM (3 days)
                    </button>
                  </ComposerChoiceRow>
                </ProgressiveField>

                <ProgressiveField show={composer.shouldShowDayCount}>
                  <ComposerChoiceRow label="Training days" columns={3}>
                    {([1, 2, 3] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={form.day_count === n}
                        className={composerSegmentClass(form.day_count === n)}
                        onClick={() => composer.selectDayCount(n)}
                      >
                        {n === 1 ? "1 day" : `${n} days`}
                      </button>
                    ))}
                  </ComposerChoiceRow>
                </ProgressiveField>

                <ProgressiveField show={composer.shouldShowDisciplines}>
                  <div className="space-y-2.5">
                    {Array.from({ length: preDayCount }).map((_, dayIdx) => {
                      const dayKey = DAY_DISCIPLINE_KEYS[dayIdx];
                      const selectedForDay = form[dayKey];
                      return (
                        <div key={dayIdx} role="group" aria-label={`Day ${dayIdx + 1} topics`}>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">
                            Day {dayIdx + 1} topics
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {TRAINING_DISCIPLINES.map((discipline) => {
                              const active = selectedForDay.includes(discipline);
                              return (
                                <button
                                  key={discipline}
                                  type="button"
                                  aria-pressed={active}
                                  className={composerSegmentClass(active)}
                                  onClick={() => composer.toggleDiscipline(dayIdx as 0 | 1 | 2, discipline)}
                                >
                                  {DISCIPLINE_LABEL[discipline][composerMailLang]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-ink-4/80">
                      Intro covers the fundamentals (safety, setup, core flight). Add or remove topics per day.
                    </p>
                  </div>
                </ProgressiveField>

                <ProgressiveField show={composer.shouldShowLausanneSite}>
                  <div className="space-y-2.5">
                    {Array.from({ length: preDayCount }).map((_, dayIdx) => {
                      const siteKey = DAY_SITE_KEYS[dayIdx];
                      const selectedSite = form[siteKey];
                      return (
                        <div key={dayIdx} role="group" aria-label={`Day ${dayIdx + 1} flight site`}>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">
                            Day {dayIdx + 1} flight site (Lausanne, optional)
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {LAUSANNE_SITE_OPTIONS.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                aria-pressed={selectedSite === option.id}
                                className={composerSegmentClass(selectedSite === option.id)}
                                onClick={() =>
                                  setForm((prev) => ({
                                    ...prev,
                                    [siteKey]: prev[siteKey] === option.id ? "" : option.id,
                                  }))
                                }
                              >
                                {option.label[composerMailLang]}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-ink-4/80">
                      Each day can use a different asset. The location is woven into that day&apos;s agenda, and any safety gear is added automatically.
                    </p>
                  </div>
                </ProgressiveField>

                <ProgressiveField show={composer.shouldShowAbroadLocation}>
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-ink-4/90">
                      Training location
                    </p>
                    <Input
                      placeholder="City / country (Required)"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                    />
                  </div>
                </ProgressiveField>
              </div>

              <div className="mt-3 grid gap-3">
                <ProgressiveField show={composer.shouldShowRecipient}>
                  <Input
                    placeholder="Recipient Name"
                    value={form.recipient_name}
                    onChange={(e) => {
                      setForm({ ...form, recipient_name: e.target.value });
                      setChangesTouched(false);
                    }}
                  />
                </ProgressiveField>
                <ProgressiveField show={composer.shouldShowCompany}>
                  <Input
                    placeholder="Company Name"
                    value={form.company_name}
                    onChange={(e) => {
                      setForm({ ...form, company_name: e.target.value });
                      setChangesTouched(false);
                    }}
                  />
                </ProgressiveField>
                <ProgressiveField show={composer.shouldShowUseCase}>
                  <Input
                    placeholder="Use Case"
                    value={form.use_case}
                    onChange={(e) => {
                      setForm({ ...form, use_case: e.target.value });
                      setChangesTouched(false);
                    }}
                  />
                </ProgressiveField>
                <ProgressiveField show={composer.shouldShowDate}>
                  <Input
                    placeholder={form.mail_type === "pre" ? "Training Date (Required)" : "Training Date (Optional)"}
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </ProgressiveField>
                <ProgressiveField show={composer.shouldShowRecipientOptional}>
                  <Input
                    placeholder="Additional Recipients (Optional, comma-separated emails)"
                    value={form.recipient_optional}
                    onChange={(e) => setForm({ ...form, recipient_optional: e.target.value })}
                  />
                </ProgressiveField>
                <ProgressiveField show={composer.shouldShowChanges}>
                  <AssetChecklist
                    grouped={groupedChangeOptions}
                    selectedIds={form.included_change_ids}
                    lang={composerMailLang}
                    onDetailsToggle={composer.handleResourceDetailsToggle}
                    onToggle={(id, checked) => {
                      setChangesTouched(true);
                      setForm((prev) => ({
                        ...prev,
                        included_change_ids: checked
                          ? [...prev.included_change_ids, id]
                          : prev.included_change_ids.filter((existing) => existing !== id),
                      }));
                    }}
                  />
                </ProgressiveField>
                <ProgressiveField show={composer.shouldShowChanges}>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-ink-3/80">Add-ons</label>
                    <Input
                      type="url"
                      inputMode="url"
                      placeholder="Link to collected flight data (Optional)"
                      value={form.datasets_link}
                      onChange={(e) => setForm({ ...form, datasets_link: e.target.value })}
                    />
                  </div>
                </ProgressiveField>
              </div>
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => {
                void (mailGenMode === "brief" ? composer.handleGenerateBrief() : composer.handleGenerate());
              }}
              disabled={
                loading ||
                (mailGenMode === "brief"
                  ? !form.recipient_name.trim() || !briefText.trim()
                  : generateDisabled)
              }
              className="h-11 w-full rounded-lg bg-accent/90 px-4 text-sm font-semibold text-slate-900 transition hover:-translate-y-px hover:bg-accent disabled:translate-y-0 disabled:opacity-70 sm:w-auto"
              type="button"
            >
              {loading ? "Generating…" : "Generate draft"}
            </button>
            <button
              onClick={() => {
                void composer.handleCreateDraft();
              }}
              disabled={draftLoading || !gmailConnected || !result}
              className="h-11 w-full rounded-lg border border-accent/45 bg-accent-deep/15 px-4 text-sm font-semibold text-accent-soft transition hover:-translate-y-px hover:bg-accent-deep/25 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              type="button"
            >
              {draftLoading ? "Creating in Gmail…" : "Create Gmail draft"}
            </button>
            <button
              onClick={() => {
                composer.handleResetComposer();
              }}
              className="h-11 w-full rounded-lg border border-glass/20 bg-glass/10 px-4 text-sm font-semibold text-ink transition hover:bg-glass/15 sm:w-auto"
              type="button"
            >
              Reset
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          {draftInfo && (
            <p className="mt-3 text-sm text-positive">
              Draft created: {draftInfo.draftId} ({draftInfo.messageId})
            </p>
          )}
        </div>
      </div>

      <div className="relative min-h-0 min-w-0 w-full lg:col-start-2 lg:row-start-1">
        <LivePreview
          result={result}
          animatedSubject={animatedPreviewSubject}
          animatedBody={animatedPreviewBody}
          idleSlot={
            /*
              The game waits in the slot the mail will fill, from the moment the
              composer opens — not only once Generate is pressed, so there is
              something to do while the form is being filled in too.

              It collapses the instant the first character is typed rather than
              when the request returns: `animatedPreviewSubject` drives the neon
              write effect, so this hands the space over exactly as the mail
              starts appearing in it. Height and opacity animate together so the
              card does not jump, and `paused` stops the loop once it is hidden.
            */
            <div
              aria-hidden={mailIsWriting}
              className={`overflow-hidden transition-all duration-700 ease-out ${
                mailIsWriting ? "mt-0 max-h-0 opacity-0" : "mt-4 max-h-[560px] opacity-100"
              }`}
            >
              <p className="text-[11px] uppercase tracking-[0.15em] text-accent-soft/75">
                {loading ? "Writing your draft" : "While you wait"}
              </p>
              <LazyEliosGame className="mt-2" leaderboard paused={mailIsWriting} />
            </div>
          }
        />
      </div>
    </section>
  );
}
