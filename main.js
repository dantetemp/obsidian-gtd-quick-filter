"use strict";
/*
 * GTD Quick Filter — Things-style instant filtering for Obsidian.
 * One shared FilterPanel powers the sidebar view and inline ```gtd-filter```
 * blocks (scoped to a project / area / research note).
 */
const { Plugin, ItemView, Notice } = require("obsidian");

const VIEW_TYPE = "gtd-quick-filter";

const CLOSED = ["completed", "canceled", "failed"];
// body section types that count as "has notes inside the record"
const NOTE_SECTION_TYPES = new Set(["paragraph", "blockquote", "table", "callout", "code", "math", "html"]);
const SPECIFIC_STATUSES = [
  { key: "inbox", label: "Inbox" },
  { key: "next", label: "Next" },
  { key: "in progress", label: "In progress" },
  { key: "waiting", label: "Waiting" },
  { key: "postponed", label: "Postponed" },
  { key: "dependant", label: "Dependant" },
  { key: "someday", label: "Someday" },
  { key: "canceled", label: "Canceled" },
  { key: "failed", label: "Failed" },
  { key: "completed", label: "Completed" },
];

const DATE_RANGES = [
  { key: "any", label: "Any" },
  { key: "isset", label: "Is set" },
  { key: "notset", label: "Is not set" },
  { key: "availableNow", label: "Available now" },
  { key: "overdue", label: "Overdue" },
  { key: "custom", label: "Custom…" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "nextWeek", label: "Next week" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "nextMonth", label: "Next month" },
  { key: "thisYear", label: "This year" },
  { key: "lastYear", label: "Last year" },
  { key: "nextYear", label: "Next year" },
  { key: "last30", label: "Last 30 days" },
  { key: "next30", label: "Next 30 days" },
  { key: "last90", label: "Last 90 days" },
  { key: "next90", label: "Next 90 days" },
  { key: "last360", label: "Last 360 days" },
  { key: "next360", label: "Next 360 days" },
];

// created/modified are file timestamps (always ≤ now) — no future presets
const DATE_RANGES_PAST = [
  { key: "any", label: "Any" },
  { key: "custom", label: "Custom…" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "thisWeek", label: "This week" },
  { key: "lastWeek", label: "Last week" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "thisYear", label: "This year" },
  { key: "lastYear", label: "Last year" },
  { key: "last30", label: "Last 30 days" },
  { key: "last90", label: "Last 90 days" },
  { key: "last360", label: "Last 360 days" },
];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const startOfMonth = (d) => { const x = startOfDay(d); x.setDate(1); return x; };
const startOfYear = (d) => { const x = startOfDay(d); x.setMonth(0, 1); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const addYears = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };

function rangeBounds(key, now) {
  const rolling = key.match(/^(last|next)(\d+)$/);
  if (rolling) {
    const n = Number(rolling[2]);
    const lo = rolling[1] === "last" ? addDays(startOfDay(now), -n) : startOfDay(now);
    const hi = rolling[1] === "last" ? addDays(startOfDay(now), 1) : addDays(startOfDay(now), n + 1);
    return { lo: lo.getTime(), hi: hi.getTime() };
  }
  let lo, hi;
  switch (key) {
    case "today": lo = startOfDay(now); hi = addDays(lo, 1); break;
    case "yesterday": hi = startOfDay(now); lo = addDays(hi, -1); break;
    case "tomorrow": lo = addDays(startOfDay(now), 1); hi = addDays(lo, 1); break;
    case "thisWeek": lo = startOfWeek(now); hi = addDays(lo, 7); break;
    case "lastWeek": hi = startOfWeek(now); lo = addDays(hi, -7); break;
    case "nextWeek": lo = addDays(startOfWeek(now), 7); hi = addDays(lo, 7); break;
    case "thisMonth": lo = startOfMonth(now); hi = addMonths(lo, 1); break;
    case "lastMonth": hi = startOfMonth(now); lo = addMonths(hi, -1); break;
    case "nextMonth": lo = addMonths(startOfMonth(now), 1); hi = addMonths(lo, 1); break;
    case "thisYear": lo = startOfYear(now); hi = addYears(lo, 1); break;
    case "lastYear": hi = startOfYear(now); lo = addYears(hi, -1); break;
    case "nextYear": lo = addYears(startOfYear(now), 1); hi = addYears(lo, 1); break;
    default: return null;
  }
  return { lo: lo.getTime(), hi: hi.getTime() };
}

function parseDateMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00" : s);
  return isNaN(d) ? null : d.getTime();
}

