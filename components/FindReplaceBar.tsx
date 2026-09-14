"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Section, Scene } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
import { buildTextMap } from "@/lib/shared/anchor";
import {
  searchScope,
  replaceRanges,
  rangeFromOffsets,
  type FindMatch,
} from "@/lib/findReplace";

interface Props {
  sections: Section[];
  // The chapter shown in pane 1, and (side-by-side) pane 2 — the two chapters
  // currently mounted, hence the only ones whose matches can be painted/selected
  // without first navigating.
  activeChapterId: string;
  secondaryChapterId: string | null;
  onClose: () => void;
  onUpdateScene: (chapterId: string, sceneId: string, patch: Partial<Scene>) => void;
  onUpdateChapterTitle: (chapterId: string, title: string) => void;
  // Bring a chapter into a mounted editor pane so its match can be revealed.
  onNavigateToChapter: (chapterId: string) => void;
}

// ── Custom Highlight API plumbing (mirrors EditorComments) ────────────────────
type HL = { add(r: Range): void };
interface HighlightRegistry {
  CSS?: { highlights?: { set(k: string, v: HL): void; delete(k: string): void } };
  Highlight?: new (...ranges: Range[]) => HL;
}
function highlightApi() {
  const win = window as unknown as HighlightRegistry;
  const registry = win.CSS?.highlights;
  const Ctor = win.Highlight;
  return registry && Ctor ? { registry, Ctor } : null;
}
function clearFindHighlights() {
  const api = highlightApi();
  if (!api) return;
  api.registry.delete("hc-find");
  api.registry.delete("hc-find-active");
}

