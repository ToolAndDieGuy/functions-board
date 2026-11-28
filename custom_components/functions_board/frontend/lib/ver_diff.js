import { canon, humanize, shorten, toList } from './constants.js';
import { T } from './i18n.js';

/* ---------- plain-English version diffs (0.16.0) ----------
   Compares two saved configs (or a saved version vs live config) and turns raw JSON differences into
   human-readable change sentences: "Waits 15 min instead of 10 min", "Added trigger: ...", "Run mode
   changed from single to restart", etc. */

// Format a Home Assistant duration value ({hours, minutes, seconds}, "HH:MM:SS", or seconds number)
export function fmtDiffDur(v) {
  if (v == null || v === '') return null;
  let total = null;
  if (typeof v === 'number' && Number.isFinite(v)) total = Math.round(v);
  else if (typeof v === 'string') {
    const m = v.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) total = (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
    else if (/^\d+(\.\d+)?$/.test(v.trim())) total = Math.round(+v.trim());
    else return v.trim();
  } else if (typeof v === 'object' && !Array.isArray(v)) {
    const h = +(v.hours || 0), mi = +(v.minutes || 0), s = +(v.seconds || 0), d = +(v.days || 0);
    if ([h, mi, s, d].some((x) => !Number.isFinite(x))) return JSON.stringify(v);
    total = Math.round(d * 86400 + h * 3600 + mi * 60 + s);
  }
  if (total == null || !Number.isFinite(total)) return String(v);
  const parts = [];
  const days = Math.floor(total / 86400); total %= 86400;
  const hrs = Math.floor(total / 3600); total %= 3600;
  const mins = Math.floor(total / 60); const secs = total % 60;
  if (days) parts.push(`${days} d`);
  if (hrs) parts.push(`${hrs} h`);
  if (mins) parts.push(`${mins} min`);
  if (secs || !parts.length) parts.push(`${secs} s`);
  return parts.join(' ');
}

function valText(v) {
  if (v == null) return 'none';
  if (Array.isArray(v)) return v.map(valText).join(', ');
  if (typeof v === 'object') return shorten(JSON.stringify(v), 60);
  return String(v);
}

function trigSummary(t, nm) {
  if (!t || typeof t !== 'object') return 'trigger';
  const kind = t.trigger || t.platform || 'trigger';
  const ents = toList(t.entity_id).map(nm).join(', ');
  if (kind === 'state') {
    const parts = [ents || 'entity'];
    if (t.from != null) parts.push(`from ${valText(t.from)}`);
    if (t.to != null) parts.push(`to ${valText(t.to)}`);
    if (t.for != null) parts.push(`for ${fmtDiffDur(t.for)}`);
    return parts.join(' ');
  }
  if (kind === 'numeric_state') {
    const parts = [ents || 'entity'];
    if (t.above != null) parts.push(`above ${t.above}`);
    if (t.below != null) parts.push(`below ${t.below}`);
    if (t.for != null) parts.push(`for ${fmtDiffDur(t.for)}`);
    return parts.join(' ');
  }
  if (kind === 'time') return `time at ${valText(t.at)}`;
  if (kind === 'time_pattern') return `time pattern`;
  if (kind === 'sun') return `${t.event || 'sun'}${t.offset ? ' ' + t.offset : ''}`;
  if (kind === 'event') return `event ${valText(t.event_type)}`;
  if (kind === 'mqtt') return `MQTT ${t.topic || ''}`.trim();
  if (kind === 'template') return `template ${shorten(t.value_template || '', 45)}`;
  if (kind === 'homeassistant') return `Home Assistant ${t.event || 'start'}`;
  if (kind === 'device') return `device ${t.type || t.domain || 'event'}`;
  return ents ? `${humanize(kind)} (${ents})` : humanize(kind);
}

function trigKey(t) {
  if (!t || typeof t !== 'object') return '';
  if (t.id) return 'id:' + t.id;
  const kind = t.trigger || t.platform || '';
  const ent = toList(t.entity_id).join(',');
  return [kind, ent, t.event_type || '', t.topic || '', t.event || '', t.device_id || ''].join('|');
}