// core range test on a millisecond value (null = no date)
function dateRangeMs(ms, key, custom) {
  if (key === "any") return true;
  if (key === "isset") return ms != null;
  if (key === "notset") return ms == null;
  const now = new Date();
  if (key === "availableNow") return ms == null || ms < addDays(startOfDay(now), 1).getTime();
  if (key === "custom") {
    if (ms == null) return false;
    const from = custom && custom.from ? parseDateMs(custom.from) : null;
    const to = custom && custom.to ? parseDateMs(custom.to) + 86399999 : null;
    if (from != null && ms < from) return false;
    if (to != null && ms > to) return false;
    return true;
  }
  if (ms == null) return false;
  if (key === "overdue") return ms < startOfDay(now).getTime();
  const b = rangeBounds(key, now);
  return b ? ms >= b.lo && ms < b.hi : true;
}
const matchDateRange = (rawValue, key, custom) => dateRangeMs(parseDateMs(rawValue), key, custom);
function localStamp() { // local "YYYY-MM-DDTHH:MM" for the close timestamp
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// robust to path-qualified / aliased / heading links: [[folder/name|alias#h]] -> "name"
const fmtDate = (v) => (v ? String(v).replace("T", " ") : v); // display "yyyy-mm-dd hh:mm"
const stripLink = (v) => {
  if (v == null) return null;
  let s = String(v).replace(/\[\[|\]\]/g, "").trim();
  s = s.split("|")[0].split("#")[0]; // drop alias / heading
  s = s.split("/").pop();            // basename only
  return s.trim();
};
const leaf = (tag) => tag.split("/").pop();
const top = (tag) => tag.split("/")[0];
function normList(v) {
  if (v == null || v === "") return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map(stripLink).filter(Boolean);
}
function normTags(fm) {
  let t = fm.tags;
  if (!t) return [];
  if (typeof t === "string") t = t.split(/[,\s]+/);
  if (!Array.isArray(t)) return [];
  return t.map((x) => String(x).replace(/^#/, "").trim()).filter(Boolean);
}
// case- and ё/diacritics-insensitive normalization for search
const norm = (s) => String(s).toLowerCase().replace(/ё/g, "е").normalize("NFD").replace(/[̀-ͯ]/g, "");

class FilterPanel {
  constructor(app, scopeName, scopeKind) {
    this.app = app;
    this.scopeName = scopeName || null;
    this.scopeKind = scopeKind || null; // project | area | research | null
    this.container = null;
    this.listEl = null;
    this.selected = new Set();
    this.mode = "AND";
    this.statusMode = "active"; // active | all | select
    this.statusSel = new Set(); // specific statuses when mode === select
    this.area = scopeKind === "area" ? scopeName : "all";
    this.project = scopeKind === "project" ? scopeName : "all";
    this.dueRange = "any"; this.dueFrom = ""; this.dueTo = "";
    this.startRange = "any"; this.startFrom = ""; this.startTo = "";
    this.createdRange = "any"; this.createdFrom = ""; this.createdTo = "";
    this.modifiedRange = "any"; this.modifiedFrom = ""; this.modifiedTo = "";
    this.closeRange = "any"; this.closeFrom = ""; this.closeTo = "";
    this.parentSel = "any";
    this.subtasksSel = "any";
    this.researchSel = "any";
    this.notesSel = "any";
    this.tagsSel = "any";
    this.tagNotSet = new Set(); // tag groups required to have NO tag (virtual "not set")
    this.search = "";
    this.viewMode = "list";
    this.sortMode = "auto";  // auto (due→priority) | manual (order field, drag-sortable)
    this.sortDir = "asc";    // asc | desc
    this.dragTitle = null;
    this.collapsed = false;
  }

  areaBaseline() { return this.scopeKind === "area" ? this.scopeName : "all"; }
  projBaseline() { return this.scopeKind === "project" ? this.scopeName : "all"; }

  getAllTasks() {
    const all = [];
    const parents = new Set();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm || fm.type !== "task") continue;
      const t = {
        file,
        title: file.basename,
        status: fm.status || "inbox",
        priority: typeof fm.priority === "number" ? fm.priority : 3,
        due: fm.due || null,
        start: fm.start || null,
        created: file.stat ? file.stat.ctime : null,
        modified: file.stat ? file.stat.mtime : null,
        close: fm.close || null,
        tags: normTags(fm),
        projects: normList(fm.project),
        areas: normList(fm.area),
        research: normList(fm.research),
        parent: normList(fm.parent)[0] || null,
        order: typeof fm.order === "number" ? fm.order : null,
        hasNotes: (cache?.sections || []).some((s) => NOTE_SECTION_TYPES.has(s.type)),
      };
      all.push(t);
      if (t.parent) parents.add(t.parent);
    }
    for (const t of all) t.hasSubtasks = parents.has(t.title);
    if (!this.scopeName) return all;
    return all.filter((t) =>
      t.projects.includes(this.scopeName) || t.areas.includes(this.scopeName) || t.research.includes(this.scopeName));
  }

  distinctFlat(tasks, key) {
    const set = new Set();
    for (const t of tasks) for (const v of t[key]) set.add(v);
    return [...set].sort();
  }
  tagGroups(tasks) {
    const groups = new Map();
    for (const t of tasks) for (const tag of t.tags) {
      if (!groups.has(top(tag))) groups.set(top(tag), new Set());
      groups.get(top(tag)).add(tag);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([g, set]) => [g, [...set].sort()]);
  }

  taskHasSel(t, sel) { return t.tags.some((tg) => tg === sel || tg.startsWith(sel + "/")); }
  matchesStatus(t) {
    if (this.statusMode === "all") return true;
    if (this.statusMode === "active") return !CLOSED.includes(t.status);
    return this.statusSel.has(t.status);
  }
  matchesArea(t) { return this.area === "all" || t.areas.includes(this.area); }
  matchesProject(t) {
    if (this.project === "all") return true;
    if (this.project === "__none__") return t.projects.length === 0;
    return t.projects.includes(this.project);
  }
  matchesDue(t) { return matchDateRange(t.due, this.dueRange, { from: this.dueFrom, to: this.dueTo }); }
  matchesStart(t) { return matchDateRange(t.start, this.startRange, { from: this.startFrom, to: this.startTo }); }
  matchesCreated(t) { return dateRangeMs(t.created, this.createdRange, { from: this.createdFrom, to: this.createdTo }); }
  matchesModified(t) { return dateRangeMs(t.modified, this.modifiedRange, { from: this.modifiedFrom, to: this.modifiedTo }); }
  matchesClose(t) { return matchDateRange(t.close, this.closeRange, { from: this.closeFrom, to: this.closeTo }); }
  matchesParent(t) { return this.parentSel === "any" ? true : this.parentSel === "set" ? !!t.parent : !t.parent; }
  matchesSubtasks(t) { return this.subtasksSel === "any" ? true : this.subtasksSel === "available" ? t.hasSubtasks : !t.hasSubtasks; }
  matchesResearch(t) { return this.researchSel === "any" ? true : this.researchSel === "has" ? t.research.length > 0 : t.research.length === 0; }
  matchesNotes(t) { return this.notesSel === "any" ? true : this.notesSel === "has" ? t.hasNotes : !t.hasNotes; }
  taskInGroup(t, g) { return t.tags.some((tg) => tg === g || tg.startsWith(g + "/")); }
  matchesTags(t) {
    if (this.tagsSel === "no") return t.tags.length === 0;
    if (this.tagsSel === "has" && t.tags.length === 0) return false;
    const conds = [];
    for (const s of this.selected) conds.push(this.taskHasSel(t, s));
    for (const g of this.tagNotSet) conds.push(!this.taskInGroup(t, g)); // "not set": no tag in group
    if (conds.length === 0) return true;
    return this.mode === "AND" ? conds.every(Boolean) : conds.some(Boolean);
  }
  matchesSearch(t) {
    if (!this.search) return true;
    const hay = norm([t.title, ...t.tags, ...t.projects, ...t.areas].join(" "));
    return hay.includes(norm(this.search));
  }
  matchesAll(t) {
    return this.matchesStatus(t) && this.matchesArea(t) && this.matchesProject(t)
      && this.matchesDue(t) && this.matchesStart(t) && this.matchesCreated(t) && this.matchesModified(t) && this.matchesClose(t)
      && this.matchesParent(t) && this.matchesSubtasks(t) && this.matchesResearch(t) && this.matchesNotes(t)
      && this.matchesTags(t) && this.matchesSearch(t);
  }

  computeList(all) {
    const cmp = comparator(this.sortMode);
    const dir = this.sortDir === "desc" ? -1 : 1;
    return all.filter((t) => this.matchesAll(t)).sort((a, b) => dir * cmp(a, b));
  }

  anyFilter() {
    return this.search || this.selected.size || this.tagNotSet.size || this.tagsSel !== "any"
      || this.statusMode !== "active"
      || this.area !== this.areaBaseline() || this.project !== this.projBaseline()
      || this.dueRange !== "any" || this.startRange !== "any" || this.createdRange !== "any" || this.modifiedRange !== "any" || this.closeRange !== "any"
      || this.parentSel !== "any" || this.subtasksSel !== "any" || this.researchSel !== "any" || this.notesSel !== "any";
  }

  // within a group, the parent (whole group), specific children, and "not set"
  // are mutually exclusive: selecting one clears the conflicting kinds.
  toggle(v) {
    this.tagsSel = "any";
    const g = top(v);
    if (v === g) { // selected the GROUP → clear its children + not-set
      for (const s of [...this.selected]) if (s !== g && top(s) === g) this.selected.delete(s);
      this.tagNotSet.delete(g);
    } else { // selected a CHILD → clear the group + not-set (other children stay)
      this.selected.delete(g);
      this.tagNotSet.delete(g);
    }
    this.selected.has(v) ? this.selected.delete(v) : this.selected.add(v);
    this.render();
  }
  toggleNotSet(g) {
    this.tagsSel = "any";
    for (const s of [...this.selected]) if (top(s) === g) this.selected.delete(s); // clear group + children
    this.tagNotSet.has(g) ? this.tagNotSet.delete(g) : this.tagNotSet.add(g);
    this.render();
  }

  // multi-select statuses (OR): from select mode → toggle; else start fresh single.
  // ALL/ACTIVE never combine with specific statuses.
  multiToggleStatus(key) {
    if (this.statusMode === "select") {
      this.statusSel.has(key) ? this.statusSel.delete(key) : this.statusSel.add(key);
      if (this.statusSel.size === 0) this.statusMode = "active";
    } else {
      this.statusMode = "select"; this.statusSel = new Set([key]);
    }
    this.render();
  }
  // tap = single select · long-press (mobile) or ⌘/Ctrl-click (desktop) = multi
  wireStatusTab(btn, key) {
    let timer = null, longFired = false;
    const startHold = () => { longFired = false; timer = window.setTimeout(() => { longFired = true; this.multiToggleStatus(key); }, 450); };
    const cancelHold = () => { if (timer) { window.clearTimeout(timer); timer = null; } };
    btn.addEventListener("touchstart", startHold, { passive: true });
    btn.addEventListener("touchend", cancelHold);
    btn.addEventListener("touchmove", cancelHold);
    btn.addEventListener("mousedown", startHold);
    btn.addEventListener("mouseup", cancelHold);
    btn.addEventListener("mouseleave", cancelHold);
    btn.onclick = (e) => {
      cancelHold();
      if (longFired) { longFired = false; e.preventDefault(); return; }
      if (e.metaKey || e.ctrlKey) { this.multiToggleStatus(key); return; }
      this.statusMode = "select"; this.statusSel = new Set([key]); this.render();
    };
  }

  clearAll() {
    this.selected.clear(); this.tagNotSet.clear(); this.tagsSel = "any"; this.search = "";
    this.statusMode = "active"; this.statusSel.clear();
    this.area = this.areaBaseline(); this.project = this.projBaseline();
    this.dueRange = "any"; this.dueFrom = ""; this.dueTo = "";
    this.startRange = "any"; this.startFrom = ""; this.startTo = "";
    this.createdRange = "any"; this.createdFrom = ""; this.createdTo = "";
    this.modifiedRange = "any"; this.modifiedFrom = ""; this.modifiedTo = "";
    this.closeRange = "any"; this.closeFrom = ""; this.closeTo = "";
    this.parentSel = "any"; this.subtasksSel = "any"; this.researchSel = "any"; this.notesSel = "any";
    this.render();
  }

  // custom dropdown that opens strictly BELOW the field (native <select> on
  // macOS overlaps the field; this doesn't). closedText = button label.
  closeMenus() {
    if (this.container) this.container.querySelectorAll(".qf-cs.is-open").forEach((el) => el.removeClass("is-open"));
  }
  dropdown(parent, closedText, items, current, onChange) {
    const wrap = parent.createDiv({ cls: "qf-cs" });
    wrap.createEl("button", { cls: "qf-cs-btn", text: closedText });
    const menu = wrap.createDiv({ cls: "qf-cs-menu" });
    for (const [val, label] of items) {
      const it = menu.createDiv({ cls: "qf-cs-item" + (val === current ? " is-sel" : ""), text: label });
      it.onclick = (e) => { e.stopPropagation(); this.closeMenus(); onChange(val); };
    }
    wrap.firstChild.onclick = (e) => {
      e.stopPropagation();
      const wasOpen = wrap.hasClass("is-open");
      this.closeMenus();
      if (!wasOpen) {
        wrap.addClass("is-open");
        const off = (ev) => { if (!wrap.contains(ev.target)) { wrap.removeClass("is-open"); document.removeEventListener("mousedown", off, true); } };
        setTimeout(() => document.addEventListener("mousedown", off, true), 0);
      }
    };
    return wrap;
  }

  // nearest scrollable ancestor, so re-renders don't jump to the top
  scrollEl() {
    let el = this.container ? this.container.parentElement : null;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return null;
  }

  // --- render -------------------------------------------------------------
  render() {
    const root = this.container;
    if (!root) return;
    const sc = this.scrollEl();
    const top = sc ? sc.scrollTop : 0;
    root.empty();
    root.addClass("gtd-quick-filter");
    const all = this.getAllTasks();

    const head = root.createDiv({ cls: "qf-head" });
    const colBtn = head.createEl("button", { cls: "qf-icon", text: this.collapsed ? "▸ Filters" : "▾ Filters" });
    colBtn.onclick = () => { this.collapsed = !this.collapsed; this.render(); };
    const modeBtn = head.createEl("button", { cls: "qf-icon", text: this.viewMode === "table" ? "☰ List" : "▦ Table" });
    modeBtn.onclick = () => { this.viewMode = this.viewMode === "table" ? "list" : "table"; this.render(); };
    // single sort control: shows "↕ <field> <dir>"; click a field to pick it,
    // click the current field again to flip direction.
    const curSort = SORTS.find((s) => s.key === this.sortMode) || SORTS[0];
    const arrow = this.sortDir === "desc" ? " ↓" : " ↑";
    const sortItems = SORTS.map((s) => [s.key, s.label + (s.key === this.sortMode ? arrow : "")]);
    this.dropdown(head, "Sort by " + curSort.label + arrow, sortItems, this.sortMode, (v) => {
      if (v === this.sortMode) this.sortDir = this.sortDir === "desc" ? "asc" : "desc";
      else this.sortMode = v;
      this.render();
    });

    if (!this.collapsed) this.renderControls(root, all);

    const list = this.computeList(all);
    this.listEl = root.createDiv({ cls: "qf-list" });
    this.fillList(list);
    if (sc) sc.scrollTop = top;
  }

  refreshList() {
    if (!this.listEl) return;
    const sc = this.scrollEl();
    const top = sc ? sc.scrollTop : 0;
    this.fillList(this.computeList(this.getAllTasks()));
    if (sc) sc.scrollTop = top;
  }
  fillList(list) {
    const el = this.listEl;
    el.empty();
    el.createDiv({ cls: "qf-count", text: `${list.length} tasks` });
    if (this.viewMode === "table") this.renderTable(el, list);
    else this.renderRows(el, list);
    if (!list.length) el.createDiv({ cls: "qf-empty", text: "Nothing here. Clear filters or switch tab." });
  }

  renderControls(root, all) {
    // search
    const searchInput = root.createEl("input", { cls: "qf-search", type: "text",
      attr: { placeholder: "search..." } });
    searchInput.value = this.search;
    searchInput.oninput = () => { this.search = searchInput.value; this.refreshList(); };
    searchInput.onkeydown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.search = ""; searchInput.value = ""; this.refreshList(); }
    };

    // status tabs: ACTIVE · specific (⌘/Ctrl-click = OR multi-select) · ALL · CLEAR ALL
    const tabs = root.createDiv({ cls: "qf-tabs" });
    const mkTab = (label, count, isActive, extraCls = "") =>
      tabs.createEl("button", { cls: "qf-tab" + extraCls + (isActive ? " is-active" : ""), text: `${label} ${count}` });
    mkTab("ACTIVE", all.filter((t) => !CLOSED.includes(t.status)).length, this.statusMode === "active", " qf-tab-all")
      .onclick = () => { this.statusMode = "active"; this.statusSel.clear(); this.render(); };
    for (const s of SPECIFIC_STATUSES) {
      const count = all.filter((t) => t.status === s.key).length;
      const isOn = this.statusMode === "select" && this.statusSel.has(s.key);
      this.wireStatusTab(mkTab(s.label, count, isOn), s.key);
    }
    mkTab("ALL", all.length, this.statusMode === "all")
      .onclick = () => { this.statusMode = "all"; this.statusSel.clear(); this.render(); };
    const clr = tabs.createEl("button", { cls: "qf-clear-tabs" + (this.anyFilter() ? " is-active" : ""), text: "CLEAR ALL" });
    clr.onclick = () => this.clearAll();

    const statusScoped = all.filter((t) => this.matchesStatus(t));

    // area / project (cascade)
    let areaOpts = this.distinctFlat(all.filter((t) => this.matchesProject(t)), "areas");
    let projectOpts = this.distinctFlat(all.filter((t) => this.matchesArea(t)), "projects");
    if (this.area !== "all" && !areaOpts.includes(this.area)) areaOpts = [this.area, ...areaOpts];
    if (this.project !== "all" && this.project !== "__none__" && !projectOpts.includes(this.project)) projectOpts = [this.project, ...projectOpts];

    const selBar = root.createDiv({ cls: "qf-selects" });
    const areaItems = [["all", "All areas"], ...areaOpts.map((a) => [a, a])];
    this.dropdown(selBar, this.area === "all" ? "All areas" : this.area, areaItems, this.area, (v) => { this.area = v; this.render(); });
    const projItems = [["all", "All projects"], ["__none__", "— no project —"], ...projectOpts.map((p) => [p, p])];
    const projClosed = this.project === "all" ? "All projects" : this.project === "__none__" ? "— no project —" : this.project;
    this.dropdown(selBar, projClosed, projItems, this.project, (v) => { this.project = v; this.render(); });

    // date filters: a non-breaking unit per field
    // same style as presence selects: no left label; closed-when-any shows
    // "<FIELD> DATE", list shows "ANY <FIELD> DATE"; ranges keep the field prefix.
    const labelFor = (ranges, key) => { const r = ranges.find((x) => x.key === key); return r ? r.label.toUpperCase() : ""; };
    const dateFilter = (parent, prefix, ranges, rangeKey, fromVal, toVal, setRange, setFrom, setTo) => {
      const wrap = parent.createDiv({ cls: "qf-datewrap" });
      const base = `${prefix} DATE`;
      const closed = rangeKey === "any" ? base : `${prefix} DATE · ${labelFor(ranges, rangeKey)}`;
      const items = [["any", `ANY ${prefix} DATE`],
        ...ranges.filter((r) => r.key !== "any").map((r) => [r.key, `${prefix} DATE · ${r.label.toUpperCase()}`])];
      this.dropdown(wrap, closed, items, rangeKey, (v) => { setRange(v); this.render(); });
      if (rangeKey === "custom") {
        const f = wrap.createEl("input", { type: "date", cls: "qf-dinput" }); f.value = fromVal || "";
        f.onchange = () => { setFrom(f.value); this.render(); };
        wrap.createSpan({ cls: "qf-dlabel", text: "–" });
        const t = wrap.createEl("input", { type: "date", cls: "qf-dinput" }); t.value = toVal || "";
        t.onchange = () => { setTo(t.value); this.render(); };
      }
    };
    const filterRow = root.createDiv({ cls: "qf-filters" });
    dateFilter(filterRow, "START", DATE_RANGES, this.startRange, this.startFrom, this.startTo, (v) => this.startRange = v, (v) => this.startFrom = v, (v) => this.startTo = v);
    dateFilter(filterRow, "DUE", DATE_RANGES, this.dueRange, this.dueFrom, this.dueTo, (v) => this.dueRange = v, (v) => this.dueFrom = v, (v) => this.dueTo = v);
    dateFilter(filterRow, "CREATED", DATE_RANGES_PAST, this.createdRange, this.createdFrom, this.createdTo, (v) => this.createdRange = v, (v) => this.createdFrom = v, (v) => this.createdTo = v);
    dateFilter(filterRow, "MODIFIED", DATE_RANGES_PAST, this.modifiedRange, this.modifiedFrom, this.modifiedTo, (v) => this.modifiedRange = v, (v) => this.modifiedFrom = v, (v) => this.modifiedTo = v);
    dateFilter(filterRow, "CLOSE", DATE_RANGES_PAST, this.closeRange, this.closeFrom, this.closeTo, (v) => this.closeRange = v, (v) => this.closeFrom = v, (v) => this.closeTo = v);

    // presence selects: PARENT TASK / SUBTASKS / RESEARCH / NOTES / TAGS
    // closed-when-"any" shows just the field name; the dropdown list shows "<FIELD> IS ANY"
    const presence = (parent, base, anyListText, others, current, onChange) => {
      const closed = current === "any" ? base : (others.find((o) => o[0] === current)?.[1] || base);
      const items = [["any", anyListText], ...others];
      this.dropdown(parent, closed, items, current, (v) => { onChange(v); this.render(); });
    };
    const presRow = filterRow;
    presence(presRow, "PARENT TASK", "ANY PARENT TASK", [["set", "PARENT TASK · IS SET"], ["notset", "PARENT TASK · IS NOT SET"]], this.parentSel, (v) => this.parentSel = v);
    presence(presRow, "SUBTASKS", "ANY SUBTASKS", [["available", "SUBTASKS · AVAILABLE"], ["notavailable", "SUBTASKS · NOT AVAILABLE"]], this.subtasksSel, (v) => this.subtasksSel = v);
    presence(presRow, "RESEARCH", "ANY RESEARCH", [["has", "RESEARCH · HAS ITEMS"], ["no", "RESEARCH · NO ITEMS"]], this.researchSel, (v) => this.researchSel = v);
    presence(presRow, "NOTES", "ANY NOTES", [["has", "NOTES · IS SET"], ["no", "NOTES · IS NOT SET"]], this.notesSel, (v) => this.notesSel = v);
    presence(presRow, "TAGS", "ANY TAGS", [["has", "TAGS · IS SET"], ["no", "TAGS · IS NOT SET"]], this.tagsSel, (v) => this.tagsSel = v);
    const modeBtn = presRow.createEl("button", { cls: "qf-mode", text: this.mode });
    modeBtn.onclick = () => { this.mode = this.mode === "AND" ? "OR" : "AND"; this.render(); };

    // faceted tag chips (scoped by status/area/project/dates, NOT by tag selection)
    const chipScope = statusScoped.filter((t) =>
      this.matchesArea(t) && this.matchesProject(t) && this.matchesDue(t) && this.matchesStart(t)
      && this.matchesCreated(t) && this.matchesModified(t));
    const present = new Set();
    for (const t of chipScope) for (const tg of t.tags) present.add(tg);
    for (const s of this.selected) present.add(s);
    const groups = this.tagGroups([...present].map((tag) => ({ tags: [tag] })));

    const tagBox = root.createDiv({ cls: "qf-taggroups" });
    for (const [g, full] of groups) {
      const group = tagBox.createDiv({ cls: "qf-group" });
      const pchip = group.createEl("button", { cls: "qf-chip qf-parent" + (this.selected.has(g) ? " is-on" : ""), text: g });
      pchip.onclick = () => this.toggle(g);
      const ns = group.createEl("button", { cls: "qf-chip qf-child qf-notset" + (this.tagNotSet.has(g) ? " is-on" : ""), text: "not set", attr: { title: `no ${g}/* tag` } });
      ns.onclick = () => this.toggleNotSet(g);
      for (const tag of full) {
        if (tag === g) continue;
        const chip = group.createEl("button", { cls: "qf-chip qf-child" + (this.selected.has(tag) ? " is-on" : ""), text: leaf(tag) });
        chip.onclick = () => this.toggle(tag);
      }
    }
  }

  tagSpan(meta, tag) { meta.createSpan({ cls: `qf-ctx qf-tg-${top(tag)}`, text: leaf(tag), attr: { title: tag } }); }

  buildTree(list) {
    const inList = new Set(list.map((t) => t.title));
    const childrenOf = new Map();
    let roots = [];
    for (const t of list) {
      if (t.parent && t.parent !== t.title && inList.has(t.parent)) {
        if (!childrenOf.has(t.parent)) childrenOf.set(t.parent, []);
        childrenOf.get(t.parent).push(t);
      } else roots.push(t);
    }
    if (roots.length === 0 && list.length) roots = list.slice(); // cyclic data → flat fallback
    return { roots, childrenOf };
  }

  renderRows(listEl, list) {
    const { roots, childrenOf } = this.buildTree(list);
    const seen = new Set();
    const renderNode = (task, depth) => {
      if (seen.has(task.title)) return; // cycle guard
      seen.add(task.title);
      this.renderRow(listEl, task, depth);
      for (const c of childrenOf.get(task.title) || []) renderNode(c, depth + 1);
    };
    for (const r of roots) renderNode(r, 0);
  }

  renderRow(listEl, task, depth) {
    const row = listEl.createDiv({ cls: "qf-row" });
    if (depth) row.style.paddingLeft = `${4 + depth * 28}px`; // align child checkbox under parent's text
    this.makeStatusControl(row, task);
    const main = row.createDiv({ cls: "qf-main" });
    main.createDiv({ cls: "qf-title", text: (depth ? "↳ " : "") + task.title });
    const meta = main.createDiv({ cls: "qf-meta" });
    if (task.start) meta.createSpan({ cls: "qf-start", text: "▶ " + fmtDate(task.start) });
    if (task.due) meta.createSpan({ cls: "qf-due", text: fmtDate(task.due) });
    for (const p of task.projects) meta.createSpan({ cls: "qf-proj", text: p });
    for (const a of task.areas) meta.createSpan({ cls: "qf-area", text: a });
    for (const tg of task.tags) this.tagSpan(meta, tg);
    if (task.research.length) meta.createSpan({ cls: "qf-flag", text: `🔎${task.research.length}`, attr: { title: `${task.research.length} linked research note(s)` } });
    if (task.hasNotes) meta.createSpan({ cls: "qf-flag", text: "✎", attr: { title: "has notes in the body" } });
    if (task.hasSubtasks) meta.createSpan({ cls: "qf-flag", text: "⊞", attr: { title: "has subtasks" } });
    if (task.close) meta.createSpan({ cls: "qf-flag", text: "✔ " + fmtDate(task.close), attr: { title: "closed at" } });
    row.onclick = (e) => this.openOrCreate(task, e);
    // drag & drop: reorder · drop ON a row → make it a sub-task · drop in the gap → sibling
    row.draggable = true;
    row.ondragstart = (e) => { this.dragTitle = task.title; e.dataTransfer.effectAllowed = "move"; };
    row.ondragover = (e) => { e.preventDefault(); this.markDrop(row, this.dropZone(row, e)); };
    row.ondragleave = () => this.clearDrop(row);
    row.ondrop = (e) => { e.preventDefault(); const z = this.dropZone(row, e); this.clearDrop(row); this.handleDrop(task, z); };
  }

  renderTable(listEl, list) {
    const table = listEl.createEl("table", { cls: "qf-table" });
    const thead = table.createEl("tr");
    ["", "Task", "Status", "P", "Due", "Project"].forEach((h) => thead.createEl("th", { text: h }));
    for (const task of list) {
      const tr = table.createEl("tr", { cls: "qf-trow" });
      this.makeStatusControl(tr.createEl("td"), task);
      const titleCell = tr.createEl("td", { cls: "qf-tcell-title", text: task.title });
      titleCell.onclick = (e) => this.openOrCreate(task, e);
      tr.createEl("td", { text: task.status });
      tr.createEl("td", { text: String(task.priority) });
      tr.createEl("td", { text: fmtDate(task.due) || "" });
      tr.createEl("td", { text: task.projects.join(", ") });
    }
  }

  makeStatusControl(cell, task) {
    if (task.status === "canceled" || task.status === "failed") {
      const x = cell.createSpan({ cls: "qf-mark qf-canceled", text: "✕", attr: { title: `${task.status} — click to reopen` } });
      x.onclick = (e) => { e.stopPropagation(); this.setStatus(task, "next"); };
      return;
    }
    const box = cell.createEl("input", { type: "checkbox", cls: "qf-check", attr: { title: "click: complete · ⌥/⌘-click: cancel" } });
    box.checked = task.status === "completed";
    box.onclick = (e) => {
      e.stopPropagation();
      if (e.altKey || e.metaKey) { this.setStatus(task, "canceled"); return; }
      this.setStatus(task, box.checked ? "completed" : "next");
    };
  }

  async setStatus(task, status) {
    await this.app.fileManager.processFrontMatter(task.file, (fm) => {
      fm.status = status;
      fm.close = CLOSED.includes(status) ? localStamp() : ""; // stamp when closed, clear when reopened
    });
    this.render();
  }

  // --- drag & drop --------------------------------------------------------
  dropZone(row, e) {
    const r = row.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < r.height * 0.30) return "before";
    if (y > r.height * 0.70) return "after";
    return "child";
  }
  markDrop(row, zone) {
    row.classList.remove("qf-drop-before", "qf-drop-after", "qf-drop-child");
    row.classList.add("qf-drop-" + zone);
  }
  clearDrop(row) { row.classList.remove("qf-drop-before", "qf-drop-after", "qf-drop-child"); }
  isAncestor(maybeAncestor, node, byTitle) {
    let cur = node; const seen = new Set();
    while (cur) {
      if (cur.title === maybeAncestor.title) return true;
      if (seen.has(cur.title)) break;
      seen.add(cur.title);
      cur = cur.parent ? byTitle.get(cur.parent) : null;
    }
    return false;
  }
  async handleDrop(targetTask, zone) {
    const dragTitle = this.dragTitle; this.dragTitle = null;
    if (!dragTitle || dragTitle === targetTask.title) return;
    const all = this.getAllTasks();
    const byTitle = new Map(all.map((t) => [t.title, t]));
    const dragTask = byTitle.get(dragTitle);
    if (!dragTask) return;
    if (this.isAncestor(dragTask, targetTask, byTitle)) return; // would create a cycle

    let newParent, newOrder;
    if (zone === "child") {
      newParent = targetTask.title;
      const kids = all.filter((t) => t.parent === targetTask.title && t.title !== dragTitle).sort(byManualOrder);
      newOrder = kids.length ? numOrder(kids[0]) - 1 : 0;
    } else {
      newParent = targetTask.parent || null;
      const sibs = all.filter((t) => (t.parent || null) === newParent && t.title !== dragTitle).sort(byManualOrder);
      const idx = sibs.findIndex((t) => t.title === targetTask.title);
      const prev = zone === "before" ? sibs[idx - 1] : sibs[idx];
      const next = zone === "before" ? sibs[idx] : sibs[idx + 1];
      const po = prev ? numOrder(prev) : (next ? numOrder(next) - 2 : 0);
      const no = next ? numOrder(next) : po + 2;
      newOrder = (po + no) / 2;
    }
    await this.app.fileManager.processFrontMatter(dragTask.file, (fm) => {
      fm.parent = newParent ? `[[${newParent}]]` : "";
      fm.order = newOrder;
    });
    this.sortMode = "manual";
    this.render();
  }

  // click → open · ⌘/Ctrl-click → new sibling task · ⌥-click → new sub-task
  openOrCreate(task, e) {
    if (e.altKey) this.createTask(task, true);
    else if (e.metaKey || e.ctrlKey) this.createTask(task, false);
    else this.app.workspace.getLeaf(false).openFile(task.file);
  }
  linkField(arr) {
    if (!arr.length) return "";
    if (arr.length === 1) return `"[[${arr[0]}]]"`;
    return "[" + arr.map((x) => `"[[${x}]]"`).join(", ") + "]";
  }
  uniquePath(dir, base) {
    let name = base, i = 2;
    while (this.app.vault.getAbstractFileByPath(`${dir}${name}.md`)) name = `${base} ${i++}`;
    return `${dir}${name}.md`;
  }
  async createTask(task, asSubtask) {
    const p = task.file.parent ? task.file.parent.path : "";
    const dir = p && p !== "/" ? p + "/" : "";
    const body = [
      "---", "type: task", `status: ${asSubtask ? "next" : task.status}`, `priority: ${task.priority}`,
      `due: ${task.due || ""}`, `start: ${task.start || ""}`,
      `order: ${task.order != null ? task.order + 0.5 : ""}`,
      `project: ${this.linkField(task.projects)}`,
      asSubtask ? `parent: "[[${task.title}]]"` : "parent:",
      `area: ${this.linkField(task.areas)}`, "research:", "tags: []", "---", "", "## Notes", "",
    ].join("\n");
    const path = this.uniquePath(dir, asSubtask ? `${task.title} — subtask` : "New task");
    const file = await this.app.vault.create(path, body);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.selectInlineTitle(leaf);
  }
  // focus + select the note's inline title so typing renames the new note.
  // Obsidian commits the rename natively on Enter / blur-to-body.
  selectInlineTitle(leaf) {
    window.setTimeout(() => {
      const el = leaf.view && leaf.view.containerEl ? leaf.view.containerEl.querySelector(".inline-title") : null;
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, 60);
  }
}

