"use client";

import { type ReactNode, useState } from "react";
import { AssetChecklist } from "@/components/mail-composer/asset-checklist";
import { FlightDataLinkInput } from "@/components/mail-composer/flight-data-link-input";
import { DAY_DISCIPLINE_KEYS, DAY_SITE_KEYS, type PostTrainingType } from "@/components/mail-composer/types";
import type { MailComposerState } from "@/components/mail-composer/use-mail-composer";
import { DISCIPLINE_LABEL, LAUSANNE_SITE_OPTIONS, TRAINING_DISCIPLINES } from "@/lib/training-disciplines";
import type { UserRole } from "@/lib/user-role";
import { cn } from "@/lib/cn";
import { MobileButton, MobileSegmented, MobileSheet } from "../primitives";

/**
 * The Mail Composer on a phone: one column, big choices, the preview as a
 * sheet. Everything is the shared `useMailComposer` state (held by the shell,
 * so a draft survives tab switches); the guided mode reveals its fields in the
 * same order as the desktop, using the hook's `shouldShow*` flags.
 */
export function MobileMailScreen({ composer, userRole, gmailConnected }: { composer: MailComposerState; userRole: UserRole | null; gmailConnected: boolean }) {
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

  const [previewOpen, setPreviewOpen] = useState(false);
  // The preview opens itself when a new draft lands (state adjusted during
  // render, keyed on the result object, so no effect is needed).
  const [seenResult, setSeenResult] = useState(result);
  if (result !== seenResult) {
    setSeenResult(result);
    if (result) setPreviewOpen(true);
  }

  const canGenerate = !loading && (mailGenMode === "brief" ? form.recipient_name.trim() !== "" && briefText.trim() !== "" : !generateDisabled);

  return (
    <div className="space-y-5 px-4 pt-1">
      <MobileSegmented
        label="Mail generation mode"
        value={mailGenMode}
        onChange={(mode) => {
          if (!mailGenSaving) void handleSetMailGenMode(mode);
        }}
        options={[
          { value: "guided", label: "Guided" },
          { value: "brief", label: "AI brief" },
        ]}
      />

      {mailGenMode === "brief" ? (
        <div className="space-y-4">
          <Field label="Recipient name(s)">
            <input value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} placeholder="e.g. Marco, or Marco and Hans" className={INPUT} />
          </Field>
          <Field label="Recipient email (optional)">
            <input type="email" inputMode="email" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="name@company.com" className={INPUT} />
          </Field>
          {userRole !== "us_pilot" ? (
            <Field label="Language">
              <Chips value={form.language} options={[{ value: "de", label: "DE" }, { value: "en", label: "EN" }, { value: "fr", label: "FR" }]} onChange={(language) => setForm({ ...form, language })} />
            </Field>
          ) : null}
          <Field label="Training brief" hint="Claude writes the email from this. The asset links stay exact and tracked.">
            <textarea rows={6} value={briefText} onChange={(e) => setBriefText(e.target.value)} placeholder="Who the client was, which assets to include, and what was special about this training…" className={cn(INPUT, "min-h-32 py-3")} />
          </Field>
          <Field label="Add-ons">
            <FlightDataLinkInput value={form.datasets_link} onChange={(value) => setForm({ ...form, datasets_link: value })} />
          </Field>
          {result && briefContent ? (
            <details className="rounded-xl border border-glass/10 bg-panel" open={editingAssets} onToggle={(e) => setEditingAssets((e.target as HTMLDetailsElement).open)}>
              <summary className="min-h-12 cursor-pointer list-none px-4 py-3 text-[15px] text-ink">Edit assets</summary>
              <div className="space-y-3 border-t border-glass/10 px-4 py-3">
                <p className="text-xs text-ink-4">Add or remove assets, then save. The written text stays as it is.</p>
                <AssetChecklist grouped={groupedChangeOptions} selectedIds={form.included_change_ids} lang={composerMailLang} onDetailsToggle={() => {}} onToggle={(id, checked) => setForm((prev) => ({ ...prev, included_change_ids: checked ? [...prev.included_change_ids, id] : prev.included_change_ids.filter((x) => x !== id) }))} />
                <MobileButton variant="secondary" disabled={savingAssets} onClick={() => void composer.handleSaveBriefAssets()}>
                  {savingAssets ? "Saving…" : "Save changes"}
                </MobileButton>
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Mail type">
            <Chips value={form.mail_type} options={[{ value: "pre", label: "Before training" }, { value: "post", label: "After training" }]} onChange={(mail_type) => { setForm({ ...form, mail_type }); setChangesTouched(false); }} />
          </Field>
          {composer.shouldShowLanguage && userRole !== "us_pilot" ? (
            <Field label="Language">
              <Chips value={form.language} options={[{ value: "de", label: "DE" }, { value: "en", label: "EN" }, { value: "fr", label: "FR" }]} onChange={(language) => { setForm({ ...form, language }); setChangesTouched(false); }} />
            </Field>
          ) : null}
          {composer.shouldShowVariant ? (
            <Field label="Training venue">
              <Chips value={form.template_variant} options={[{ value: "abroad", label: "Abroad" }, { value: "lausanne", label: "In Lausanne" }]} onChange={(v) => composer.selectTemplateVariant(v)} />
            </Field>
          ) : null}
          {composer.shouldShowPostTrainingType ? (
            <Field label="Training type">
              <Chips value={form.training_type} options={[{ value: "intro_1day", label: "Intro (1 day)" }, { value: "aiim_3day", label: "AIIM (3 days)" }]} onChange={(v) => composer.selectTrainingType(v as PostTrainingType)} />
            </Field>
          ) : null}
          {composer.shouldShowDayCount ? (
            <Field label="Training days">
              <Chips value={form.day_count} options={[{ value: 1, label: "1 day" }, { value: 2, label: "2 days" }, { value: 3, label: "3 days" }]} onChange={(n) => composer.selectDayCount(n as 1 | 2 | 3)} />
            </Field>
          ) : null}
          {composer.shouldShowDisciplines
            ? Array.from({ length: preDayCount }).map((_, dayIdx) => {
                const key = DAY_DISCIPLINE_KEYS[dayIdx];
                return (
                  <Field key={key} label={`Day ${dayIdx + 1} topics`}>
                    <div className="grid grid-cols-2 gap-2">
                      {TRAINING_DISCIPLINES.map((d) => {
                        const active = form[key].includes(d);
                        return (
                          <button key={d} type="button" aria-pressed={active} onClick={() => composer.toggleDiscipline(dayIdx as 0 | 1 | 2, d)} className={chipClass(active)}>
                            {DISCIPLINE_LABEL[d][composerMailLang]}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                );
              })
            : null}
          {composer.shouldShowLausanneSite
            ? Array.from({ length: preDayCount }).map((_, dayIdx) => {
                const key = DAY_SITE_KEYS[dayIdx];
                return (
                  <Field key={key} label={`Day ${dayIdx + 1} flight site (optional)`}>
                    <div className="grid grid-cols-2 gap-2">
                      {LAUSANNE_SITE_OPTIONS.map((o) => (
                        <button key={o.id} type="button" aria-pressed={form[key] === o.id} onClick={() => setForm((prev) => ({ ...prev, [key]: prev[key] === o.id ? "" : o.id }))} className={chipClass(form[key] === o.id)}>
                          {o.label[composerMailLang]}
                        </button>
                      ))}
                    </div>
                  </Field>
                );
              })
            : null}
          {composer.shouldShowAbroadLocation ? (
            <Field label="Training location">
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City / country" className={INPUT} />
            </Field>
          ) : null}
          {composer.shouldShowRecipient ? (
            <Field label="Recipient name">
              <input value={form.recipient_name} onChange={(e) => { setForm({ ...form, recipient_name: e.target.value }); setChangesTouched(false); }} className={INPUT} />
            </Field>
          ) : null}
          {composer.shouldShowCompany ? (
            <Field label="Company">
              <input value={form.company_name} onChange={(e) => { setForm({ ...form, company_name: e.target.value }); setChangesTouched(false); }} className={INPUT} />
            </Field>
          ) : null}
          {composer.shouldShowUseCase ? (
            <Field label="Use case">
              <input value={form.use_case} onChange={(e) => { setForm({ ...form, use_case: e.target.value }); setChangesTouched(false); }} className={INPUT} />
            </Field>
          ) : null}
          {composer.shouldShowDate ? (
            <Field label={form.mail_type === "pre" ? "Training date" : "Training date (optional)"}>
              <input value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={INPUT} />
            </Field>
          ) : null}
          {composer.shouldShowRecipientOptional ? (
            <Field label="Additional recipients (optional)">
              <input value={form.recipient_optional} onChange={(e) => setForm({ ...form, recipient_optional: e.target.value })} placeholder="comma-separated emails" className={INPUT} />
            </Field>
          ) : null}
          {composer.shouldShowChanges ? (
            <>
              <Field label="Assets">
                <AssetChecklist grouped={groupedChangeOptions} selectedIds={form.included_change_ids} lang={composerMailLang} onDetailsToggle={() => {}} onToggle={(id, checked) => { setChangesTouched(true); setForm((prev) => ({ ...prev, included_change_ids: checked ? [...prev.included_change_ids, id] : prev.included_change_ids.filter((x) => x !== id) })); }} />
              </Field>
              <Field label="Add-ons">
                <FlightDataLinkInput value={form.datasets_link} onChange={(value) => setForm({ ...form, datasets_link: value })} />
              </Field>
            </>
          ) : null}
        </div>
      )}

      <div className="space-y-2">
        <MobileButton disabled={!canGenerate} onClick={() => void (mailGenMode === "brief" ? composer.handleGenerateBrief() : composer.handleGenerate())}>
          {loading ? "Generating…" : "Generate draft"}
        </MobileButton>
        {result ? (
          <MobileButton variant="secondary" onClick={() => setPreviewOpen(true)}>
            Open preview
          </MobileButton>
        ) : null}
        <button type="button" onClick={() => composer.handleResetComposer()} className="w-full py-2 text-center text-sm text-ink-4">
          Start over
        </button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>

      <MobileSheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        full
        title="Draft"
        footer={
          <div className="space-y-2">
            {!gmailConnected ? <p className="text-xs text-warn">Connect Gmail in Settings to save this as a draft.</p> : null}
            {draftInfo ? <p className="text-xs text-positive">Draft created in Gmail.</p> : null}
            <MobileButton disabled={draftLoading || !gmailConnected || !result} onClick={() => void composer.handleCreateDraft()}>
              {draftLoading ? "Creating in Gmail…" : "Create Gmail draft"}
            </MobileButton>
            <MobileButton
              variant="secondary"
              disabled={!result}
              onClick={() => {
                if (result) void navigator.clipboard?.writeText(`${result.subject}\n\n${result.body}`);
              }}
            >
              Copy plain text
            </MobileButton>
          </div>
        }
      >
        <p className="text-xs uppercase tracking-[0.12em] text-ink-4">Subject</p>
        <p className="mt-1 text-[15px] font-semibold text-ink">{animatedPreviewSubject || result?.subject || "…"}</p>
        <p className="mt-4 text-xs uppercase tracking-[0.12em] text-ink-4">Body</p>
        <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-2">{animatedPreviewBody || result?.body || "…"}</pre>
      </MobileSheet>
    </div>
  );
}

const INPUT = "min-h-12 w-full rounded-xl border border-glass/15 bg-glass/8 px-3 text-base text-ink placeholder:text-ink-5 focus:border-accent/40 focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-ink-4">{label}</span>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-ink-5">{hint}</p> : null}
    </div>
  );
}

function chipClass(active: boolean): string {
  return cn("min-h-11 rounded-xl border px-3 text-sm font-medium transition", active ? "border-accent/50 bg-accent/15 text-accent-soft" : "border-glass/15 bg-glass/5 text-ink-3 active:bg-glass/10");
}

function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className={chipClass(o.value === value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