function condSummary(c, nm) {
  if (typeof c === 'string') return `template ${shorten(c, 45)}`;
  if (!c || typeof c !== 'object') return 'condition';
  const kind = c.condition || 'condition';
  const ents = toList(c.entity_id).map(nm).join(', ');
  if (kind === 'state') return `${ents || 'entity'} is ${valText(c.state)}`;
  if (kind === 'numeric_state') {
    return [ents || 'entity', c.above != null ? `above ${c.above}` : '', c.below != null ? `below ${c.below}` : ''].filter(Boolean).join(' ');
  }
  if (kind === 'time') {
    return ['time', c.after ? `after ${c.after}` : '', c.before ? `before ${c.before}` : '', c.weekday ? `on ${valText(c.weekday)}` : ''].filter(Boolean).join(' ');
  }
  if (kind === 'template') return `template ${shorten(c.value_template || '', 45)}`;
  if (kind === 'sun') return `sun (${[c.after ? 'after ' + c.after : '', c.before ? 'before ' + c.before : ''].filter(Boolean).join(', ') || 'check'})`;
  if (kind === 'and' || kind === 'or' || kind === 'not') return `${kind} (${toList(c.conditions).length} checks)`;
  return ents ? `${humanize(kind)} (${ents})` : humanize(kind);
}

function condKey(c) {
  if (typeof c === 'string') return 'tpl:' + c;
  if (!c || typeof c !== 'object') return '';
  return [c.condition || '', toList(c.entity_id).join(','), c.alias || ''].join('|');
}

function actSummary(a, nm) {
  if (!a || typeof a !== 'object') return 'step';
  if (a.alias) return a.alias;
  const svc = a.action || a.service;
  if (typeof svc === 'string') {
    const tgt = a.target || {};
    const ents = toList(tgt.entity_id || a.entity_id || (a.data && a.data.entity_id)).map(nm).join(', ');
    return ents ? `${svc} on ${ents}` : svc;
  }
  if (a.delay != null) return `wait ${fmtDiffDur(a.delay)}`;
  if (a.wait_for_trigger != null) return 'wait for trigger';
  if (a.wait_template != null) return `wait for template`;
  if (a.condition != null) return `check ${condSummary(a, nm)}`;
  if (a.if != null) return 'if / then branch';
  if (a.choose != null) return `choose (${toList(a.choose).length} options)`;
  if (a.repeat != null) return 'repeat block';
  if (a.event != null) return `fire event ${a.event}`;
  if (a.stop != null) return `stop (${shorten(a.stop, 30)})`;
  if (a.variables != null) return 'set variables';
  if (a.device_id != null && a.type) return `device ${a.type}`;
  return 'step';
}

function actKey(a) {
  if (!a || typeof a !== 'object') return '';
  if (a.alias) return 'alias:' + a.alias;
  const svc = a.action || a.service;
  if (typeof svc === 'string') {
    const tgt = a.target || {};
    return 'svc:' + svc + '|' + toList(tgt.entity_id || a.entity_id).join(',');
  }
  if (a.delay != null) return 'delay';
  if (a.wait_for_trigger != null) return 'wait_trigger';
  if (a.wait_template != null) return 'wait_tpl';
  if (a.if != null) return 'if';
  if (a.choose != null) return 'choose';
  if (a.repeat != null) return 'repeat';
  if (a.event != null) return 'event:' + a.event;
  if (a.condition != null) return 'cond:' + a.condition;
  return '';
}

// Pair items from two lists by exact canon match first, then by structural key, then positional
function pairLists(listA, listB, keyFn) {
  const usedA = new Set(), usedB = new Set();
  const pairs = []; // [idxA, idxB]
  // 1. exact matches
  listA.forEach((a, i) => {
    const ca = canon(a);
    const j = listB.findIndex((b, idx) => !usedB.has(idx) && canon(b) === ca);
    if (j >= 0) { usedA.add(i); usedB.add(j); }
  });
  // 2. same structural key (modified in place)
  listA.forEach((a, i) => {
    if (usedA.has(i)) return;
    const ka = keyFn(a);
    if (!ka) return;
    const j = listB.findIndex((b, idx) => !usedB.has(idx) && keyFn(b) === ka);
    if (j >= 0) { usedA.add(i); usedB.add(j); pairs.push([i, j]); }
  });
  // 3. positional fallback if same count left in same spot
  const remA = listA.map((_, i) => i).filter((i) => !usedA.has(i));
  const remB = listB.map((_, i) => i).filter((i) => !usedB.has(i));
  const removed = remA.map((i) => ({ idx: i, item: listA[i] }));
  const added = remB.map((j) => ({ idx: j, item: listB[j] }));
  return { pairs, removed, added };
}