function byDueThenPriority(a, b) {
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return (a.created || 0) - (b.created || 0); // newer just after its source
}
const numOrder = (t) => (t.order == null ? (t.created || 0) : t.order);
function byManualOrder(a, b) {
  const d = numOrder(a) - numOrder(b);
  return d !== 0 ? d : (a.created || 0) - (b.created || 0);
}
function cmpDue(a, b) {
  if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  return 0;
}
const SORTS = [
  { key: "auto", label: "Smart" },
  { key: "manual", label: "Manual" },
  { key: "due", label: "Due date" },
  { key: "priority", label: "Priority" },
  { key: "created", label: "Created" },
  { key: "modified", label: "Modified" },
  { key: "title", label: "Title" },
];
function comparator(mode) {
  switch (mode) {
    case "manual": return byManualOrder;
    case "due": return (a, b) => cmpDue(a, b) || (a.priority - b.priority) || ((a.created || 0) - (b.created || 0));
    case "priority": return (a, b) => (a.priority - b.priority) || cmpDue(a, b) || ((a.created || 0) - (b.created || 0));
    case "created": return (a, b) => (a.created || 0) - (b.created || 0);
    case "modified": return (a, b) => (a.modified || 0) - (b.modified || 0);
    case "title": return (a, b) => a.title.localeCompare(b.title);
    default: return byDueThenPriority;
  }
}

