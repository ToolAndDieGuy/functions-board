import { REPO_URL, T, VERSION, esc } from '../lib/index.js';

export const diagnosticsPart = {
    /* ======================================================================================================
       part: diagnostics: the About dialog and the Diagnostics file Owns nothing of its own (PARTS): only its own
       methods use them; the other parts ask its methods.
       ====================================================================================================== */
    /* ---------- diagnostics: a file for an issue or a forum post, made here and handed to the person ----------
       Nothing is sent anywhere. The person chooses anonymised or real names every time (neither is ticked to
       start with, and nothing can be made until one is), and may add a snapshot of the open function as it is
       now and any of its saved versions. */
    // diagnostics: anonymised or real names, one of the two, never both and never neither
    _diagChange(t) {
      if (t.name !== 'danon' && t.name !== 'dreal') return false;
      const m = this._$.modal, other = m.querySelector(`input[name="${t.name === 'danon' ? 'dreal' : 'danon'}"]`);
      if (t.checked && other) other.checked = false;
      const pick = m.querySelector('input[name="danon"]:checked, input[name="dreal"]:checked');
      m.querySelectorAll('[data-act="diag-go"], [data-act="diag-copy"]').forEach((b) => { b.disabled = !pick; });
      const w = m.querySelector('.dwarn');
      if (w) w.hidden = !(pick && pick.name === 'dreal');
      return true;
    },
    async _diagModal(verId) {
      const m = this._$.modal, label = this._data && this._data.ui && this._data.ui.current;
      m.hidden = false;
      let vs = [];
      if (label) { try { vs = await this._verList(label); } catch (e) { vs = []; } }
      const fnName = label ? esc(this._fnName(label)) : '';
      const vrow = (v) => `<label class="chk"><input type="checkbox" name="dver" value="${esc(v.id)}"${v.id === verId ? ' checked' : ''}>${esc(v.name)} <span class="muted">· ${esc(this._verWhen(v.at))}</span></label>`;
      m.innerHTML = `<div class="dlg diag"><h3>${T('diag_h')}</h3><p class="dtext">${T('diag_lead')}</p>`
        + `<h4>${T('diag_names_h')}</h4><label class="chk"><input type="checkbox" name="danon">${T('diag_anon')}</label><label class="chk"><input type="checkbox" name="dreal">${T('diag_real')}</label>`
        + `<div class="hint dwarn" hidden>${T('diag_real_warn')}</div>`
        + `<h4>${T('diag_incl_h')}</h4><p class="muted">${T('diag_always')}</p>`
        + (label ? `<label class="chk"><input type="checkbox" name="dsnap">${T('diag_snap', { fnName })}</label>` : '')
        + (vs.length ? `<div class="dvers"><div class="muted">${T('diag_vers', { fnName })}</div>${vs.slice().reverse().map(vrow).join('')}</div>` : '')
        + `<div class="dval"></div><div class="btns"><button data-act="modal-cancel">${T('cancel')}</button><button data-act="diag-copy" disabled>${T('diag_copy')}</button><button class="primary" data-act="diag-go" disabled>${T('diag_download')}</button></div></div>`;
    },
    async _diagGo(copy) {
      const m = this._$.modal, val = m.querySelector('.dval'), label = this._data && this._data.ui && this._data.ui.current;
      const pick = m.querySelector('input[name="danon"]:checked, input[name="dreal"]:checked');
      if (!pick) { val.textContent = T('diag_choose'); return; }
      const anonymise = pick.name === 'danon', snap = !!(m.querySelector('input[name="dsnap"]') || {}).checked;
      const vids = [...m.querySelectorAll('input[name="dver"]:checked')].map((x) => x.value);
      const btns = m.querySelectorAll('[data-act="diag-go"], [data-act="diag-copy"]');
      btns.forEach((b) => { b.disabled = true; });
      val.textContent = T('diag_making');
      try {
        const msg = { type: 'functions_board/diagnostics', anonymise };
        if (label && (snap || vids.length)) msg.label = label;
        if (label && snap) msg.snapshot = await this._verSnapshot(label);
        if (vids.length) msg.version_ids = vids;
        // with what failed on this board since it opened (anonymised: only the kind of call and the error code)
        const text = JSON.stringify(Object.assign(await this._ws(msg), { board_errors: this._ha.exportErrors(anonymise) }), null, 2);
        if (copy) {
          await navigator.clipboard.writeText(text);
          this._toast(T('diag_copied'));
        } else {
          // saved on this device by the browser: a link to the file made here, clicked, then let go
          const day = new Date().toISOString().slice(0, 10), a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
          a.download = `functions_board_diagnostics_${day}${anonymise ? '_anonymised' : ''}.json`;
          document.body.appendChild(a); a.click(); a.remove();
          this._clock.deadline(5000, () => URL.revokeObjectURL(a.href));
          this._toast(T('diag_saved'));
        }
        this._closeModal();
      } catch (e) {
        val.textContent = T('diag_failed', { e: (e && (e.message || e.code)) || e });
        btns.forEach((b) => { b.disabled = false; });
      }
    },
    _aboutModal() {
      const m = this._$.modal;
      m.hidden = false;
      const store = this._storeMode === 'shared' ? T('shared_between_administrators_functions_board') : T('stored_for_your_user_only');
      m.innerHTML = `<div class="dlg about"><h3>${T('functions_board')} <span class="muted">${T('v_short', { version: VERSION })}</span></h3><h4>${T('what_it_changes', { extra: this._storeMode === 'shared' ? (this._full() ? T('full_manager') : T('organise_only')) : '' })}</h4><ul>${this._promise().map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h4>${T('where_things_are_kept')}</h4><p>${T('frames_notes_and_positions_are', { store })}</p><h4>${T('how_the_arrows_are_drawn')}</h4><p>${T('from_each_automation_and_script')}</p><h4>${T('diag_about_h')}</h4><p>${T('diag_about_p')}</p><div class="btns">${REPO_URL ? `<a class="lnk" href="${REPO_URL}" target="_blank" rel="noopener">${T('project_page_and_issues')}</a>` : ''}<button data-act="diag"><ha-icon icon="mdi:file-download-outline"></ha-icon>${T('diag_btn')}</button><button data-act="modal-cancel">${T('close')}</button></div></div>`;
    },
};