function diffTriggerPair(a, b, nm, out) {
  const label = trigSummary(b, nm);
  if (a.enabled !== b.enabled) {
    out.push({ kind: 'changed', area: 'trigger', text: b.enabled === false ? T('vd_trig_disabled', { what: label }) : T('vd_trig_enabled', { what: label }) });
  }
  if (canon(a.for) !== canon(b.for)) {
    const da = fmtDiffDur(a.for), db = fmtDiffDur(b.for);
    if (da && db) out.push({ kind: 'changed', area: 'trigger', text: T('vd_waits_instead', { newDur: db, oldDur: da }) });
    else if (db) out.push({ kind: 'changed', area: 'trigger', text: T('vd_trig_for_added', { what: label, dur: db }) });
    else out.push({ kind: 'changed', area: 'trigger', text: T('vd_trig_for_removed', { what: label, dur: da }) });
  }
  if (canon(a.to) !== canon(b.to)) out.push({ kind: 'changed', area: 'trigger', text: T('vd_field_changed', { field: 'Trigger target state', old: valText(a.to), now: valText(b.to) }) });
  if (canon(a.from) !== canon(b.from)) out.push({ kind: 'changed', area: 'trigger', text: T('vd_field_changed', { field: 'Trigger from state', old: valText(a.from), now: valText(b.from) }) });
  if (a.above !== b.above) out.push({ kind: 'changed', area: 'trigger', text: T('vd_field_changed', { field: 'Trigger above threshold', old: valText(a.above), now: valText(b.above) }) });
  if (a.below !== b.below) out.push({ kind: 'changed', area: 'trigger', text: T('vd_field_changed', { field: 'Trigger below threshold', old: valText(a.below), now: valText(b.below) }) });
  if (canon(a.at) !== canon(b.at)) out.push({ kind: 'changed', area: 'trigger', text: T('vd_field_changed', { field: 'Trigger time', old: valText(a.at), now: valText(b.at) }) });
  if (a.offset !== b.offset) out.push({ kind: 'changed', area: 'trigger', text: T('vd_field_changed', { field: 'Sun offset', old: valText(a.offset), now: valText(b.offset) }) });
  if (a.value_template !== b.value_template) out.push({ kind: 'changed', area: 'template', text: T('vd_tpl_changed', { where: 'trigger' }) });
}

function diffCondPair(a, b, nm, out) {
  const label = condSummary(b, nm);
  if (a.enabled !== b.enabled) {
    out.push({ kind: 'changed', area: 'condition', text: b.enabled === false ? T('vd_cond_disabled', { what: label }) : T('vd_cond_enabled', { what: label }) });
  }
  if (canon(a.for) !== canon(b.for)) {
    const da = fmtDiffDur(a.for), db = fmtDiffDur(b.for);
    if (da && db) out.push({ kind: 'changed', area: 'condition', text: T('vd_waits_instead', { newDur: db, oldDur: da }) });
    else if (db) out.push({ kind: 'changed', area: 'condition', text: T('vd_cond_for_added', { what: label, dur: db }) });
    else out.push({ kind: 'changed', area: 'condition', text: T('vd_cond_for_removed', { what: label, dur: da }) });
  }
  if (canon(a.state) !== canon(b.state)) out.push({ kind: 'changed', area: 'condition', text: T('vd_field_changed', { field: 'Condition state', old: valText(a.state), now: valText(b.state) }) });
  if (a.above !== b.above) out.push({ kind: 'changed', area: 'condition', text: T('vd_field_changed', { field: 'Condition above', old: valText(a.above), now: valText(b.above) }) });
  if (a.below !== b.below) out.push({ kind: 'changed', area: 'condition', text: T('vd_field_changed', { field: 'Condition below', old: valText(a.below), now: valText(b.below) }) });
  if (a.after !== b.after || a.before !== b.before) {
    const oldW = [a.after ? `after ${a.after}` : '', a.before ? `before ${a.before}` : ''].filter(Boolean).join(' ') || 'any time';
    const newW = [b.after ? `after ${b.after}` : '', b.before ? `before ${b.before}` : ''].filter(Boolean).join(' ') || 'any time';
    out.push({ kind: 'changed', area: 'condition', text: T('vd_field_changed', { field: 'Time window', old: oldW, now: newW }) });
  }
  if (canon(a.weekday) !== canon(b.weekday)) out.push({ kind: 'changed', area: 'condition', text: T('vd_field_changed', { field: 'Weekdays', old: valText(a.weekday), now: valText(b.weekday) }) });
  if (a.value_template !== b.value_template) out.push({ kind: 'changed', area: 'template', text: T('vd_tpl_changed', { where: 'condition' }) });
}