// The visible copy of a scene's editable body (mobile + desktop both mount the
// active chapter; the hidden one has offsetParent null).
function sceneBodyEl(sceneId: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-scene-id="${CSS.escape(sceneId)}"] [contenteditable]`
  );
  for (const n of nodes) if (n.offsetParent !== null) return n;
  return nodes[0] ?? null;
}
function chapterTitleEl(chapterId: string): HTMLInputElement | null {
  const nodes = document.querySelectorAll<HTMLInputElement>(
    `input[data-chapter-title="${CSS.escape(chapterId)}"]`
  );
  for (const n of nodes) if (n.offsetParent !== null) return n;
  return nodes[0] ?? null;
}

// ── Scope modal ───────────────────────────────────────────────────────────────
// "This chapter only" (default) confines the search to whatever chapter is active
// at search time. Turning it off enables the section/chapter tree: checking a
// section toggles all its chapters; a section reads as checked only when all of
// its chapters are.
function ScopeModal({
  sections,
  thisChapterOnly,
  checked,
  onSetThisChapterOnly,
  onSetChecked,
  onClose,
}: {
  sections: Section[];
  thisChapterOnly: boolean;
  checked: Set<string>;
  onSetThisChapterOnly: (v: boolean) => void;
  onSetChecked: (next: Set<string>) => void;
  onClose: () => void;
}) {
  const allChapterIds = useMemo(
    () => sections.flatMap((s) => s.chapters.map((c) => c.id)),
    [sections]
  );
  const allChecked = allChapterIds.length > 0 && allChapterIds.every((id) => checked.has(id));

  const toggleChapter = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSetChecked(next);
  };
  const toggleSection = (sectionId: string) => {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const ids = section.chapters.map((c) => c.id);
    const allOn = ids.length > 0 && ids.every((id) => checked.has(id));
    const next = new Set(checked);
    ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
    onSetChecked(next);
  };
  const toggleAll = () => {
    onSetChecked(allChecked ? new Set() : new Set(allChapterIds));
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-sm" backdrop="medium">
      <div className="p-5">
        <h2 className="text-sm font-medium text-text mb-4">Search in</h2>

        <Checkbox
          checked={thisChapterOnly}
          onChange={onSetThisChapterOnly}
          label={<span className="text-text">This chapter only</span>}
        />

        <div className="border-t border-border-subtle my-4" />

        {/* The tree is meaningful only when the search isn't pinned to the active
            chapter — dim + disable it while "This chapter only" is on. */}
        <div className={thisChapterOnly ? "opacity-40 pointer-events-none select-none" : ""}>
          <Checkbox
            checked={allChecked}
            onChange={toggleAll}
            label={<span className="text-text">Select all</span>}
            className="mb-3"
          />
          <div className="max-h-[46vh] overflow-y-auto flex flex-col gap-3 hc-scroll-hoverbar">
            {sections.map((section) => {
              const ids = section.chapters.map((c) => c.id);
              const sectionChecked = ids.length > 0 && ids.every((id) => checked.has(id));
              return (
                <div key={section.id} className="flex flex-col gap-2">
                  <Checkbox
                    checked={sectionChecked}
                    onChange={() => toggleSection(section.id)}
                    label={
                      <span className="text-label-m uppercase tracking-wide text-subtle">
                        {section.label || "Untitled section"}
                      </span>
                    }
                  />
                  <div className="flex flex-col gap-2 pl-6">
                    {section.chapters.map((chapter) => (
                      <Checkbox
                        key={chapter.id}
                        checked={checked.has(chapter.id)}
                        onChange={() => toggleChapter(chapter.id)}
                        label={<span className="text-text">{chapter.title || "Untitled chapter"}</span>}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
// settings-2 (assets/icon/settings-2.svg), inlined with currentColor so it tracks
// the button's subtle→text hover — assets/ isn't served, and this matches how the
// nav icons are drawn.
const OptionsIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 7H11" />
    <path d="M14 17H5" />
    <path d="M17 20C18.6569 20 20 18.6569 20 17C20 15.3431 18.6569 14 17 14C15.3431 14 14 15.3431 14 17C14 18.6569 15.3431 20 17 20Z" />
    <path d="M7 10C8.65685 10 10 8.65685 10 7C10 5.34315 8.65685 4 7 4C5.34315 4 4 5.34315 4 7C4 8.65685 5.34315 10 7 10Z" />
  </svg>
);
const ChevronLeft = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);
const ChevronRight = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);
const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export default function FindReplaceBar({
  sections,
  activeChapterId,
  secondaryChapterId,
  onClose,
  onUpdateScene,
  onUpdateChapterTitle,
  onNavigateToChapter,
}: Props) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [replaceOn, setReplaceOn] = useState(false);
  const [results, setResults] = useState<FindMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The needle the current `results` were computed for — so Enter can mean "next
  // match" once a search has run, and "run search" after the field is edited.
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const [thisChapterOnly, setThisChapterOnly] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(() => new Set([activeChapterId]));

  const findInputRef = useRef<HTMLInputElement>(null);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const isMounted = useCallback(
    (chapterId: string) => chapterId === activeChapterId || chapterId === secondaryChapterId,
    [activeChapterId, secondaryChapterId]
  );

  // Focus the field on open; seed it from any current selection, the way editors
  // do, so "select a word → Cmd+F" lands ready to search.
  useEffect(() => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length <= 200 && !sel.includes("\n")) setFindText(sel);
    const input = findInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopeIds = useCallback((): Set<string> => {
    if (thisChapterOnly) return new Set([activeChapterId]);
    return checked;
  }, [thisChapterOnly, checked, activeChapterId]);

  // Set true by an explicit find action (search / next / prev) so the reveal
  // effect knows it may navigate + scroll to the active match. Left false when
  // the effect re-runs for a passive reason — the author navigating chapters
  // themselves — so Find never yanks them back to the result's chapter.
  const wantReveal = useRef(false);

  const runSearch = useCallback(() => {
    const needle = findText;
    const found = needle ? searchScope(sectionsRef.current, scopeIds(), needle) : [];
    wantReveal.current = true;
    setResults(found);
    setSearchedFor(needle);
    setActiveIndex(found.length > 0 ? 0 : -1);
  }, [findText, scopeIds]);

  // Paint every mounted match — passive, so it runs on any relevant change (a
  // manual chapter switch included) without moving the viewport or focus.
  const paintHighlights = useCallback(() => {
    const api = highlightApi();
    if (!api) return;
    const inactive = new api.Ctor();
    const active = new api.Ctor();
    // Group mounted prose matches by scene so each body is measured once,
    // carrying each match's index so the active one gets the accent fill.
    const byScene = new Map<string, { idx: number; match: FindMatch }[]>();
    results.forEach((match, idx) => {
      if (match.sceneId == null || !isMounted(match.chapterId)) return;
      const arr = byScene.get(match.sceneId) ?? [];
      arr.push({ idx, match });
      byScene.set(match.sceneId, arr);
    });
    byScene.forEach((entries, sceneId) => {
      const el = sceneBodyEl(sceneId);
      if (!el) return;
      const map = buildTextMap(el);
      for (const { idx, match } of entries) {
        const range = rangeFromOffsets(map, match.start, match.end);
        if (!range) continue;
        if (idx === activeIndex) active.add(range);
        else inactive.add(range);
      }
    });
    api.registry.set("hc-find", inactive);
    api.registry.set("hc-find-active", active);
  }, [results, activeIndex, isMounted]);

  // Bring the active match into view — scroll to a prose match, or focus + native-
  // select a title match. Returns false until the target DOM exists (SceneBlock
  // seeds a freshly-mounted body in its own effect, a frame behind us).
  const revealActive = useCallback((r: FindMatch): boolean => {
    if (r.sceneId == null) {
      const input = chapterTitleEl(r.chapterId);
      if (!input) return false;
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(r.start, r.end);
      } catch {}
      input.scrollIntoView({ block: "nearest" });
      return true;
    }
    const el = sceneBodyEl(r.sceneId);
    if (!el) return false;
    const map = buildTextMap(el);
    const range = rangeFromOffsets(map, r.start, r.end);
    const container = el.closest<HTMLElement>(".hc-scroll-hoverbar");
    if (range && container) {
      const t = range.getBoundingClientRect();
      const v = container.getBoundingClientRect();
      const inset = Math.min(160, v.height * 0.3);
      container.scrollBy({ top: t.top - v.top - inset, behavior: "smooth" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return true;
  }, []);

  // Paint on every relevant change; only chase + reveal the active match when a
  // find action asked for it. When that match lives in an unmounted chapter,
  // navigate to it and keep `wantReveal` armed — the resulting activeChapterId
  // change re-runs this effect, which then finds it mounted and reveals it.
  useEffect(() => {
    if (findText !== searchedFor) return; // field edited since last search
    let raf = 0;
    let tries = 0;
    const tick = () => {
      paintHighlights();
      const r = activeIndex >= 0 ? results[activeIndex] : null;
      if (!r || !wantReveal.current) {
        wantReveal.current = false;
        return;
      }
      if (!isMounted(r.chapterId)) {
        onNavigateToChapter(r.chapterId);
        return; // re-runs on the activeChapterId change, wantReveal still armed
      }
      if (revealActive(r)) {
        wantReveal.current = false;
        return;
      }
      if (tries++ < 12) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    paintHighlights,
    revealActive,
    results,
    activeIndex,
    isMounted,
    onNavigateToChapter,
    findText,
    searchedFor,
  ]);

  // Drop the tint the moment the field is edited (results are now stale) and when
  // the bar unmounts.
  useEffect(() => {
    if (findText !== searchedFor) clearFindHighlights();
  }, [findText, searchedFor]);
  useEffect(() => () => clearFindHighlights(), []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (results.length === 0) return;
      wantReveal.current = true;
      setActiveIndex((i) => {
        const base = i < 0 ? (dir === 1 ? -1 : 0) : i;
        return (base + dir + results.length) % results.length;
      });
    },
    [results.length]
  );

  const onFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (findText && findText === searchedFor && results.length > 0) step(e.shiftKey ? -1 : 1);
      else runSearch();
    }
  };

  // ── Replace ───────────────────────────────────────────────────────────────
  // Persist a scene's new body. The mounted (visible) copy is edited in place so
  // the change shows immediately — SceneBlock only re-seeds innerHTML on a scene
  // switch, so a store update alone wouldn't repaint it. Unmounted scenes go
  // straight through the store, which SceneBlock will honour when next mounted.
  const writeScene = useCallback(
    (chapterId: string, sceneId: string, ranges: [number, number][], replacement: string) => {
      const live = sceneBodyEl(sceneId);
      const scene = sectionsRef.current
        .flatMap((s) => s.chapters)
        .find((c) => c.id === chapterId)
        ?.scenes.find((s) => s.id === sceneId);
      let root: HTMLElement;
      if (live && isMounted(chapterId)) {
        root = live;
      } else {
        root = document.createElement("div");
        root.innerHTML = scene?.body ?? "";
      }
      const n = replaceRanges(root, ranges, replacement);
      if (n > 0) onUpdateScene(chapterId, sceneId, { body: root.innerHTML });
      return n;
    },
    [isMounted, onUpdateScene]
  );

  const replaceTitle = useCallback(
    (chapterId: string, ranges: [number, number][], replacement: string) => {
      const chapter = sectionsRef.current.flatMap((s) => s.chapters).find((c) => c.id === chapterId);
      if (!chapter) return 0;
      let title = chapter.title ?? "";
      // Right-to-left keeps earlier offsets valid as the string shifts.
      const sorted = [...ranges].sort((a, b) => b[0] - a[0]);
      for (const [start, end] of sorted) title = title.slice(0, start) + replacement + title.slice(end);
      if (sorted.length > 0) onUpdateChapterTitle(chapterId, title);
      return sorted.length;
    },
    [onUpdateChapterTitle]
  );

  const replaceActive = useCallback(() => {
    if (activeIndex < 0 || !results[activeIndex]) return;
    const r = results[activeIndex];
    if (r.sceneId == null) replaceTitle(r.chapterId, [[r.start, r.end]], replaceText);
    else writeScene(r.chapterId, r.sceneId, [[r.start, r.end]], replaceText);
    // Offsets shift under the edit — re-scan and hold position so the arrows
    // continue from where the replaced match was. Deferred so the store update
    // has flushed into `sections` before the re-scan reads it.
    const prev = activeIndex;
    setTimeout(() => {
      const rescan = findText ? searchScope(sectionsRef.current, scopeIds(), findText) : [];
      wantReveal.current = true; // advance the view to the next match
      setResults(rescan);
      setSearchedFor(findText);
      setActiveIndex(rescan.length > 0 ? Math.min(prev, rescan.length - 1) : -1);
    }, 0);
  }, [activeIndex, results, replaceText, findText, scopeIds, replaceTitle, writeScene]);

  const replaceAll = useCallback(() => {
    if (results.length === 0) return;
    // Group by unit (title or scene) so each gets a single write carrying all of
    // its matches.
    const titleRanges = new Map<string, [number, number][]>();
    const sceneRanges = new Map<string, { chapterId: string; ranges: [number, number][] }>();
    for (const r of results) {
      if (r.sceneId == null) {
        const arr = titleRanges.get(r.chapterId) ?? [];
        arr.push([r.start, r.end]);
        titleRanges.set(r.chapterId, arr);
      } else {
        const key = r.sceneId;
        const entry = sceneRanges.get(key) ?? { chapterId: r.chapterId, ranges: [] };
        entry.ranges.push([r.start, r.end]);
        sceneRanges.set(key, entry);
      }
    }
    titleRanges.forEach((ranges, chapterId) => replaceTitle(chapterId, ranges, replaceText));
    sceneRanges.forEach((entry, sceneId) => writeScene(entry.chapterId, sceneId, entry.ranges, replaceText));
    // Everything matched is now replaced; re-scan (usually empty unless the
    // replacement itself contains the needle).
    setTimeout(() => {
      const rescan = findText ? searchScope(sectionsRef.current, scopeIds(), findText) : [];
      setResults(rescan);
      setSearchedFor(findText);
      setActiveIndex(rescan.length > 0 ? 0 : -1);
      if (rescan.length === 0) clearFindHighlights();
    }, 0);
  }, [results, replaceText, findText, scopeIds, replaceTitle, writeScene]);

  const hasResults = results.length > 0;
  const counter = searchedFor && findText === searchedFor
    ? hasResults
      ? `${activeIndex + 1}/${results.length}`
      : "0/0"
    : "";

  return (
    <div className="flex-shrink-0 bg-bg border-b border-border-subtle">
      <div className="flex items-center gap-2 px-3 h-14">
        {/* Scope options */}
        <button
          onClick={() => setShowOptions(true)}
          className="p-1.5 rounded-lg text-subtle hover:text-text hover:bg-hover transition-colors flex-shrink-0"
          title="Search options"
          aria-label="Search options"
        >
          <OptionsIcon />
        </button>

        {/* Find field */}
        <div className="relative flex items-center flex-1 min-w-0 max-w-xs">
          <svg
            className="absolute left-2.5 w-4 h-4 text-subtle pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            ref={findInputRef}
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={onFindKeyDown}
            placeholder="Find…"
            aria-label="Find"
            className="w-full bg-panel text-text text-sm pl-8 pr-14 py-2 rounded-lg border border-border-subtle placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors"
          />
          {counter && (
            <span className="absolute right-2.5 text-[11px] tabular-nums text-subtle pointer-events-none">
              {counter}
            </span>
          )}
        </div>

        {/* Submit — desktop only; on mobile Enter submits. */}
        <button
          onClick={runSearch}
          className="hidden md:inline-flex flex-shrink-0 px-3 py-2 rounded-lg bg-accent text-on-accent text-sm hover:bg-accent-hi transition-colors"
        >
          Find
        </button>

        {/* Prev / next */}
        <div className="flex items-center flex-shrink-0 rounded-lg border border-border-subtle overflow-hidden">
          <button
            onClick={() => step(-1)}
            disabled={!hasResults}
            className="px-2.5 py-2 text-subtle hover:text-text hover:bg-hover transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            title="Previous match"
            aria-label="Previous match"
          >
            <ChevronLeft />
          </button>
          <div className="w-px self-stretch bg-border-subtle" />
          <button
            onClick={() => step(1)}
            disabled={!hasResults}
            className="px-2.5 py-2 text-subtle hover:text-text hover:bg-hover transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            title="Next match"
            aria-label="Next match"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Replace controls — desktop only; the toggle gates their opacity + use. */}
        <button
          onClick={() => setReplaceOn((v) => !v)}
          role="switch"
          aria-checked={replaceOn}
          aria-label="Toggle replace"
          className="hidden md:flex items-center gap-2 flex-shrink-0 ml-1"
        >
          <span
            className={`relative w-8 h-[18px] rounded-full flex-shrink-0 transition-colors ${
              replaceOn ? "bg-accent" : "bg-hover"
            }`}
          >
            <span
              className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${
                replaceOn ? "left-[18px]" : "left-0.5"
              }`}
            />
          </span>
          <span className="text-label-m uppercase tracking-wide text-subtle">Replace</span>
        </button>

        <div
          className={`hidden md:flex items-center gap-2 flex-1 min-w-0 transition-opacity ${
            replaceOn ? "opacity-100" : "opacity-40 pointer-events-none"
          }`}
        >
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                replaceActive();
              }
            }}
            placeholder="with…"
            aria-label="Replace with"
            disabled={!replaceOn}
            className="min-w-0 flex-1 max-w-xs bg-panel text-text text-sm px-3 py-2 rounded-lg border border-border-subtle placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors"
          />
          <button
            onClick={replaceActive}
            disabled={!replaceOn || activeIndex < 0}
            className="flex-shrink-0 px-3 py-2 rounded-lg text-text text-sm hover:bg-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Replace
          </button>
          <button
            onClick={replaceAll}
            disabled={!replaceOn || !hasResults}
            className="flex-shrink-0 px-3 py-2 rounded-lg text-text text-sm hover:bg-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent whitespace-nowrap"
          >
            Replace all
          </button>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-subtle hover:text-text hover:bg-hover transition-colors flex-shrink-0 ml-auto md:ml-2"
          title="Close"
          aria-label="Close find and replace"
        >
          <CloseIcon />
        </button>
      </div>

      {showOptions && (
        <ScopeModal
          sections={sections}
          thisChapterOnly={thisChapterOnly}
          checked={checked}
          onSetThisChapterOnly={setThisChapterOnly}
          onSetChecked={setChecked}
          onClose={() => setShowOptions(false)}
        />
      )}
    </div>
  );
}
