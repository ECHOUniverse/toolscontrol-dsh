/**
 * Stylesheet for the two read-only overview tabs (MCP / Skills).
 *
 * Mirrors the official rc.5 plugins-page sections: every color/radius reads
 * the same `--dsw-alias-*` host tokens the shipped sections use (theme and
 * host variables propagate), each with a conservative fallback so the tabs
 * still render sensibly outside DSH. Strictly read-only styling: there is no
 * Switch/control affordance anywhere.
 *
 * @module @hanxu131/toolscontrol-dsh/client/styles
 */

export const CSS = String.raw`
.dshTc {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font: inherit;
  color: var(--dsw-alias-label-primary, inherit);
}
.dshTc * { box-sizing: border-box; }
.dshTc button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
.dshTc button:disabled { cursor: default; opacity: 0.55; }
.dshTc :focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, currentColor));
  outline-offset: 2px;
}

/* --- toolbar -------------------------------------------------------- */
.dshTcToolbar { display: flex; align-items: center; gap: 8px; }
.dshTcSearch {
  flex: 1;
  min-width: 120px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-module-platform, transparent);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.dshTcSearch::placeholder { color: var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8)); }
.dshTcBtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));
  border-radius: var(--dsw-radius-md, 8px);
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
}
.dshTcBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12)); }

/* --- meta line / notices -------------------------------------------- */
.dshTcMetaLine { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dshTcMeta, .dshTcMuted {
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,0.9));
  margin: 0;
  font-size: 13px;
  line-height: 20px;
}
.dshTcNotice {
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-state-warn-tertiary, rgba(200,150,0,0.12));
  color: var(--dsw-alias-label-secondary, inherit);
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 18px;
  display: flex;
}
.dshTcNoticeText { overflow-wrap: anywhere; }
.dshTcErrorText {
  color: var(--dsw-alias-state-error-primary, #d33);
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  display: inline-flex;
  overflow-wrap: anywhere;
}

/* --- filter pills ---------------------------------------------------- */
.dshTcPills { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dshTcPill {
  padding: 2px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
}
.dshTcPill:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12)); }
.dshTcPill[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(127,127,127,0.2));
  color: var(--dsw-alias-label-primary, inherit);
}

/* --- compact list rows ------------------------------------------------ */
.dshTcRows { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.dshTcRow {
  border-radius: var(--dsw-radius-xl, 12px);
  align-items: flex-start;
  gap: 12px;
  margin: 0 -8px;
  padding: 8px;
  display: flex;
  position: relative;
  flex-direction: column;
}
.dshTcRowHead { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; }
.dshTcRow:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08)); }
.dshTcRowIcon {
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,0.3));
  border-radius: var(--dsw-radius-lg, 10px);
  width: 36px;
  height: 36px;
  color: var(--dsw-alias-label-secondary, inherit);
  flex: none;
  justify-content: center;
  align-items: center;
  display: inline-flex;
  font-size: 15px;
  font-weight: 500;
  overflow: hidden;
}
.dshTcRowMain { display: flex; flex-direction: column; flex: 1; gap: 2px; min-width: 0; }
.dshTcTitleRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.dshTcRowOpen {
  max-width: 100%;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: 0;
  padding: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dshTcChevron {
  flex: none;
  display: inline-block;
  transition: transform 0.15s ease;
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,0.9));
  font-size: 12px;
}
.dshTcChevron[data-expanded='true'] { transform: rotate(-90deg); }
.dshTcDescription {
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,0.9));
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshTcTags { display: flex; flex-wrap: wrap; gap: 6px; }

/* --- tags & dots ------------------------------------------------------ */
.dshTcTag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: nowrap;
}
.dshTcTag[data-tone='success'] { color: var(--dsw-alias-state-success-primary, #2a7d2a); }
.dshTcTag[data-tone='error'] { color: var(--dsw-alias-state-error-primary, #d33); }
.dshTcTag[data-tone='warning'] { color: var(--dsw-alias-state-warn-primary, #b6781b); }
.dshTcTag[data-tone='info'] { color: var(--dsw-alias-state-business-primary, #2f6fdd); }
.dshTcDot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: none;
  background: var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8));
  display: inline-block;
}
.dshTcDot[data-tone='success'] { background: var(--dsw-alias-state-success-primary, #2a7d2a); }
.dshTcDot[data-tone='error'] { background: var(--dsw-alias-state-error-primary, #d33); }
.dshTcDot[data-tone='warning'] { background: var(--dsw-alias-state-warn-primary, #b6781b); }
.dshTcDot[data-tone='info'] { background: var(--dsw-alias-state-business-primary, #2f6fdd); }
.dshTcDot[data-tone='ongoing'] {
  background: var(--dsw-alias-state-business-primary, #2f6fdd);
  animation: dshTcPulse 1.6s ease-in-out infinite;
}
@keyframes dshTcPulse { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dshTcDot[data-tone='ongoing'] { animation: none; }
  .dshTcChevron { transition: none; }
}

/* --- inline detail ---------------------------------------------------- */
.dshTcDetail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 4px 0 4px 48px;
}
.dshTcFacts { margin: 0; }
.dshTcFacts > div {
  border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25));
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  min-height: 36px;
  padding: 6px 2px;
  display: flex;
}
.dshTcFacts dt { color: var(--dsw-alias-label-secondary, inherit); flex: none; font-size: 13px; line-height: 20px; }
.dshTcFacts dd { text-align: end; overflow-wrap: anywhere; min-width: 0; margin: 0; font-size: 13px; line-height: 20px; }
.dshTcCode {
  background: var(--dsw-alias-bg-module-platform, rgba(127,127,127,0.15));
  box-decoration-break: clone;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.dshTcProbe {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding-top: 4px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25));
}
.dshTcProbeHead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshTcProbeTitle { font-size: 13px; font-weight: 500; line-height: 20px; }
.dshTcProbeSummary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshTcProbeDetails { font-size: 13px; line-height: 20px; width: 100%; }
.dshTcProbeDetails > summary {
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, inherit);
  width: fit-content;
}
.dshTcProbeDetails .dshTcFacts { margin-top: 4px; }
.dshTcToolList { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; padding: 0; list-style: none; justify-content: flex-start; }

/* --- shadowed versions ------------------------------------------------ */
.dshTcShadowed { display: flex; flex-direction: column; gap: 8px; }
.dshTcShadowedTitle { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px; }
.dshTcShadowedRow {
  border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.25));
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
}

/* --- empty / loading --------------------------------------------------- */
.dshTcEmpty {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 64px 0;
}
.dshTcEmptyTitle { margin: 8px 0 0; font-size: 14px; font-weight: 500; line-height: 20px; }
.dshTcEmpty > button { margin-top: 8px; }
.dshTcSkeletonBar {
  border-radius: var(--dsw-radius-xs, 4px);
  height: 12px;
  margin: 4px 0;
  display: block;
  background: var(--dsw-alias-bg-skeleton, rgba(127,127,127,0.25));
  animation: dshTcSkeleton 2s cubic-bezier(0.36, 0, 0.64, 1) infinite;
}
.dshTcSkeletonTitle { width: min(144px, 60%); }
.dshTcSkeletonLine { width: min(280px, 85%); }
@keyframes dshTcSkeleton { 0% { opacity: 1; } 40% { opacity: 0.6; } 80%, 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .dshTcSkeletonBar { animation: none; }
}
`