class QuickFilterView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "GTD Quick Filter"; }
  getIcon() { return "filter"; }
  async onOpen() {
    this.panel = new FilterPanel(this.app, null);
    this.panel.container = this.contentEl;
    this.plugin.panels.add(this.panel);
    this.panel.render();
  }
  async onClose() { this.plugin.panels.delete(this.panel); }
}

module.exports = class QuickFilterPlugin extends Plugin {
  async onload() {
    this.panels = new Set();
    this.registerView(VIEW_TYPE, (leaf) => new QuickFilterView(leaf, this));
    this.addRibbonIcon("filter", "GTD Quick Filter", () => this.activateView());
    this.addCommand({ id: "open-gtd-quick-filter", name: "Open GTD Quick Filter", callback: () => this.activateView() });
    this.addCommand({
      id: "toggle-filter-controls", name: "Toggle filter controls (collapse/expand)",
      callback: () => { const v = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view; if (v?.panel) { v.panel.collapsed = !v.panel.collapsed; v.panel.render(); } },
    });
    this.registerMarkdownCodeBlockProcessor("gtd-filter", (source, el, ctx) => {
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      let scopeKind = null;
      if (file) {
        const type = this.app.metadataCache.getFileCache(file)?.frontmatter?.type;
        scopeKind = type === "area" ? "area" : type === "project" ? "project" : type === "research" ? "research" : null;
      }
      const panel = new FilterPanel(this.app, file ? file.basename : null, scopeKind);
      panel.container = el;
      this.panels.add(panel);
      panel.render();
    });
    const refresh = () => { for (const p of [...this.panels]) { if (p.container && p.container.isConnected) p.render(); else this.panels.delete(p); } };
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.metadataCache.on("resolve", refresh));

    // stamp/clear `close` whenever a task's status changes by ANY means (manual edits too)
    this._reconciling = false;
    this.registerEvent(this.app.metadataCache.on("changed", (file) => this.reconcileClose(file)));
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false) || workspace.getLeaf(true); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    workspace.revealLeaf(leaf);
  }
  async reconcileClose(file) {
    if (this._reconciling) return;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fm.type !== "task") return;
    const closed = CLOSED.includes(fm.status);
    const hasClose = fm.close != null && fm.close !== "";
    if (closed === hasClose) return; // consistent: (closed & stamped) or (open & empty)
    this._reconciling = true;
    try {
      await this.app.fileManager.processFrontMatter(file, (f) => {
        if (CLOSED.includes(f.status)) { if (!f.close) f.close = localStamp(); }
        else { f.close = ""; }
      });
    } catch (e) { /* ignore */ } finally { this._reconciling = false; }
  }

  onunload() {}
};