function diffActionPair(a, b, nm, out) {
  const n0 = out.length;
  const label = actSummary(b, nm);
  if (a.enabled !== b.enabled) {
    out.push({ kind: 'changed', area: 'action', text: b.enabled === false ? T('vd_act_disabled', { what: label }) : T('vd_act_enabled', { what: label }) });
  }
  if (a.delay != null && b.delay != null && canon(a.delay) !== canon(b.delay)) {
    out.push({ kind: 'changed', area: 'action', text: T('vd_waits_instead', { newDur: fmtDiffDur(b.delay), oldDur: fmtDiffDur(a.delay) }) });
    return;
  }
  if (a.timeout != null || b.timeout != null) {
    if (canon(a.timeout) !== canon(b.timeout)) {
      const da = fmtDiffDur(a.timeout), db = fmtDiffDur(b.timeout);
      if (da && db) out.push({ kind: 'changed', area: 'action', text: T('vd_timeout_instead', { newDur: db, oldDur: da }) });
      else if (db) out.push({ kind: 'changed', area: 'action', text: T('vd_field_changed', { field: `${label} timeout`, old: 'none', now: db }) });
      else out.push({ kind: 'changed', area: 'action', text: T('vd_field_changed', { field: `${label} timeout`, old: da, now: 'none' }) });
    }
  }
  const da = a.data || {}, db = b.data || {};
  const dataKeys = new Set([...Object.keys(da), ...Object.keys(db)]);
  for (const k of dataKeys) {
    if (canon(da[k]) === canon(db[k])) continue;
    out.push({ kind: 'changed', area: 'action', text: T('vd_act_param', { what: label, key: k, old: shorten(valText(da[k]), 35), now: shorten(valText(db[k]), 35) }) });
  }
  if (canon(a.target) !== canon(b.target)) {
    out.push({ kind: 'changed', area: 'action', text: T('vd_act_target', { what: label }) });
  }
  if (out.length === n0) {
    out.push({ kind: 'changed', area: 'action', text: T('vd_act_updated', { what: label }) });
  }
}

export function diffConfigs(before, after, kind, opts = {}) {
  const nm = opts.name || ((x) => x);
  if (canon(before) === canon(after)) return [];
  const a = before && typeof before === 'object' ? before : {};
  const b = after && typeof after === 'object' ? after : {};
  const out = [];

  if (kind === 'automation' || kind === 'script') {
    if ((a.alias || '') !== (b.alias || '')) {
      out.push({ kind: 'changed', area: 'alias', text: T('vd_renamed', { old: a.alias || 'unnamed', now: b.alias || 'unnamed' }) });
    }
    if ((a.description || '') !== (b.description || '')) {
      out.push({ kind: 'changed', area: 'setting', text: T('vd_desc_changed') });
    }
    const ma = a.mode || 'single', mb = b.mode || 'single';
    if (ma !== mb) out.push({ kind: 'changed', area: 'mode', text: T('vd_mode_changed', { old: ma, now: mb }) });
    if ((a.max || null) !== (b.max || null)) {
      out.push({ kind: 'changed', area: 'mode', text: T('vd_field_changed', { field: 'Max runs', old: valText(a.max || 10), now: valText(b.max || 10) }) });
    }
    if (kind === 'automation') {
      const tA = toList(a.triggers != null ? a.triggers : a.trigger);
      const tB = toList(b.triggers != null ? b.triggers : b.trigger);
      const tp = pairLists(tA, tB, trigKey);
      tp.pairs.forEach(([i, j]) => {
        const n0 = out.length;
        diffTriggerPair(tA[i], tB[j], nm, out);
        if (out.length === n0) out.push({ kind: 'changed', area: 'trigger', text: T('vd_trig_updated', { what: trigSummary(tB[j], nm) }) });
      });
      tp.added.forEach(({ item }) => out.push({ kind: 'added', area: 'trigger', text: T('vd_trig_added', { what: trigSummary(item, nm) }) }));
      tp.removed.forEach(({ item }) => out.push({ kind: 'removed', area: 'trigger', text: T('vd_trig_removed', { what: trigSummary(item, nm) }) }));

      const cA = toList(a.conditions != null ? a.conditions : a.condition);
      const cB = toList(b.conditions != null ? b.conditions : b.condition);
      const cp = pairLists(cA, cB, condKey);
      cp.pairs.forEach(([i, j]) => {
        const n0 = out.length;
        diffCondPair(cA[i], cB[j], nm, out);
        if (out.length === n0) out.push({ kind: 'changed', area: 'condition', text: T('vd_cond_updated', { what: condSummary(cB[j], nm) }) });
      });
      cp.added.forEach(({ item }) => out.push({ kind: 'added', area: 'condition', text: T('vd_cond_added', { what: condSummary(item, nm) }) }));
      cp.removed.forEach(({ item }) => out.push({ kind: 'removed', area: 'condition', text: T('vd_cond_removed', { what: condSummary(item, nm) }) }));
    }
    const aA = toList(kind === 'script' ? a.sequence : (a.actions != null ? a.actions : a.action));
    const aB = toList(kind === 'script' ? b.sequence : (b.actions != null ? b.actions : b.action));
    const ap = pairLists(aA, aB, actKey);
    ap.pairs.forEach(([i, j]) => diffActionPair(aA[i], aB[j], nm, out));
    ap.added.forEach(({ item }) => out.push({ kind: 'added', area: 'action', text: T('vd_act_added', { what: actSummary(item, nm) }) }));
    ap.removed.forEach(({ item }) => out.push({ kind: 'removed', area: 'action', text: T('vd_act_removed', { what: actSummary(item, nm) }) }));
    if (canon(a.variables) !== canon(b.variables)) {
      out.push({ kind: 'changed', area: 'setting', text: T('vd_vars_changed') });
    }
    if (!out.length) out.push({ kind: 'changed', area: 'setting', text: T('vd_other_changed') });
    return out;
  }

  // Helpers (input_*, counter, timer, schedule)
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'id').sort();
  for (const k of keys) {
    if (canon(a[k]) === canon(b[k])) continue;
    if (k === 'options' && Array.isArray(a[k]) && Array.isArray(b[k])) {
      const added = b[k].filter((x) => !a[k].includes(x));
      const removed = a[k].filter((x) => !b[k].includes(x));
      if (added.length) out.push({ kind: 'added', area: 'setting', text: T('vd_opt_added', { list: added.join(', ') }) });
      if (removed.length) out.push({ kind: 'removed', area: 'setting', text: T('vd_opt_removed', { list: removed.join(', ') }) });
      if (!added.length && !removed.length) out.push({ kind: 'changed', area: 'setting', text: T('vd_opt_reordered') });
    } else if (k === 'duration') {
      out.push({ kind: 'changed', area: 'setting', text: T('vd_waits_instead', { newDur: fmtDiffDur(b[k]) || valText(b[k]), oldDur: fmtDiffDur(a[k]) || valText(a[k]) }) });
    } else {
      out.push({ kind: 'changed', area: 'setting', text: T('vd_field_changed', { field: humanize(k), old: shorten(valText(a[k]), 40), now: shorten(valText(b[k]), 40) }) });
    }
  }
  if (!out.length) out.push({ kind: 'changed', area: 'setting', text: T('vd_other_changed') });
  return out;
}

