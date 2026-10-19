(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const DEMO = !CFG.supabaseUrl || !CFG.supabaseKey;
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  const REFRESH_MS = 30000;
  const DAY_MS = 86400000;

  const $ = (id) => document.getElementById(id);
  const carById = (id) => CFG.cars.find((c) => c.id === id) || { id, name: id, color: "#888" };

  // ---------- storage (may be unavailable in private mode) ----------
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const state = {
    code: store.get("ar.code"),
    me: store.get("ar.me"),
    rows: [],
    loaded: false,
    editing: null,      // reservation being edited, or null for a new one
    car: null,          // car selected in the sheet
    durMin: 120,
  };

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, "0");
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
  const addMin = (d, n) => new Date(d.getTime() + n * 60000);
  const dateVal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeVal = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fromVals = (date, time) => {
    if (!date || !time) return null;
    const [y, m, d] = date.split("-").map(Number);
    const [h, min] = time.split(":").map(Number);
    return new Date(y, m - 1, d, h, min);
  };
  const roundUp = (d, min = 15) => {
    const ms = min * 60000;
    return new Date(Math.ceil(d.getTime() / ms) * ms);
  };
  const dayDiff = (d) => Math.round((startOfDay(d) - startOfDay(new Date())) / DAY_MS);
  const weekday = (d) => d.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
  const fmtTime = (d) => timeVal(d);
  const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;

  function dayName(d) {
    const diff = dayDiff(d);
    if (diff === 0) return "Heute";
    if (diff === 1) return "Morgen";
    if (diff === -1) return "Gestern";
    return `${weekday(d)}, ${fmtDate(d)}`;
  }
  // "14:00", "morgen 14:00", "Mi 14:00", "22.10. 14:00"
  function fmtWhen(d) {
    const diff = dayDiff(d);
    if (diff === 0) return fmtTime(d);
    if (diff === 1) return `morgen ${fmtTime(d)}`;
    if (diff > 1 && diff < 7) return `${weekday(d)} ${fmtTime(d)}`;
    return `${fmtDate(d)} ${fmtTime(d)}`;
  }
  function fmtRange(r) {
    if (dayDiff(r.start) === dayDiff(r.end)) return `${fmtTime(r.start)} – ${fmtTime(r.end)}`;
    return `${fmtTime(r.start)} – ${weekday(r.end)} ${fmtTime(r.end)}`;
  }

  const normalize = (r) => ({ ...r, start: new Date(r.starts_at), end: new Date(r.ends_at) });
  const overlaps = (r, start, end) => r.start < end && r.end > start;
  const conflictsFor = (car, start, end, ignoreId) =>
    state.rows.filter((r) => r.car === car && r.id !== ignoreId && overlaps(r, start, end));

  // ---------- backends ----------
  class AppError extends Error {}
  function toAppError(err) {
    const msg = String((err && err.message) || err);
    if (msg.includes("wrong_code")) return new AppError("wrong_code");
    if (msg.includes("overlap")) return new AppError("overlap");
    if (msg.includes("not_found")) return new AppError("not_found");
    return new AppError("network");
  }

  function demoBackend() {
    const KEY = "ar.demo.rows";
    const load = () => {
      let rows = null;
      try { rows = JSON.parse(store.get(KEY)); } catch { /* ignore */ }
      if (!rows) {
        const now = new Date();
        const at = (days, h, m = 0) => { const d = addDays(startOfDay(now), days); d.setHours(h, m); return d; };
        const p = CFG.people;
        rows = [
          { car: CFG.cars[0].id, person: p[1] || p[0], starts_at: roundUp(addMin(now, -75)), ends_at: roundUp(addMin(now, 90)), note: "Einkaufen" },
          { car: CFG.cars[1].id, person: p[2] || p[0], starts_at: at(1, 7, 30), ends_at: at(1, 16), note: "Arbeit" },
          { car: CFG.cars[0].id, person: p[0], starts_at: at(2, 17), ends_at: at(2, 19), note: "Training" },
          { car: CFG.cars[1].id, person: p[3] || p[0], starts_at: at(4, 9), ends_at: at(5, 18), note: "Ausflug" },
        ].map((r, i) => ({ id: "demo" + i, ...r, starts_at: r.starts_at.toISOString(), ends_at: r.ends_at.toISOString() }));
        save(rows);
      }
      return rows;
    };
    const save = (rows) => store.set(KEY, JSON.stringify(rows));
    const delay = () => new Promise((res) => setTimeout(res, 150));
    const checkOverlap = (rows, r, ignoreId) => {
      const s = new Date(r.starts_at), e = new Date(r.ends_at);
      if (rows.some((x) => x.car === r.car && x.id !== ignoreId && new Date(x.starts_at) < e && new Date(x.ends_at) > s)) {
        throw new AppError("overlap");
      }
    };
    return {
      async checkCode(code) { await delay(); return code.trim().toLowerCase() === "demo"; },
      async list() { await delay(); return load(); },
      async create(r) {
        await delay();
        const rows = load();
        checkOverlap(rows, r);
        const row = { id: "d" + Date.now(), ...r };
        rows.push(row); save(rows); return row;
      },
      async update(id, r) {
        await delay();
        const rows = load();
        checkOverlap(rows, r, id);
        const i = rows.findIndex((x) => x.id === id);
        if (i < 0) throw new AppError("not_found");
        rows[i] = { ...rows[i], ...r }; save(rows); return rows[i];
      },
      async remove(id) { await delay(); save(load().filter((x) => x.id !== id)); },
      subscribe(onChange) { window.addEventListener("storage", (e) => { if (e.key === KEY) onChange(); }); },
      notify() {},
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function supabaseBackend() {
    await loadScript(SUPABASE_JS);
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false } });
    const call = async (fn, args) => {
      let res;
      try { res = await sb.rpc(fn, args); } catch (e) { throw toAppError(e); }
      if (res.error) throw toAppError(res.error);
      return res.data;
    };
    const channel = sb.channel("auto-reservierer");
    let subscribed = false;
    return {
      checkCode: (code) => call("check_code", { p_code: code }),
      list: (from, to) => call("list_reservations", { p_code: state.code, p_from: from.toISOString(), p_to: to.toISOString() }),
      create: (r) => call("create_reservation", {
        p_code: state.code, p_car: r.car, p_person: r.person, p_starts: r.starts_at, p_ends: r.ends_at, p_note: r.note,
      }),
      update: (id, r) => call("update_reservation", {
        p_code: state.code, p_id: id, p_car: r.car, p_starts: r.starts_at, p_ends: r.ends_at, p_note: r.note,
      }),
      remove: (id) => call("delete_reservation", { p_code: state.code, p_id: id }),
      // Realtime "something changed" pings so every open phone refreshes instantly.
      subscribe(onChange) {
        channel.on("broadcast", { event: "changed" }, onChange).subscribe((status) => { subscribed = status === "SUBSCRIBED"; });
      },
      notify() { if (subscribed) channel.send({ type: "broadcast", event: "changed", payload: {} }).catch(() => {}); },
    };
  }

  let api = null;

  // ---------- screens ----------
  function show(screen) {
    for (const id of ["screen-code", "screen-name", "screen-main"]) $(id).hidden = id !== screen;
    $("fab").hidden = screen !== "screen-main";
    window.scrollTo(0, 0);
  }

  function showCode(error) {
    show("screen-code");
    $("code-error").hidden = !error;
    $("code-error").textContent = error || "";
    $("demo-hint").hidden = !DEMO;
    $("code-input").value = "";
  }

  function showNames() {
    show("screen-name");
    const list = $("name-list");
    list.replaceChildren(...CFG.people.map((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      if (name === state.me) b.classList.add("current");
      b.onclick = () => { state.me = name; store.set("ar.me", name); showMain(); };
      return b;
    }));
  }

  function showMain() {
    show("screen-main");
    $("me-btn").textContent = `👤 ${state.me}`;
    $("demo-banner").hidden = !DEMO;
    render();
    refresh();
  }

  // ---------- data ----------
  let refreshing = null;
  async function refresh() {
    if (!state.code) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const from = startOfDay(new Date());
        const rows = await api.list(from, addDays(from, 62));
        state.rows = rows.map(normalize).sort((a, b) => a.start - b.start);
        state.loaded = true;
        $("offline-banner").hidden = true;
        render();
        if (!$("sheet").hidden) updateSheet();
      } catch (e) {
        handleError(e);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function handleError(e) {
    if (e.message === "wrong_code") {
      state.code = null;
      store.del("ar.code");
      closeSheet();
      showCode("Der Familien-Code stimmt nicht mehr. Bitte neu eingeben.");
    } else if (e.message === "overlap") {
      toast("Zu spät – das Auto wurde gerade von jemand anderem reserviert.");
      refresh();
    } else if (e.message === "not_found") {
      toast("Diese Reservierung gibt es nicht mehr.");
      closeSheet();
      refresh();
    } else {
      $("offline-banner").hidden = false;
      if (!state.loaded) $("list").innerHTML = '<p class="muted">Konnte nicht laden. Prüfe deine Internetverbindung.</p>';
    }
  }

  // ---------- rendering ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    renderCars();
    renderWeek();
    renderList();
  }

  function renderCars() {
    const now = new Date();
    $("cars").replaceChildren(...CFG.cars.map((car) => {
      const card = el("div", "car-card");
      card.style.setProperty("--car", car.color);
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.append(el("div", "car-name", car.name));

      const mine = state.rows.filter((r) => r.car === car.id);
      const active = mine.find((r) => r.start <= now && r.end > now);
      const next = mine.find((r) => r.start > now);

      if (!state.loaded) {
        card.append(el("div", "car-detail", "Lade …"));
      } else if (active) {
        card.append(el("span", "status busy", "Unterwegs"));
        const d = el("div", "car-detail");
        d.append(el("b", null, active.person === state.me ? "Du" : active.person), ` · bis ${fmtWhen(active.end)}`);
        card.append(d);
        if (active.person === state.me) {
          const btn = el("button", "return-btn", "Ich bin zurück");
          btn.type = "button";
          btn.onclick = (ev) => { ev.stopPropagation(); returnCar(active); };
          card.append(btn);
        }
      } else {
        card.append(el("span", "status free", "Frei"));
        const d = el("div", "car-detail");
        if (next) d.append(`bis ${fmtWhen(next.start)}, dann `, el("b", null, next.person === state.me ? "du" : next.person));
        else d.textContent = "Keine Reservierung";
        card.append(d);
      }
      const open = () => openSheet({ car: car.id });
      card.onclick = open;
      card.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } };
      return card;
    }));
  }

  function renderWeek() {
    const legend = $("legend");
    legend.replaceChildren(...CFG.cars.map((c) => {
      const s = el("span");
      const dot = el("i", "dot");
      dot.style.setProperty("--car", c.color);
      s.append(dot, c.name);
      return s;
    }));

    const now = new Date();
    const today = startOfDay(now);
    const pct = (ms) => `${(ms / DAY_MS) * 100}%`;
    const children = [];

    const hours = el("div", "week-hours");
    const scale = el("div", "scale");
    for (const h of [6, 12, 18]) {
      const s = el("span", null, `${h}`);
      s.style.left = pct(h * 3600000);
      scale.append(s);
    }
    hours.append(el("span"), scale);
    children.push(hours);

    for (let i = 0; i < 7; i++) {
      const day = addDays(today, i);
      const dayEnd = addDays(today, i + 1);
      const row = el("button", "week-row");
      row.type = "button";
      row.setAttribute("aria-label", `${dayName(day)} – reservieren`);
      const label = el("div", "day-label", i === 0 ? "Heute" : i === 1 ? "Morgen" : weekday(day));
      label.append(el("small", null, fmtDate(day)));
      const lanes = el("div", "lanes");
      for (const car of CFG.cars) {
        const lane = el("div", "lane");
        lane.style.setProperty("--car", car.color);
        for (const h of [6, 12, 18]) {
          const g = el("i", "gridline");
          g.style.left = pct(h * 3600000);
          lane.append(g);
        }
        for (const r of state.rows) {
          if (r.car !== car.id || !overlaps(r, day, dayEnd)) continue;
          const s = Math.max(r.start, day) - day;
          const e = Math.min(r.end, dayEnd) - day;
          const blk = el("i", "blk" + (r.end <= now ? " past" : ""));
          blk.style.left = pct(s);
          blk.style.width = pct(e - s);
          if ((e - s) / DAY_MS > 0.12) blk.textContent = r.person;
          blk.title = `${car.name}: ${r.person}, ${fmtRange(r)}`;
          lane.append(blk);
        }
        if (i === 0) {
          const n = el("i", "now");
          n.style.left = pct(now - day);
          lane.append(n);
        }
        lanes.append(lane);
      }
      row.append(label, lanes);
      row.onclick = () => openSheet({ day });
      children.push(row);
    }
    $("week").replaceChildren(...children);
  }

  function renderList() {
    const list = $("list");
    if (!state.loaded) return;
    const now = new Date();
    const upcoming = state.rows.filter((r) => r.end > now);
    if (!upcoming.length) {
      list.replaceChildren(el("p", "muted empty", "Noch keine Reservierungen. Tippe unten auf „Reservieren“."));
      return;
    }
    const out = [];
    let lastDay = null;
    for (const r of upcoming) {
      const dayStart = r.start < now ? startOfDay(now) : startOfDay(r.start);
      if (+dayStart !== lastDay) {
        out.push(el("h3", null, dayName(dayStart)));
        lastDay = +dayStart;
      }
      const car = carById(r.car);
      const own = r.person === state.me;
      const item = el(own ? "button" : "div", "res");
      if (own) { item.type = "button"; item.onclick = () => openSheet({ edit: r }); }
      item.style.setProperty("--car", car.color);
      const main = el("div", "main");
      main.append(
        el("div", "line1", `${car.name} · ${fmtRange(r)}`),
        el("div", "line2", [own ? "Du" : r.person, r.note].filter(Boolean).join(" · "))
      );
      item.append(el("span", "bar"), main);
      if (r.start <= now) item.append(el("span", "tag live", "Jetzt"));
      if (own) item.append(el("span", "chev", "›"));
      out.push(item);
    }
    list.replaceChildren(...out);
  }

  // ---------- sheet ----------
  const f = {
    sd: $("f-start-date"), st: $("f-start-time"), ed: $("f-end-date"), et: $("f-end-time"), note: $("f-note"),
  };
  const getStart = () => fromVals(f.sd.value, f.st.value);
  const getEnd = () => fromVals(f.ed.value, f.et.value);
  function setStart(d) { f.sd.value = dateVal(d); f.st.value = timeVal(d); }
  function setEnd(d) { f.ed.value = dateVal(d); f.et.value = timeVal(d); }

  function openSheet({ car, day, edit } = {}) {
    state.editing = edit || null;
    const now = new Date();
    if (edit) {
      state.car = edit.car;
      setStart(edit.start);
      setEnd(edit.end);
      f.note.value = edit.note || "";
      state.durMin = Math.round((edit.end - edit.start) / 60000);
    } else {
      let start = roundUp(now);
      if (day && dayDiff(day) > 0) { start = new Date(day); start.setHours(8, 0, 0, 0); }
      state.durMin = 120;
      setStart(start);
      setEnd(addMin(start, state.durMin));
      f.note.value = "";
      const end = getEnd();
      state.car = car || (CFG.cars.find((c) => !conflictsFor(c.id, start, end).length) || CFG.cars[0]).id;
    }
    $("sheet-title").textContent = edit ? "Reservierung ändern" : "Auto reservieren";
    $("f-delete").hidden = !edit;
    $("sheet").hidden = false;
    document.body.style.overflow = "hidden";
    updateSheet();
  }

  function closeSheet() {
    $("sheet").hidden = true;
    document.body.style.overflow = "";
    state.editing = null;
  }

  // Re-evaluates availability, conflict message and button state for the current form values.
  function updateSheet() {
    const start = getStart(), end = getEnd();
    const ignore = state.editing && state.editing.id;
    const valid = start && end && end > start;

    $("car-pick").replaceChildren(...CFG.cars.map((car) => {
      const b = el("button", "car-opt" + (state.car === car.id ? " on" : ""));
      b.type = "button";
      b.style.setProperty("--car", car.color);
      const nm = el("span", "nm");
      const dot = el("i", "dot");
      nm.append(dot, car.name);
      b.append(nm);
      if (valid) {
        const c = conflictsFor(car.id, start, end, ignore);
        b.append(c.length
          ? el("span", "av busy", `Belegt · ${c[0].person}`)
          : el("span", "av free", "Frei"));
      }
      b.onclick = () => { state.car = car.id; updateSheet(); };
      return b;
    }));

    for (const chip of document.querySelectorAll("#dur-chips .chip-btn")) {
      chip.classList.toggle("on", valid && chip.dataset.dur === String(Math.round((end - start) / 60000)));
    }

    let msg = "";
    if (!start || !end) msg = "Bitte Start und Ende angeben.";
    else if (end <= start) msg = "Das Ende muss nach dem Start liegen.";
    else if (end <= new Date()) msg = "Diese Zeit liegt schon in der Vergangenheit.";
    else {
      const c = conflictsFor(state.car, start, end, ignore);
      if (c.length) {
        const car = carById(state.car);
        msg = `${car.name} ist dann schon reserviert: ${c[0].person}, ${dayName(c[0].start).replace(/^(Heute|Morgen|Gestern)/, (w) => w.toLowerCase())} ${fmtRange(c[0])}.`;
        const other = CFG.cars.find((x) => x.id !== state.car && !conflictsFor(x.id, start, end, ignore).length);
        if (other) msg += ` ${other.name} ist frei.`;
      }
    }
    $("form-msg").hidden = !msg;
    $("form-msg").textContent = msg;
    const submit = $("f-submit");
    submit.disabled = !!msg;
    submit.textContent = state.editing ? "Änderung speichern" : `${carById(state.car).name} reservieren`;
  }

  async function submitSheet(ev) {
    ev.preventDefault();
    const submit = $("f-submit");
    if (submit.disabled) return;
    const start = getStart(), end = getEnd();
    const data = {
      car: state.car,
      person: state.editing ? state.editing.person : state.me,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      note: f.note.value.trim(),
    };
    const wasEditing = !!state.editing;
    submit.disabled = true;
    submit.textContent = "Speichere …";
    try {
      if (wasEditing) await api.update(state.editing.id, data);
      else await api.create(data);
      const car = carById(data.car);
      closeSheet();
      toast(wasEditing ? "Gespeichert ✓" : `${car.name} reserviert ✓  ${dayName(start)} ${fmtTime(start)} – ${fmtTime(end)}`);
      api.notify();
      await refresh();
    } catch (e) {
      handleError(e);
      if (!$("sheet").hidden) updateSheet();
    }
  }

  async function deleteEditing() {
    const r = state.editing;
    if (!r || !confirm(`Reservierung für ${carById(r.car).name} (${dayName(r.start)} ${fmtRange(r)}) löschen?`)) return;
    try {
      await api.remove(r.id);
      closeSheet();
      toast("Reservierung gelöscht");
      api.notify();
      await refresh();
    } catch (e) { handleError(e); }
  }

  async function returnCar(r) {
    const now = new Date();
    try {
      if (now - r.start < 60000) await api.remove(r.id);
      else await api.update(r.id, { car: r.car, starts_at: r.start.toISOString(), ends_at: now.toISOString(), note: r.note || "" });
      toast(`${carById(r.car).name} ist wieder frei ✓`);
      api.notify();
      await refresh();
    } catch (e) { handleError(e); }
  }

  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  // ---------- events ----------
  $("code-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const code = $("code-input").value.trim();
    if (!code) return;
    await tryCode(code);
  });

  async function tryCode(code) {
    const btn = $("code-form").querySelector("button");
    btn.disabled = true;
    try {
      if (!(await api.checkCode(code))) { showCode("Dieser Code ist falsch."); return; }
      state.code = code;
      store.set("ar.code", code);
      if (state.me && CFG.people.includes(state.me)) showMain(); else showNames();
    } catch {
      showCode("Keine Verbindung. Bitte später nochmal versuchen.");
    } finally {
      btn.disabled = false;
    }
  }

  $("me-btn").onclick = showNames;
  $("logout-btn").onclick = () => { state.code = null; store.del("ar.code"); showCode(); };
  $("fab").onclick = () => openSheet();
  $("res-form").addEventListener("submit", submitSheet);
  $("f-delete").onclick = deleteEditing;
  for (const c of document.querySelectorAll("[data-close]")) c.onclick = closeSheet;
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("sheet").hidden) closeSheet(); });

  // Changing the start keeps the duration; changing the end changes the duration.
  for (const inp of [f.sd, f.st]) inp.addEventListener("change", () => {
    const s = getStart();
    if (s) setEnd(addMin(s, state.durMin));
    updateSheet();
  });
  for (const inp of [f.ed, f.et]) inp.addEventListener("change", () => {
    const s = getStart(), e = getEnd();
    if (s && e && e > s) state.durMin = Math.round((e - s) / 60000);
    updateSheet();
  });

  $("start-chips").addEventListener("click", (ev) => {
    const which = ev.target.dataset && ev.target.dataset.start;
    if (!which) return;
    let s = roundUp(new Date(), 5);
    if (which === "tomorrow") { s = addDays(startOfDay(new Date()), 1); s.setHours(8, 0, 0, 0); }
    setStart(s);
    setEnd(addMin(s, state.durMin));
    updateSheet();
  });

  $("dur-chips").addEventListener("click", (ev) => {
    const dur = ev.target.dataset && ev.target.dataset.dur;
    if (!dur) return;
    let s = getStart() || roundUp(new Date());
    if (dur === "day") {
      // From the start of the day (or now, if that's today) until the end of the day.
      const dayStart = startOfDay(s);
      s = dayDiff(dayStart) === 0 ? roundUp(new Date(), 5) : dayStart;
      setStart(s);
      const e = new Date(dayStart); e.setHours(23, 59, 0, 0);
      setEnd(e);
      state.durMin = Math.round((e - s) / 60000);
    } else {
      state.durMin = Number(dur);
      setEnd(addMin(s, state.durMin));
    }
    updateSheet();
  });

  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  setInterval(() => { if (!document.hidden && !$("screen-main").hidden) render(); }, 60000);

  // ---------- start ----------
  async function init() {
    try {
      api = DEMO ? demoBackend() : await supabaseBackend();
    } catch {
      document.body.innerHTML = '<p style="padding:24px">Konnte nicht starten. Prüfe deine Internetverbindung und lade die Seite neu.</p>';
      return;
    }
    api.subscribe(() => refresh());

    // A shared link like  …/#code=geheim  logs in directly.
    const m = location.hash.match(/code=([^&]+)/);
    if (m) {
      history.replaceState(null, "", location.pathname + location.search);
      await tryCode(decodeURIComponent(m[1]));
      return;
    }
    if (!state.code) showCode();
    else if (!state.me || !CFG.people.includes(state.me)) showNames();
    else showMain();
  }

  init();
})();
