"use client";

import type { ReadmeKey, SettingsAccess } from "../types";

/* Disclosure rows + bodies for the README section (repeated 4×). */
const README_TOGGLE_CLASS =
  "flex w-full items-center justify-between rounded-lg border border-glass/15 bg-glass/8 px-3 py-2 text-left text-xs font-medium transition hover:bg-glass/12";
const README_BODY_CLASS = "rounded-lg border border-glass/10 bg-panel/45 p-3 text-xs text-ink-2/90";

type ReadmeSectionProps = {
  access: SettingsAccess;
  openReadme: ReadmeKey | null;
  onToggle: (key: ReadmeKey) => void;
};

export function ReadmeSection({ access, openReadme, onToggle }: ReadmeSectionProps) {
  return (
    <div className="mt-5 space-y-2">
      <p className="text-sm text-ink-4">In-app guides for integrations and workflows.</p>
      <button type="button" onClick={() => onToggle("program")} className={README_TOGGLE_CLASS}>
        <span>Program functionality README</span>
        <span>{openReadme === "program" ? "Hide" : "Show"}</span>
      </button>
      {openReadme === "program" ? (
        <div className={README_BODY_CLASS}>
          <p className="font-medium text-accent-soft">What this program does</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {access.mail ? (
              <li>
                <strong>Mail Composer</strong> creates pre/post training mails from structured inputs (language,
                context, materials, and custom notes).
              </li>
            ) : null}
            {access.mail ? (
              <li>
                <strong>Gmail Draft Mode</strong> allows generated mails to be saved as drafts directly in the
                connected Gmail account.
              </li>
            ) : null}
            {access.time ? (
              <li>
                <strong>Time Tracker</strong> records work logs, compensation, and overtime bank per authenticated
                user.
              </li>
            ) : null}
            {access.time ? (
              <li>
                <strong>Travel Integration</strong> enriches tracker days with travel context from Google Sheets using
                per-user mapping.
              </li>
            ) : null}
            <li>
              <strong>Settings</strong> provides integration setup, mapping control, and legacy time-data import.
            </li>
          </ul>
        </div>
      ) : null}

      {access.mail ? (
        <button type="button" onClick={() => onToggle("gmail")} className={README_TOGGLE_CLASS}>
          <span>Gmail setup README</span>
          <span>{openReadme === "gmail" ? "Hide" : "Show"}</span>
        </button>
      ) : null}
      {access.mail && openReadme === "gmail" ? (
        <div className={README_BODY_CLASS}>
          <p className="font-medium text-accent-soft">What it does</p>
          <p className="mt-1 text-ink-3/90">
            Gmail setup enables draft creation from generated mails so users can review and send from Gmail.
          </p>
          <p className="mt-2 font-medium text-accent-soft">Steps</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>
              Open <strong>Gmail</strong> in the settings list on the left.
            </li>
            <li>Click <strong>Connect Gmail</strong>.</li>
            <li>Select the correct Google account.</li>
            <li>Approve required permissions for draft creation.</li>
            <li>Return to app and confirm status is <strong>Connected</strong>.</li>
            <li>Generate a mail draft and run <strong>Create Gmail draft</strong> as final verification.</li>
          </ol>
        </div>
      ) : null}

      {access.time ? (
        <button type="button" onClick={() => onToggle("mapping")} className={README_TOGGLE_CLASS}>
          <span>Travel mapping setup README</span>
          <span>{openReadme === "mapping" ? "Hide" : "Show"}</span>
        </button>
      ) : null}
      {access.time && openReadme === "mapping" ? (
        <div className={README_BODY_CLASS}>
          <p className="font-medium text-accent-soft">What it does</p>
          <p className="mt-1 text-ink-3/90">
            Mapping defines where Client/Location/Responsible values are read in your travel sheet.
          </p>
          <p className="mt-2 font-medium text-accent-soft">Steps</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>
              Open <strong>Travel mapping</strong> in the settings list.
            </li>
            <li>Enter sheet column letters for Client, Location, and Responsible.</li>
            <li>Use letters only (examples: <code>P</code>, <code>Q</code>, <code>R</code>, <code>AA</code>).</li>
            <li>Click <strong>Save travel mapping</strong>.</li>
            <li>Open Time Tracker and verify travel info appears for expected dates.</li>
            <li>If values are missing, adjust letters and save again.</li>
          </ol>
        </div>
      ) : null}

      {access.time ? (
        <button type="button" onClick={() => onToggle("import")} className={README_TOGGLE_CLASS}>
          <span>Time import setup README</span>
          <span>{openReadme === "import" ? "Hide" : "Show"}</span>
        </button>
      ) : null}
      {access.time && openReadme === "import" ? (
        <div className={README_BODY_CLASS}>
          <p className="font-medium text-accent-soft">What it does</p>
          <p className="mt-1 text-ink-3/90">
            Import migrates old `hourlogger-data.json` records into this account&apos;s time tracker history.
          </p>
          <p className="mt-2 font-medium text-accent-soft">Steps</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>
              Open <strong>Time data</strong> in the settings list.
            </li>
            <li>Prepare a valid <code>hourlogger-data.json</code> export file.</li>
            <li>Upload the file using <strong>Upload old time tracking data</strong>.</li>
            <li>Wait until the success message confirms imported days.</li>
            <li>Open Time Tracker and navigate weeks to verify imported entries.</li>
            <li>If needed, rerun with corrected data file.</li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}