// Compare two full function snapshots (fromSnap -> toSnap): returns structured plain-English diff
export function diffSnapshots(fromSnap, toSnap, opts = {}) {
  const nm = opts.name || ((k) => {
    const it = (toSnap && toSnap.items && toSnap.items[k]) || (fromSnap && fromSnap.items && fromSnap.items[k]);
    return (it && ((it.cfg && it.cfg.alias) || it.name)) || k;
  });
  const aM = new Set((fromSnap && fromSnap.members) || []);
  const bM = new Set((toSnap && toSnap.members) || []);
  const aI = (fromSnap && fromSnap.items) || {};
  const bI = (toSnap && toSnap.items) || {};
  const allKeys = [...new Set([...aM, ...bM, ...Object.keys(aI), ...Object.keys(bI)])].sort();
  const items = [];
  for (const k of allKeys) {
    const inA = aM.has(k) || k in aI, inB = bM.has(k) || k in bI;
    const itA = aI[k], itB = bI[k];
    const label = (itB && ((itB.cfg && itB.cfg.alias) || itB.name)) || (itA && ((itA.cfg && itA.cfg.alias) || itA.name)) || nm(k);
    if (!inA && inB) {
      items.push({ key: k, name: label, status: 'added', lines: [{ kind: 'added', area: 'member', text: T('vd_item_added', { name: label }) }] });
    } else if (inA && !inB) {
      items.push({ key: k, name: label, status: 'removed', lines: [{ kind: 'removed', area: 'member', text: T('vd_item_removed', { name: label }) }] });
    } else if (itA && itB && itA.cfg && itB.cfg && canon(itA.cfg) !== canon(itB.cfg)) {
      const lines = diffConfigs(itA.cfg, itB.cfg, itB.dom || itA.dom || k.split('.')[0], { name: nm });
      items.push({ key: k, name: label, status: 'changed', lines });
    }
  }
  const stripView = (L) => { if (!L || typeof L !== 'object') return null; const c = Object.assign({}, L); delete c.view; delete c.dismissed; delete c.checks; return c; };
  const layoutChanged = canon(stripView(fromSnap && fromSnap.layout)) !== canon(stripView(toSnap && toSnap.layout));
  return { items, layoutChanged };
}
