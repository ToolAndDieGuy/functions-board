export const DEFS = '<defs>' + [['n', 'var(--fb-edge)'], ['hi', 'var(--primary-text-color)'], ['amber', '#fab219'], ['blue', '#5598e7'],
    ['trig', 'var(--fb-trig)'], ['act', 'var(--fb-act)'], ['call', 'var(--fb-call)']]
    .map(([id, c]) => `<marker id="fb-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:${c}"></path></marker>`)
    .join('') + '<marker id="fb-dot" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8"><circle cx="5" cy="5" r="4" style="fill:var(--fb-edge)"></circle></marker>'
    + '<marker id="fb-dottrig" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8"><circle cx="5" cy="5" r="4" style="fill:var(--fb-trig)"></circle></marker>'
    + '<marker id="fb-dothi" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8"><circle cx="5" cy="5" r="4" style="fill:var(--primary-text-color)"></circle></marker>'
    + '</defs>';

export const STYLE = `
:host{display:block;--fb-amber:#fab219;--fb-red:#f06a6a;--fb-blue:#5598e7;
  /* text in those colours: the same on a dark background, darker on a light one (4.5:1 on white) */
  --fb-amber-ink:var(--fb-amber);--fb-red-ink:var(--fb-red);--fb-blue-ink:var(--fb-blue);--fb-primary-ink:var(--primary-color);
  /* white text on these passes 4.5:1 whatever the theme's own primary and success colours */
  --fb-primary-fill:color-mix(in srgb,var(--primary-color) 72%,#000);--fb-success-fill:color-mix(in srgb,var(--success-color,#43a047) 70%,#000);
  --fb-edge:color-mix(in srgb,var(--secondary-text-color) 75%,transparent);
  --fb-dot:color-mix(in srgb,var(--secondary-text-color) 22%,transparent)}
*{box-sizing:border-box}
[hidden]{display:none!important}
button{font:inherit;color:inherit}
.board{position:relative;display:flex;height:calc(100vh - var(--header-height,56px) - env(safe-area-inset-top,0px));min-height:420px;
  background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--ha-font-family-body,Roboto,sans-serif);overflow:hidden}
.list{width:250px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--divider-color);background:var(--card-background-color)}
.board.nolist .list{display:none}
.lhead{display:flex;align-items:center;justify-content:space-between;padding:10px 8px 6px 16px;font-weight:500;font-size:15px}
.fns{flex:1;overflow:auto;padding:0 8px}
.lfind{display:flex;align-items:center;gap:6px;margin:0 8px 6px;padding:0 4px 0 10px;border:1px solid var(--divider-color);border-radius:10px;background:var(--primary-background-color)}
.lfind ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color);flex:none}
.lfind input{flex:1;min-width:0;border:0;background:none;color:var(--primary-text-color);font:inherit;font-size:13px;padding:7px 0;outline:none}
.lfind .ib{padding:2px}
.fres{padding:6px 4px;border-bottom:1px solid var(--divider-color)}
.fgo{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;cursor:pointer;text-align:left;padding:2px 4px;border-radius:8px;color:var(--primary-text-color);font-size:13px}
.fgo:hover{background:var(--secondary-background-color)}
.fgo .tag{min-width:64px;text-align:center}
.fin{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:3px 4px 0 76px}
.fin .chip{padding:2px 8px;font-size:11.5px}
.fnrow{position:relative}
.fn{display:flex;align-items:center;gap:10px;width:100%;padding:8px 34px 8px 8px;border:0;border-radius:10px;background:none;text-align:left;cursor:pointer}
.fnmore{position:absolute;right:2px;top:50%;transform:translateY(-50%);opacity:0}
.fnrow:hover .fnmore,.fnmore:focus,.board.compact .fnmore{opacity:1}
@media (hover:none){.fnmore{opacity:1}}
.fn:hover{background:var(--secondary-background-color)}
.fn.cur{background:color-mix(in srgb,var(--primary-color) 14%,transparent)}
.fn ha-icon{--mdc-icon-size:20px;flex:none}
.fnt{display:flex;flex-direction:column;min-width:0;flex:1}
.fnn{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fnc{font-size:12px;color:var(--secondary-text-color)}
.dot{width:8px;height:8px;border-radius:50%;flex:none}.dot.warn{background:var(--fb-amber)}
.lfoot{padding:10px 12px;border-top:1px solid var(--divider-color);display:flex;flex-direction:column;gap:8px}
.lfoot select{width:100%;padding:7px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color);color:inherit;font:inherit;font-size:13px}
.ver{font-size:11px;color:var(--secondary-text-color)}
.main{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;container-type:inline-size}
.stage{position:relative;flex:1;display:flex;min-height:0}
.bar{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--divider-color);background:var(--card-background-color);min-height:52px;flex-wrap:wrap}
.title{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 220px}
.title .ib{flex:none}
.title>ha-icon{--mdc-icon-size:24px;flex:none}
.tt{min-width:0;flex:0 1 auto}
.ttl{font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.desc{font-size:12px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:44vw}
.tools{display:flex;align-items:center;gap:2px;flex-wrap:wrap}
.tools button,.lhead button,.ib,.dhead button,.zoom button,.nodebar button{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid transparent;border-radius:8px;background:none;cursor:pointer;font-size:13px;color:var(--primary-text-color);white-space:nowrap}
.tools button:hover,.lhead button:hover,.ib:hover,.dhead button:hover,.zoom button:hover,.nodebar button:hover{background:var(--secondary-background-color)}
.tools ha-icon,.lhead ha-icon,.ib ha-icon,.dhead ha-icon,.nodebar ha-icon{--mdc-icon-size:18px}
.ib{padding:6px}
.sep{width:1px;height:22px;background:var(--divider-color);margin:0 4px}
[data-confirm]{border-color:var(--fb-amber)!important;color:var(--fb-amber-ink)!important}
.vp{position:relative;flex:1;min-width:0;overflow:hidden;touch-action:none;-webkit-touch-callout:none;background-color:var(--primary-background-color);
  background-image:radial-gradient(var(--fb-dot) 1px,transparent 1px);background-size:22px 22px}
.world{position:absolute;left:0;top:0;transform-origin:0 0}
.edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.edges path.e{fill:none;stroke:var(--fb-edge);stroke-width:1.6;pointer-events:stroke;transition:opacity .15s}
.edges path.role-trigger{stroke-width:2.6}
.edges path.role-call{stroke-width:2.6;stroke-dasharray:10 3}
.edges path.role-condition{stroke-dasharray:4 4}
.edges path.role-source{stroke-dasharray:1.5 4;stroke-linecap:round;stroke-width:2}
.edges path.loop{stroke:var(--fb-amber)}
.edges path.hi{stroke:var(--primary-text-color)}
.edges path.dim{opacity:.12}
.edges path.live{stroke:var(--fb-blue);stroke-dasharray:7 5;animation:flow .5s linear infinite}
/* arrows coloured by what they mean (prototype): sets off, changes, runs a script; checks and reads stay grey */
.board{--fb-trig:#d95926;--fb-act:#3987e5;--fb-call:#199e70}
.board.light{--fb-trig:#eb6834;--fb-act:#2a78d6;--fb-call:#1baf7a}
.board.light,.modal.light{--fb-amber-ink:#8a5a00;--fb-red-ink:#c0392b;--fb-blue-ink:#1f62b5;--fb-primary-ink:color-mix(in srgb,var(--primary-color) 72%,#000)}
.board.pc .edges path.role-trigger{stroke:var(--fb-trig);stroke-width:2.2}
.board.pc .edges path.role-action{stroke:var(--fb-act);stroke-width:1.8}
.board.pc .edges path.role-call{stroke:var(--fb-call);stroke-width:2.4;stroke-dasharray:none}
.board.pc .edges path.role-condition{stroke-dasharray:5 4;stroke-width:1.5}
.board.pc .edges path.role-source{stroke-width:1.8}
.board.pc .edges path.loop{filter:drop-shadow(0 0 2px var(--fb-amber)) drop-shadow(0 0 2px var(--fb-amber))}
.board.pc .edges path.hi.role-trigger{stroke:var(--fb-trig);stroke-width:3}
.board.pc .edges path.hi.role-action{stroke:var(--fb-act);stroke-width:2.6}
.board.pc .edges path.hi.role-call{stroke:var(--fb-call);stroke-width:3.2}
.board.pc .edges path.live{stroke:var(--primary-text-color);stroke-width:2.6}
.edges circle.jd{stroke:var(--fb-edge);stroke-width:2}
.edges circle.jd.split{fill:var(--fb-edge);stroke:none}
.board.pc .edges circle.jd.split.role-trigger{fill:var(--fb-trig)}
.board.pc .edges circle.jd.split.role-action{fill:var(--fb-act)}
.board.pc .edges circle.jd.split.role-call{fill:var(--fb-call)}
.board.pc .edges circle.jd.role-trigger{stroke:var(--fb-trig)}
.board.pc .edges circle.jd.role-action{stroke:var(--fb-act)}
.board.pc .edges circle.jd.role-call{stroke:var(--fb-call)}
.edges path.chev{fill:var(--fb-edge);stroke:none}
.edges path.e.trdim{opacity:.13}
.edges path.trc{fill:none;pointer-events:none;stroke-width:3.4!important;opacity:1}
.board:not(.pc) .edges path.trc{stroke:var(--primary-text-color)}
.board.pc .edges path.chev.role-trigger{fill:var(--fb-trig)}
.board.pc .edges path.chev.role-action{fill:var(--fb-act)}
.board.pc .edges path.chev.role-call{fill:var(--fb-call)}
.edges path.chev.dim{opacity:.12}
.edges circle.jd.dim{opacity:.18}
.board.pc .lg svg path.role-trigger{stroke:var(--fb-trig)}
.board.pc .lg svg path.ah.role-trigger,.board.pc .lg svg .ah.trig{fill:var(--fb-trig)}
.board.pc .lg svg path.role-action{stroke:var(--fb-act)}
.board.pc .lg svg path.ah.role-action{fill:var(--fb-act)}
.board.pc .lg svg path.role-call{stroke:var(--fb-call);stroke-dasharray:none}
.board.pc .lg svg path.ah.role-call{fill:var(--fb-call)}
.board.pc .lg svg path.loop{stroke:var(--fb-edge);filter:drop-shadow(0 0 2px var(--fb-amber)) drop-shadow(0 0 2px var(--fb-amber))}
.board.pc .lg svg path.ah.loop{fill:var(--fb-edge)}
@keyframes flow{to{stroke-dashoffset:-12}}
.edges text{font-size:11px;fill:var(--primary-text-color);paint-order:stroke;stroke:var(--primary-background-color);stroke-width:4px;stroke-linejoin:round}
.khead{position:absolute;font-size:12px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--secondary-text-color);pointer-events:none;white-space:nowrap}
.frame{position:absolute;border:1.5px dashed var(--divider-color);border-radius:16px;background:color-mix(in srgb,var(--secondary-background-color) 45%,transparent)}
.fhead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 14px;cursor:grab;font-size:13px;font-weight:500;color:var(--secondary-text-color)}
.ftitle{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ftin{font:inherit;font-size:13px;font-weight:500;padding:2px 6px;border-radius:6px;border:1px solid var(--primary-color);background:var(--card-background-color);color:var(--primary-text-color);width:70%}
.fdel,.ndel{border:0;background:none;cursor:pointer;font-size:16px;line-height:1;color:var(--secondary-text-color);opacity:0;padding:2px 6px}
.frame:hover .fdel,.note:hover .ndel{opacity:1}
.fresize{position:absolute;right:3px;bottom:3px;width:16px;height:16px;cursor:nwse-resize;border-right:2px solid var(--divider-color);border-bottom:2px solid var(--divider-color);border-radius:0 0 10px 0}
.node{position:absolute;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;border-radius:12px;background:var(--card-background-color);
  border:1px solid var(--divider-color);box-shadow:var(--ha-card-box-shadow,0 1px 2px rgba(0,0,0,.2));cursor:grab;user-select:none;-webkit-user-select:none;transition:opacity .15s,box-shadow .2s}
.node:active{cursor:grabbing}
.node .ic{--mdc-icon-size:22px;color:var(--state-icon-color,var(--secondary-text-color));flex:none}
.node .txt{min-width:0;flex:1}
.node .name{font-size:13px;font-weight:500;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node .sub{font-size:11.5px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.node .badges{display:flex;gap:2px;align-self:flex-start;flex:none;align-items:center}
.node .badges ha-icon{--mdc-icon-size:14px;color:var(--secondary-text-color)}
.node .wr{font-size:10.5px;color:var(--secondary-text-color);border:1px solid var(--divider-color);border-radius:8px;padding:0 4px;line-height:14px}
.node.outside{border-radius:20px;padding:4px 12px;background:var(--primary-background-color);border-style:dashed;box-shadow:none}
.node.outside .ic{--mdc-icon-size:16px}
.node.outside .name{font-weight:400;font-size:12px;color:var(--secondary-text-color)}
.node.suggest{border-style:dashed;box-shadow:none;background:var(--primary-background-color)}
.node.off .ic{opacity:.55}.node.off .name{color:var(--secondary-text-color)}
.node.warn{border-left:4px solid var(--fb-amber)}
.node.err{border-left:4px solid var(--fb-red)}
.node.running{box-shadow:0 0 0 2px var(--fb-blue)}
.node.sel{box-shadow:0 0 0 2px var(--primary-text-color)}
.node.hov{box-shadow:0 0 0 3px var(--fb-blue)}
.node.dim{border-color:color-mix(in srgb,var(--divider-color) 60%,transparent);box-shadow:none;background:var(--primary-background-color)}
.node.dim>.ic,.node.dim .badges ha-icon,.node.dim .port{opacity:.25}
.node.dim .name{color:var(--secondary-text-color);font-weight:400}
.node.dim>.tag{color:var(--secondary-text-color)}
.node.pulse{animation:pulse 1.8s ease-out}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--fb-blue) 85%,transparent)}100%{box-shadow:0 0 0 16px transparent}}
.node.lifted,.frame.lifted,.note.lifted{outline:2px solid var(--primary-color);outline-offset:2px;box-shadow:0 8px 24px rgba(0,0,0,.45)}
.note{position:absolute;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:var(--ha-card-box-shadow,none)}
.nhead{display:flex;align-items:center;justify-content:space-between;padding:4px 2px 0 10px;cursor:grab;color:var(--secondary-text-color)}
.nhead ha-icon{--mdc-icon-size:16px}
.nbody{display:block;width:100%;border:0;resize:none;overflow:hidden;background:none;color:var(--primary-text-color);font:inherit;font-size:13px;line-height:1.4;padding:4px 12px 10px;outline:none}
.nodebar{position:absolute;display:flex;align-items:center;gap:2px;padding:4px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);
  box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:5;white-space:nowrap;transform:translateY(-100%);flex-wrap:wrap;max-width:calc(100% - 12px)}
.nodebar ha-icon{width:18px;height:18px;flex:none}
.nbname{font-size:12px;color:var(--secondary-text-color);padding:0 6px 0 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.nodebar button span{font-size:12px}
.zoom{position:absolute;right:12px;bottom:12px;display:flex;gap:2px;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:10px;padding:2px;z-index:4}
.zoom button{min-width:34px;justify-content:center;font-size:16px}
.legend{position:absolute;left:12px;bottom:12px;z-index:4;font-size:12px;color:var(--secondary-text-color);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:10px;padding:6px 10px;max-width:310px}
.lgt{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:var(--secondary-text-color);cursor:pointer;padding:0;font-size:12px}
.lgt ha-icon{--mdc-icon-size:16px}
.lg{display:grid;grid-template-columns:40px 1fr;gap:3px 8px;align-items:center;margin-top:6px}
.lg svg path{fill:none;stroke:var(--fb-edge);stroke-width:1.6}
.lg svg .ah{fill:var(--fb-edge);stroke:none}
.lg svg path.role-trigger,.lg svg path.role-call{stroke-width:2.6}
.lg svg path.role-condition{stroke-dasharray:4 3}
.lg svg path.role-source{stroke-dasharray:1.5 3;stroke-linecap:round;stroke-width:2}
.lg svg path.role-call{stroke-dasharray:8 2}
.lg svg path.loop{stroke:var(--fb-amber)}
.lg svg path.ah.loop{fill:var(--fb-amber)}
.lgn{margin-top:6px;line-height:1.7}
.sw{display:inline-block;width:14px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle;border:1px solid var(--secondary-text-color)}
.sw.dashed{border-style:dashed}.sw.pill{border-radius:6px;border-style:dashed}
.sw.st{border:0;width:4px;height:12px;border-radius:2px;margin-right:4px}
.sw.amber{background:var(--fb-amber)}.sw.red{background:var(--fb-red)}.sw.blue{background:var(--fb-blue)}
.tg{display:flex;align-items:center;gap:6px;margin-top:4px;cursor:pointer;min-height:26px}
.tg input{width:18px;height:18px;margin:0 2px;flex:none}
.empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--secondary-text-color);padding:24px;pointer-events:none;line-height:1.6}
.empty b{color:var(--primary-text-color)}
.loading{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:14px;padding:4px 12px;font-size:12px;color:var(--secondary-text-color);z-index:4}
.toast{position:absolute;bottom:64px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;background:var(--primary-text-color);color:var(--primary-background-color);border-radius:10px;padding:8px 14px;font-size:13px;z-index:20;max-width:80%}
.toast button{border:0;background:none;cursor:pointer;padding:2px 4px;font-size:12.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:color-mix(in srgb,var(--primary-color) 60%,var(--primary-background-color))}
.drawer{position:absolute;top:0;right:0;bottom:0;width:min(780px,62%);display:flex;flex-direction:column;background:var(--card-background-color);border-left:1px solid var(--divider-color);box-shadow:-6px 0 18px rgba(0,0,0,.25);z-index:7}
.dhead{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--divider-color)}
.dtitle{flex:1;font-weight:500;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:6px}
.dcap{font-size:12px;color:var(--fb-blue-ink);white-space:nowrap}
.drawer iframe{flex:1;border:0;width:100%;background:var(--primary-background-color)}
.runs{flex:1;overflow:auto}
.runs .run{display:grid;grid-template-columns:124px 1fr auto;gap:10px;align-items:center;width:100%;text-align:left;padding:8px 12px;border:0;border-bottom:1px solid var(--divider-color);background:none;cursor:pointer}
.runs .run:hover{background:var(--secondary-background-color)}
.rt{font-size:12px;color:var(--secondary-text-color);font-variant-numeric:tabular-nums}
.rn{display:flex;flex-direction:column;min-width:0}.rn b{font-weight:500;font-size:13px}
.rn span{font-size:12px;color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ro{font-size:12px;color:var(--secondary-text-color);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.runs .run.red .ro{color:var(--fb-red-ink)}.runs .run.blue .ro{color:var(--fb-blue-ink)}.runs .run.amber .ro{color:var(--fb-amber-ink)}
.modal{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:30}
.dlg{width:min(460px,92%);max-height:88%;display:flex;flex-direction:column;gap:12px;background:var(--card-background-color);border-radius:16px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
.dlg.wide{width:min(640px,94%)}
.dlg.nbdlg{width:min(640px,94%)}
.nbdlg .nbbody{display:flex;flex-direction:column;gap:12px;overflow:auto;min-height:0;padding-right:4px}
.nbdlg fieldset{border:1px solid var(--divider-color);border-radius:10px;margin:0;padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.nbdlg legend{font-size:13px;font-weight:500;padding:0 4px;color:var(--primary-text-color)}
.nbdlg .nbrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px}
.nbdlg .nbrow[hidden],.nbdlg .nbans[hidden]{display:none}
.nbdlg .nbgrow{flex:1;min-width:160px}
.nbdlg .nbsub{font-size:12px;color:var(--secondary-text-color)}
.nbdlg .nblist{max-height:150px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.nbdlg label.chk{min-height:28px}
.nbdlg .nbbtn{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--divider-color);padding-top:8px}
.nbdlg .nbans{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--divider-color);padding-top:8px}
.nbdlg textarea{padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color);font:inherit;font-size:14px;resize:vertical}
.nbdlg .aval:empty{display:none}
.nbdlg .aval{color:var(--fb-red-ink)}
.dlg h3{margin:0;font-size:18px;font-weight:500}
.dlg label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--secondary-text-color)}
.dlg input:not([type=checkbox]),.dlg select{padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color);font:inherit;font-size:14px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dlg label.chk{flex-direction:row;align-items:center;gap:8px;font-size:13px;color:var(--primary-text-color)}
.dlg.diag .dwarn{color:var(--warning-color,#b26a00)}
.node .badges ha-icon.prob{--mdc-icon-size:15px}
.node .badges ha-icon.prob.p-error,.prow.p-error>ha-icon{color:var(--error-color,#db4437)}
.node .badges ha-icon.prob.p-warn,.prow.p-warn>ha-icon{color:var(--warning-color,#b26a00)}
svg path.e.prob{stroke:var(--error-color,#db4437);stroke-dasharray:5 4}
.pbadge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:11px;font-weight:600;line-height:18px;text-align:center;color:#fff;flex:none}
.pbadge.p-error{background:color-mix(in srgb,var(--error-color,#db4437) 75%,#000)}
.pbadge.p-warn{background:color-mix(in srgb,var(--warning-color,#ffa600) 60%,#000)}
.pdchip{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--divider-color);background:none;font:inherit;font-size:12px;cursor:pointer;margin-left:6px;white-space:nowrap;color:var(--secondary-text-color)}
.pdchip ha-icon{--mdc-icon-size:16px}
.probs .pother{padding:8px 14px 14px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:baseline}
.probs .pever{color:var(--secondary-text-color)}
.flow .fsay.now{border-color:var(--fb-blue);z-index:4}
.dbrow .sbpk{margin-top:4px}
.sbtabs{display:flex;gap:2px;padding:4px 10px 0;border-bottom:1px solid var(--divider-color)}
.sbtabs [role="tab"]{font:inherit;font-size:12.5px;padding:6px 10px;border:none;background:none;color:var(--secondary-text-color);border-bottom:2px solid transparent;cursor:pointer}
.sbtabs [role="tab"][aria-selected="true"]{color:var(--primary-text-color);border-bottom-color:var(--fb-blue);font-weight:500}
.sbrec{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;padding:4px 10px;font-size:12px}.sbrec:empty{display:none}
.sbhp{margin:6px 0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--fb-blue) 8%,transparent);font-size:12.5px;line-height:1.4}
.sbhp ul{margin:4px 0 0;padding-left:18px}
.sbhp li.bad{color:var(--fb-red-ink)}
.sbhp .warn{color:var(--fb-amber-ink)}
.sbhp p{margin:4px 0 0}
.sbrec .chip ha-icon{--mdc-icon-size:14px}
.sbsum{display:flex;gap:6px;align-items:flex-start;padding:6px 10px 2px;font-size:12px;color:var(--secondary-text-color);border-top:1px solid var(--divider-color)}
.sbsum ha-icon{--mdc-icon-size:15px;flex:none}
.sbvp{border-top:1px solid var(--divider-color);max-height:34%;display:flex;flex-direction:column;min-height:0}
.sbvph{display:flex;gap:8px;align-items:center;padding:6px 10px;font-size:12px}.sbvph .muted{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbvpre{margin:0;padding:6px 10px 10px;font-size:11.5px;overflow:auto;white-space:pre;font-family:var(--code-font-family,monospace)}
.sbpane{padding-bottom:10px}
.sbsf{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 10px;font-size:12px}
.sbsr{border-bottom:1px solid var(--divider-color);font-size:12.5px}
.sbsr summary{display:flex;gap:8px;align-items:baseline;padding:6px 10px;cursor:pointer}
.sbsr .sbsn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbsr .sbsv{font-weight:500}.sbsr .sbsw{font-size:11.5px;color:var(--secondary-text-color)}
.sbsr.ch summary{box-shadow:inset 3px 0 0 var(--fb-amber)}
.sbsd{display:flex;gap:6px;align-items:center;padding:0 10px 4px;font-size:11.5px}.sbsd code{flex:1;color:var(--secondary-text-color)}
.sbsa{width:100%;border-collapse:collapse;font-size:11.5px;margin:0 0 6px}.sbsa th,.sbsa td{text-align:left;padding:2px 10px;vertical-align:top;border-top:1px solid var(--divider-color)}.sbsa th{font-weight:500;color:var(--secondary-text-color);width:38%}
.sbsa tr.ch td{color:var(--fb-amber-ink)}
.sbxf{display:flex;gap:8px;align-items:flex-start;padding:6px 0;font-size:12.5px;border-bottom:1px solid var(--divider-color)}.sbxf ha-icon{--mdc-icon-size:16px;flex:none;color:var(--secondary-text-color)}.sbxf span{flex:1}
.sbxf.k-fight ha-icon,.sbxf.k-loop ha-icon{color:var(--fb-amber-ink)}
.sbexr{margin:10px 0}.sbexr summary{cursor:pointer;font-size:12.5px}
.sbcv{border-bottom:1px solid var(--divider-color);font-size:12.5px}.sbcv summary{padding:6px 10px;cursor:pointer}
.sbcv ul{list-style:none;margin:0;padding:0 10px 8px}.sbcv li{padding:2px 0 2px 14px;position:relative;font-size:12px}
.sbcv li::before{content:'';position:absolute;left:0;top:8px;width:7px;height:7px;border-radius:50%;background:var(--fb-green,#43a047)}
.sbcv li.cv-part::before{background:var(--fb-amber)}.sbcv li.cv-no::before{background:none;border:1.5px solid var(--fb-red)}
.sbcv .cvk{color:var(--secondary-text-color)}.sbcv .cvw{color:var(--secondary-text-color);font-size:11.5px}
.sbcv li.cv-no .cvw{color:var(--fb-red-ink)}
.sbq.sbpause{border-left:3px solid var(--fb-blue)}
.node.uncov{outline:2px dashed var(--fb-red);outline-offset:3px}
.dbrow .sbpk button{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);cursor:pointer}
.dbrow .sbpk ha-icon{--mdc-icon-size:14px}
.pchip{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border-radius:13px;border:1px solid currentColor;background:none;font:inherit;font-size:12px;cursor:pointer;margin-left:6px;white-space:nowrap}
.pchip ha-icon{--mdc-icon-size:16px}
.pchip.p-error{color:var(--fb-red-ink)}
.pchip.p-warn{color:var(--fb-amber-ink)}
.sbchk{padding:6px 12px 2px;display:flex;flex-direction:column;gap:3px}
.sbchk .ckhead{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--secondary-text-color)}
.sbchk .ckhead span{flex:1}
.sbchk .ckhead .chip ha-icon{--mdc-icon-size:16px;margin-right:3px}
.sbchk .ckrow{display:flex;align-items:center;gap:6px;font-size:13px}
.sbchk .ckname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbchk .ckst{width:16px;text-align:center;font-weight:700}
.sbchk .ckst.ok{color:var(--success-color,#43a047)}
.sbchk .ckst.bad{color:var(--error-color,#db4437)}
.sbchk .ckst.unsure{color:var(--warning-color,#b26a00)}
.dlg.ckdlg .cksteps{margin:0;padding-left:20px;font-size:13px}
.dlg.ckdlg .cked li{display:flex;align-items:center;gap:6px;margin:3px 0}
.dlg.ckdlg .cked .cket{flex:1;min-width:0}
.dlg.ckdlg .cked input{width:120px;box-sizing:border-box}
.dlg.ckdlg .ckadd{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}
.dlg.ckdlg textarea.ckjson{width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:12px;resize:vertical}
.probs{padding:10px 14px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.prow{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:8px;background:var(--secondary-background-color)}
.prow>ha-icon{--mdc-icon-size:20px;flex:none;margin-top:1px}
.prow .pbody{display:flex;flex-direction:column;gap:4px;min-width:0}
.prow .pby{font-size:12px;color:var(--secondary-text-color)}
.prow .pby button.lnk,.probs .pother button.lnk{background:none;border:0;padding:0;margin:0;font:inherit;color:var(--fb-primary-ink);text-decoration:underline;cursor:pointer}
.prow .pact{display:flex;gap:6px;flex-wrap:wrap}
.prow .pact button{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;padding:3px 8px;border-radius:6px;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);cursor:pointer}
.prow .pact ha-icon{--mdc-icon-size:14px}
.dlg.diag h4+p{margin-top:0}
.dlg.diag .dvers{display:flex;flex-direction:column;gap:4px;margin-top:6px;max-height:180px;overflow:auto}
.hint{font-size:12px;color:var(--secondary-text-color);line-height:1.5}
.btns{display:flex;justify-content:flex-end;gap:8px;align-items:center}
.btns .cnt{margin-right:auto}
.btns button{padding:8px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer}
.btns button.primary{background:var(--fb-primary-fill);border-color:var(--fb-primary-fill);color:#fff}
.picks{overflow:auto;min-height:200px;max-height:50vh;border:1px solid var(--divider-color);border-radius:10px}
.dlg label.pick{flex-direction:row;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--divider-color);cursor:pointer;color:var(--primary-text-color)}
.pick ha-icon{--mdc-icon-size:20px;color:var(--secondary-text-color)}
.pick span{display:flex;flex-direction:column;min-width:0}.pick b{font-weight:500;font-size:13px}.pick small{font-size:11px;color:var(--secondary-text-color)}
.muted{color:var(--secondary-text-color);font-size:13px}.pad{padding:12px}.small{font-size:12px}
/* v0.2: type tags, list buttons, pickers, import manager */
.tag{display:inline-block;font-size:9.5px;line-height:14px;letter-spacing:.06em;text-transform:uppercase;padding:0 5px;border-radius:4px;border:1px solid var(--divider-color);color:var(--secondary-text-color);background:var(--primary-background-color);white-space:nowrap;flex:none}
.node>.tag{position:absolute;top:-8px;left:12px;pointer-events:none;color:var(--primary-text-color)}
.node.outside>.tag{left:16px}
.lhead>span:last-child{display:flex;gap:2px}
.lbtn{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid var(--divider-color);border-radius:10px;background:none;cursor:pointer;font-size:13px;color:var(--primary-text-color)}
.lbtn:hover{background:var(--secondary-background-color)}
.lbtn ha-icon{--mdc-icon-size:18px}
.selbox{min-width:0}.selbox ha-selector{display:block}
.dlg.mgr{width:min(1000px,96%);height:min(860px,92%);max-height:none;padding:0;gap:0}
.mhead{display:flex;align-items:center;gap:16px;padding:12px 12px 0 20px}
.mhead h3{flex:none}
.tabs{display:flex;gap:2px;flex:1;align-self:flex-end}
.tab{padding:10px 14px;border:0;border-bottom:2px solid transparent;background:none;cursor:pointer;color:var(--secondary-text-color);font-size:14px}
.tab.on{color:var(--primary-text-color);border-bottom-color:var(--primary-color)}
.mbody{flex:1;overflow:auto;padding:6px 20px 14px;border-top:1px solid var(--divider-color);border-bottom:1px solid var(--divider-color);display:flex;flex-direction:column;gap:8px}
.mintro{padding:8px 0 2px}
.mfoot{display:flex;align-items:center;gap:8px;padding:12px 20px;flex-wrap:wrap}
.mfoot .cnt{margin-left:auto;font-size:13px;color:var(--secondary-text-color)}
.mfoot button,.crow button.go{padding:8px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:13px;white-space:nowrap}
.mfoot button.primary,.crow button.go{background:var(--fb-primary-fill);border-color:var(--fb-primary-fill);color:#fff}
.mfoot button[disabled],.crow button[disabled]{opacity:.45;cursor:default}
.dlg label.mcats{flex-direction:row;align-items:center;gap:8px;font-size:12px;max-width:520px}
.cand{border:1px solid var(--divider-color);border-radius:12px;background:var(--card-background-color);flex:none}
.cand.done{filter:saturate(.3)}
.cand.done .crow>*:not(.ccount):not(.csrc):not(.onb){opacity:.7}
.cand.left{border-style:dashed}
.cname.static{flex:1;font-size:14px;font-weight:500;padding:6px 8px}
.lrow2{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px}
.lrow2 .mn{flex:1}
.lrow2 .tag{min-width:80px;text-align:center}
.lrow2 .chip[disabled]{opacity:.45;cursor:default}
.crow{display:flex;align-items:center;gap:10px;padding:6px 10px}
.crow>ha-icon{--mdc-icon-size:20px;color:var(--secondary-text-color);flex:none}
.dlg input.cname{flex:1;min-width:140px;font-size:14px;font-weight:500;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:none}
.dlg input.cname:hover,.dlg input.cname:focus{border-color:var(--divider-color);background:var(--primary-background-color);outline:none}
.ccount{font-size:12px;color:var(--secondary-text-color);white-space:nowrap}
.csrc{font-size:11px;color:var(--secondary-text-color);border:1px solid var(--divider-color);border-radius:8px;padding:1px 6px;white-space:nowrap}
.onb{font-size:12px;color:var(--secondary-text-color);white-space:nowrap}
.cmem{display:flex;flex-direction:column;padding:2px 12px 10px 40px;border-top:1px solid var(--divider-color)}
/* 0.11.0: what a merged row is made from, and the offers to merge */
.cmerge{display:flex;flex-direction:column;gap:4px;padding:0 12px 8px 40px}
.cmade,.coffer{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;color:var(--secondary-text-color)}
.cmade .ptag{font-size:12px;padding:1px 8px;border-radius:10px;border:1px solid var(--divider-color);color:var(--primary-text-color);background:var(--primary-background-color)}
.cmerge .chip{padding:2px 9px;font-size:12px}.cmerge .chip ha-icon{--mdc-icon-size:15px}.cmerge .chip[disabled]{opacity:.45;cursor:default}
.mrow2{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px}.mrow2 .tag{min-width:80px;text-align:center}
.dlg label.mrow,.dlg label.lrow,.dlg label.pick{display:flex;flex-direction:row;align-items:center;gap:10px;padding:5px 0;cursor:pointer;color:var(--primary-text-color);font-size:13px}
.dlg label.lrow,.dlg label.pick{padding:6px 10px;border-bottom:1px solid var(--divider-color)}
.dlg label.lrow ha-icon{--mdc-icon-size:20px}
.mn{display:flex;flex-direction:column;min-width:0}.mn b{font-weight:500}
.mn small{font-size:11px;color:var(--secondary-text-color);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mrow .tag,.pick .tag{min-width:80px;text-align:center}
.ptop{display:flex;gap:12px;flex-wrap:wrap;padding-top:8px}
.ptop label{min-width:220px}
.dlg input.search{padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color);font:inherit;font-size:14px}
/* v0.2.1: picker chips and paging */
.pchips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:16px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:12.5px;color:var(--primary-text-color)}
.chip span{color:var(--secondary-text-color);font-variant-numeric:tabular-nums}
.chip.on{background:color-mix(in srgb,var(--primary-color) 18%,transparent);border-color:var(--primary-color)}
.dlg label.tg2{flex-direction:row;align-items:center;gap:6px;font-size:12px;margin-left:auto;color:var(--secondary-text-color)}
.mbody .picks{max-height:none;min-height:0;overflow:visible}
.dlg label.pick.infn{opacity:.6}
.dlg label.mrow.nolab{opacity:.6;cursor:default}
.menu{position:absolute;z-index:25;min-width:200px;max-height:70%;overflow:auto;padding:4px;border-radius:12px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 8px 24px rgba(0,0,0,.3)}
.mtitle{font-size:11.5px;color:var(--secondary-text-color);padding:6px 10px 4px;text-transform:uppercase;letter-spacing:.05em}
.mi{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;cursor:pointer;font-size:13.5px;text-align:left;color:var(--primary-text-color)}
.mi:hover:not([disabled]){background:var(--secondary-background-color)}
.mi[disabled]{color:var(--secondary-text-color);cursor:default}
.mi ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color)}
.msep{height:1px;background:var(--divider-color);margin:4px 6px}
.mdepth{display:flex;align-items:center;gap:4px;padding:4px 10px 6px 38px;flex-wrap:wrap;font-size:12px;color:var(--secondary-text-color)}
.mdepth span{margin-right:4px}
.mdepth.off{opacity:.45}
.mdepth .chip{padding:2px 8px;font-size:12px}
.node .wr.hid{border-style:dashed}
.node .kept{--mdc-icon-size:13px;color:var(--secondary-text-color)}
.node .port{position:absolute;width:8px;height:8px;border-radius:50%;box-sizing:border-box;border:1.5px solid var(--fb-edge);background:var(--card-background-color,#1c1c1c);pointer-events:none}
.node .port.pl{left:-4px}
.node .port.pr{right:-4px}
.board.vert .node .port.pl{top:-4px}
.board.vert .node .port.pr{top:auto;bottom:-4px;right:auto}
.board.full .node .port{pointer-events:auto;cursor:crosshair}
.board.full .node .port:hover{border-color:var(--primary-color);background:var(--primary-color);transform:scale(1.5)}
.dtext{margin:0;font-size:13.5px;line-height:1.5}
.dtext.dno{color:var(--fb-amber-ink)}
.dwarn{display:flex;align-items:flex-start;gap:6px;font-size:12.5px;color:var(--fb-amber-ink);margin-top:2px}
.dwarn ha-icon{--mdc-icon-size:16px;flex:none}
.dlist{overflow:auto;max-height:42vh;border:1px solid var(--divider-color);border-radius:10px}
.dlg label.drow{display:flex;flex-direction:row;align-items:flex-start;gap:10px;padding:7px 10px;border-bottom:1px solid var(--divider-color);font-size:13px;color:var(--primary-text-color);cursor:pointer}
.dlg label.drow.dcant{opacity:.6;cursor:default}
.drow .tag{min-width:80px;text-align:center;margin-top:2px}
.btns button.danger{background:color-mix(in srgb,var(--fb-red) 70%,#000);border-color:color-mix(in srgb,var(--fb-red) 70%,#000);color:#fff}
.btns button[disabled]{opacity:.6;cursor:default}
.clash{font-size:13px;line-height:1.5;padding:10px 12px;border-radius:10px;border:1px solid var(--fb-amber);background:color-mix(in srgb,var(--fb-amber) 10%,transparent)}
.cbtns{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.cbtns button{padding:6px 12px;border-radius:8px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:13px}
.cbtns button.primary{background:var(--fb-primary-fill);border-color:var(--fb-primary-fill);color:#fff}
.more{display:block;margin:10px auto;padding:8px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:13px;color:var(--primary-text-color)}
/* v0.5: developer tools (Phase 9) */
.edges path.hit{fill:none;stroke:transparent;stroke-width:12;pointer-events:stroke}
.edges path.e{pointer-events:none}
.edges path.role-tool{stroke-dasharray:2 5;stroke-width:1.5;stroke-linecap:round}
.edges g.cres{pointer-events:all;cursor:default}
.edges g.cres circle{fill:var(--card-background-color);stroke-width:1.6}
.edges g.cres path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.edges g.cres text{font-size:11px;font-weight:700;stroke:none;paint-order:normal}
.edges g.cres.ok circle{stroke:var(--success-color,#43a047)}.edges g.cres.ok path{stroke:var(--success-color,#43a047)}
.edges g.cres.bad circle{stroke:var(--fb-red)}.edges g.cres.bad path{stroke:var(--fb-red)}
.edges g.cres.unk circle{stroke:var(--secondary-text-color)}.edges g.cres.unk text{fill:var(--secondary-text-color)}
.edges g.cres.dim{opacity:.15}
.lg svg path.role-tool{stroke-dasharray:2 4;stroke-linecap:round}
.cres-k{display:inline-flex;width:15px;height:15px;border-radius:50%;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:1.5px solid;margin-right:3px}
.cres-k.ok{color:var(--success-color,#43a047)}.cres-k.bad{color:var(--fb-red-ink)}
.sw.dashed2{border:2px dashed var(--fb-blue)}
.sw.sbk{border:2px dashed var(--fb-amber)}
.sw.sbg{border:2px dashed var(--fb-amber);border-radius:5px;background:color-mix(in srgb,var(--card-background-color) 80%,var(--fb-amber))}
.node.sim{outline:2px dashed var(--fb-blue);outline-offset:2px}
.board.sbx .vp{background-image:repeating-linear-gradient(45deg,color-mix(in srgb,var(--fb-amber) 6%,transparent) 0 14px,transparent 14px 28px)}
.sbxpill{position:absolute;top:12px;left:12px;display:flex;align-items:center;gap:6px;white-space:nowrap;background:color-mix(in srgb,var(--fb-amber) 20%,var(--card-background-color));border:1px solid var(--fb-amber);color:var(--primary-text-color);border-radius:14px;padding:4px 12px;font-size:12px;z-index:5;pointer-events:none}
.sbxdlg{width:min(620px,94%);overflow:auto}
.sbxdlg h3{display:flex;align-items:center;gap:8px}.sbxdlg h3 ha-icon{color:var(--fb-amber-ink)}
.sbxdlg p{margin:0;font-size:13.5px;line-height:1.45}
.sbxdlg h4{margin:4px 0 0;font-size:13.5px}
.sbxl{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:1.4;color:var(--secondary-text-color)}
.sbxl b{color:var(--primary-text-color);font-weight:500}
.okbox{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--fb-green,#43a047) 14%,transparent);font-size:13px;line-height:1.4}
.okbox ha-icon{--mdc-icon-size:20px;color:var(--fb-green,#43a047);flex:none}
.sbxpill ha-icon{--mdc-icon-size:16px;color:var(--fb-amber-ink)}
.board.sbx .node.sbch{outline:2px dashed var(--fb-amber);outline-offset:2px}
.board.sbx .node[data-sbx]::after{content:attr(data-sbx);position:absolute;right:8px;bottom:-9px;font-size:10px;line-height:14px;padding:0 6px;border-radius:7px;background:var(--secondary-background-color);border:1px solid var(--divider-color);color:var(--primary-text-color)}
.board.sbx .node.sbch[data-sbx]::after{background:var(--fb-amber);border-color:var(--fb-amber);color:#000}
.board.sbx .node.sbch::before{content:'';position:absolute;left:-5px;top:-5px;width:9px;height:9px;border-radius:50%;background:var(--fb-amber)}
.board.sbx .node.dim{border-style:dashed}.board.sbx .node.dim>.ic,.board.sbx .node.dim .badges ha-icon,.board.sbx .node.dim .port{opacity:.18}
.sbctl .sbf{display:inline-flex;gap:4px;flex:1 1 140px;min-width:0}
.sbctl .sbf select,.sbctl .sbf input{flex:1 1 auto;min-width:0;max-width:100%}
.vtabs{position:absolute;left:12px;right:12px;top:10px;z-index:8;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.vtabs>*{pointer-events:auto}
.vtabs:not([hidden])~.sbxpill{top:58px}
.vtabs .vtrow{display:flex;flex-wrap:wrap;gap:4px;align-self:flex-start;padding:3px;border-radius:12px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 2px 8px rgba(0,0,0,.2)}
.vtabs .vtab{display:inline-flex;align-items:center;gap:4px;border-radius:9px;font-size:12.5px;color:var(--secondary-text-color)}
.vtabs button.vtab,.vtabs .vtab>button:first-child{border:0;background:none;padding:5px 9px;cursor:pointer;color:inherit;display:inline-flex;align-items:center;gap:5px;font-size:12.5px}
.vtabs .vtab .ib{border:0;background:none;padding:3px;cursor:pointer;color:var(--secondary-text-color);display:inline-flex}
.vtabs .vtab ha-icon{--mdc-icon-size:15px}
.vtabs .vtab.on{background:color-mix(in srgb,var(--primary-color) 16%,transparent);color:var(--primary-text-color);font-weight:500}
.vtabs .vdot{width:8px;height:8px;border-radius:50%;background:var(--success-color,#43a047)}
.vtabs .vact{font-size:10.5px;padding:0 6px;border-radius:7px;background:var(--fb-success-fill);color:#fff;font-weight:600}
.vtabs .vban{align-self:flex-start;max-width:min(860px,100%);display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:7px 12px;border-radius:10px;background:color-mix(in srgb,var(--card-background-color) 85%,var(--primary-color));border:1px solid var(--primary-color);font-size:12.5px}
.vtabs .vban button{border:1px solid var(--divider-color);background:var(--card-background-color);border-radius:8px;padding:4px 9px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--primary-text-color)}
.vtabs .vban ha-icon{--mdc-icon-size:16px}
.board.vview .vp{background-image:repeating-linear-gradient(-45deg,color-mix(in srgb,var(--primary-color) 5%,transparent) 0 14px,transparent 14px 28px)}
.node .vdtag{position:absolute;left:10px;top:-9px;font-size:10px;line-height:14px;padding:0 6px;border-radius:7px;z-index:2;white-space:nowrap}
.node.vd-chg{outline:2px dashed var(--primary-color);outline-offset:2px}.node.vd-chg .vdtag{background:var(--primary-color);color:#fff}
.node.vd-only{outline:2px dashed var(--fb-red);outline-offset:2px}.node.vd-only .vdtag{background:color-mix(in srgb,var(--fb-red) 70%,#000);color:#fff}
.vers{display:flex;flex-direction:column;min-height:0;flex:1;overflow:auto}
.vers .vnote{padding:10px 14px;font-size:12.5px;color:var(--secondary-text-color);border-bottom:1px solid var(--divider-color)}
.vers .vrow{padding:10px 14px;border-top:1px solid var(--divider-color);font-size:13px}
.vers .vrow.on{box-shadow:inset 3px 0 0 var(--success-color,#43a047)}
.vers .vrow.view{background:color-mix(in srgb,var(--primary-color) 8%,transparent)}
.vers .vrow.top{background:color-mix(in srgb,var(--success-color,#43a047) 7%,transparent);border-bottom:1px solid var(--divider-color)}
.vers .vb button.primary{background:var(--fb-primary-fill);border-color:var(--fb-primary-fill);color:#fff}
.vers .vh{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.vers .vbadge{font-size:10.5px;padding:0 6px;border-radius:7px;background:var(--fb-success-fill);color:#fff;font-weight:600}
.vers .vauto{font-size:10.5px;padding:0 6px;border-radius:7px;border:1px solid var(--divider-color);color:var(--secondary-text-color)}
.vers .vdesc{margin-top:3px;white-space:pre-wrap}
.vers .vm{margin-top:2px;font-size:11.5px;color:var(--secondary-text-color)}
.vers .vb{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.vers .vb button{border:1px solid var(--divider-color);background:none;border-radius:8px;padding:4px 9px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--primary-text-color)}
.vers .vb button.ib{padding:4px 6px}
.vers .vb button:disabled{opacity:.45;cursor:default}
.vers .vb ha-icon{--mdc-icon-size:15px}
.vrdlg .vplan{margin:6px 0 10px;padding-left:18px;font-size:13px}.vrdlg .vplan li{margin:3px 0}
.vrdlg .vdevrow{margin:8px 0;display:flex;flex-direction:column;gap:4px;font-size:13px}
.vrdlg .vdevpick select{width:100%}
.vrdlg .vaddlist{display:flex;flex-direction:column;gap:6px;margin:6px 0 8px;max-height:220px;overflow:auto}
.vrdlg .vaddrow{display:flex;align-items:center;gap:8px;font-size:13px}
.vrdlg .vaddrow .vaddnm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vrdlg .vaddrow select{flex:0 0 auto;max-width:290px}
.board.sbx .edges path.dim,.board.sbx .edges path.chev.dim{opacity:.22}
.flowx{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.flowx path.fx{fill:none;stroke:var(--fb-amber);stroke-width:2;stroke-dasharray:6 4}
.flowx path.fx.cur{stroke-width:2.8}
.flowx path.fx.cond{stroke-dasharray:3 4}
.flowx g.cres circle,.edges g.cres.sbxc circle{fill:var(--card-background-color);stroke-width:2}
.flowx g.cres path{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.flowx g.cres.ok circle,.flowx g.cres.ok path{stroke:var(--success-color,#43a047)}.flowx g.cres.bad circle,.flowx g.cres.bad path{stroke:var(--fb-red)}
.flowx g.cres{pointer-events:all}
circle.fdot{fill:var(--fb-blue);stroke:var(--card-background-color);stroke-width:2}
.flow{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.flow .ghost{position:absolute;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:12px;border:2px dashed var(--fb-amber);background:color-mix(in srgb,var(--card-background-color) 88%,var(--fb-amber));color:var(--primary-text-color);pointer-events:auto;cursor:pointer;transition:opacity .2s}
.flow .ghost.far{opacity:.35}
.flow .ghost.now{box-shadow:0 0 0 3px var(--fb-blue)}
.flow .ghost ha-icon{--mdc-icon-size:18px;color:var(--fb-amber-ink);flex:none}
.flow .ghost .gt{display:flex;flex-direction:column;min-width:0;line-height:1.2}
.flow .ghost .gt b{font-weight:500;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flow .ghost .gt small{font-size:10.5px;color:var(--secondary-text-color)}
.flow .ghost.pulse{animation:pulse 1.8s ease-out}
.flow .fnum{position:absolute;transform:translate(-50%,-50%);min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:var(--secondary-background-color,#eee);border:1.5px solid var(--fb-blue);color:var(--primary-text-color);font-size:11px;font-weight:700;line-height:17px;text-align:center;white-space:nowrap;pointer-events:auto;cursor:pointer;z-index:2}
.flow .fnum.cur{background:color-mix(in srgb,var(--fb-blue) 70%,#000);color:#fff}
.flow .fwait{position:absolute;transform:translate(-100%,-50%);display:flex;align-items:center;gap:3px;height:20px;padding:0 7px;border-radius:10px;background:var(--fb-amber);color:#000;font-size:11px;font-weight:600;white-space:nowrap;pointer-events:auto;z-index:2}
.flow .fwait ha-icon{--mdc-icon-size:13px}
.flow .fsay{position:absolute;transform:translate(-50%,-100%);width:max-content;max-width:380px;padding:3px 9px;border-radius:8px;box-sizing:border-box;background:var(--card-background-color);border:1.5px solid color-mix(in srgb,var(--fb-blue) 35%,transparent);color:var(--primary-text-color);font-size:11.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 6px rgba(0,0,0,.25);pointer-events:auto;z-index:3}
.litbar.flowbar{flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:6px}
.litbar.flowbar .fhead{display:flex;align-items:center;gap:6px;min-width:0}
.litbar.flowbar .fhead .fcur{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.litbar.flowbar .fhead .fpos{color:var(--secondary-text-color);white-space:nowrap}
.litbar.flowbar .fhead button{padding:4px 8px;display:inline-flex;align-items:center}
.litbar.flowbar .fsteps{display:flex;flex-wrap:nowrap;align-items:center;gap:2px;overflow-x:auto;padding-bottom:3px}
.litbar.flowbar .fsteps .larr{flex:none}
.litbar button.fstep{flex:none;white-space:nowrap;border:0;padding:2px 6px;border-radius:7px;background:none;font-size:12px;color:var(--secondary-text-color);display:inline-flex;align-items:center;gap:5px}
.litbar button.fstep.on{color:var(--primary-text-color)}
.litbar button.fstep.cur{background:color-mix(in srgb,var(--fb-blue) 18%,transparent);font-weight:500}
.litbar .lbtns button ha-icon{--mdc-icon-size:16px}
.litbar .lbtns button:disabled{opacity:.4;cursor:default}
i.fsn{font-style:normal;display:inline-block;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:color-mix(in srgb,var(--fb-blue) 70%,#000);color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center}
.dbrow .rt i.fsn{margin-right:4px}
.dbrow.fin{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--fb-blue) 55%,transparent)}
.sbclock{font-variant-numeric:tabular-nums;font-size:12.5px;margin-right:4px;padding:2px 8px;border-radius:8px;background:var(--secondary-background-color);white-space:nowrap}
.sbnote{padding:8px 10px;font-size:12px;color:var(--secondary-text-color);border-bottom:1px solid var(--divider-color)}
.sbctl{display:flex;flex-direction:column;gap:2px;padding:6px 10px;border-bottom:1px solid var(--divider-color)}
.sbsec+.sbsec{border-top:1px solid var(--divider-color);padding-top:2px}
.sbsech{margin:0;font-size:inherit}
.sbsech button{display:flex;align-items:center;gap:4px;width:100%;background:none;border:0;padding:2px 0;font:inherit;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--primary-text-color);cursor:pointer;text-align:left;border-radius:4px;min-height:24px}
.sbsech ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color);transition:transform .15s}
.sbsech button[aria-expanded="false"] ha-icon{transform:rotate(-90deg)}
.sbsecb{display:flex;flex-direction:column;gap:6px;padding:0 0 4px}
.sbsecb[hidden]{display:none}
.sbrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sbl{width:64px;font-size:12px;color:var(--secondary-text-color)}
.sbrow select,.sbrow input:not([type=checkbox]){font:inherit;font-size:12.5px;padding:4px 8px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);min-width:0}
.sbrow .sbent,.sbrow .sbrun,.sbrow .sbpress{flex:1 1 170px}.sbpressx{display:contents}.sbpressx[hidden]{display:none}.sbrow .sbpf{flex:0 1 130px}.sbrow .sbzw{flex:2 1 220px}.sbrow .sbattr{flex:0 1 120px}.sbrow .sbhook,.sbrow .sbcal{flex:1 1 140px}.sbrow .sbsay,.sbrow .sbjump{flex:2 1 200px}.sbrow .sbtrig{flex:1 1 150px}.sbrow .sbtop{flex:1 1 160px}.sbrow .sbpay{flex:1 1 140px}.sbrow .sbval{flex:0 1 130px}.sbrow .sbev{flex:1 1 140px}.sbrow .sbevd{flex:2 1 170px}
.sbrow .chip:disabled{opacity:.5;cursor:default}
.sbcb{display:inline-flex;gap:4px;align-items:center;font-size:12px;color:var(--secondary-text-color)}
.sbdue{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;padding:6px 10px;font-size:11.5px;border-bottom:1px solid var(--divider-color)}.sbdue:empty{display:none}
.sbdue .sbd{font:inherit;font-size:11.5px;padding:2px 8px;border-radius:8px;border:1px solid var(--divider-color);background:none;color:var(--primary-text-color);cursor:pointer}.sbdue .sbd:hover{border-color:var(--fb-blue)}
.sbask:empty{display:none}
.sbq{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;background:color-mix(in srgb,var(--fb-amber) 14%,transparent);border-bottom:1px solid var(--divider-color);font-size:12.5px}
.sbq ha-icon{--mdc-icon-size:18px;color:var(--fb-amber-ink)}.sbq span{flex:1 1 200px}
.sbq input{font:inherit;font-size:12.5px;padding:4px 8px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
.dbrow .dm .sbpart{color:var(--fb-amber-ink)}
.nbsbx{font-size:11.5px;color:var(--fb-amber-ink);padding:0 6px;white-space:nowrap}
.node.watching{box-shadow:0 0 0 2px color-mix(in srgb,var(--fb-blue) 55%,transparent)}
.node.watching::after{content:attr(data-watch);position:absolute;right:8px;top:-9px;font-size:10px;line-height:14px;padding:0 6px;border-radius:7px;background:color-mix(in srgb,var(--fb-blue) 70%,#000);color:#fff;letter-spacing:.02em}
.node.wpulse{animation:pulse 1.4s ease-out}
.node.now{box-shadow:0 0 0 3px var(--fb-blue)}
.node.tool{border-style:dashed}
.node.t-inj{gap:8px;padding:6px 10px 6px 6px}
.node.t-inj .tplay{flex:none;width:34px;height:34px;border-radius:50%;border:0;background:var(--primary-color);color:var(--text-primary-color,#fff);cursor:pointer;display:flex;align-items:center;justify-content:center}
.node.t-inj .tplay ha-icon{--mdc-icon-size:20px}
.node.t-mon{flex-direction:column;align-items:stretch;gap:4px;padding:8px 10px}
.node.t-mon .mhead{display:flex;align-items:center;gap:6px;min-width:0}
.node.t-mon .mhead ha-icon{--mdc-icon-size:18px;color:var(--secondary-text-color);flex:none}
.node.t-mon .mhead .name{flex:1;min-width:0;font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node.t-mon .mcnt{font-size:11px;color:var(--secondary-text-color);font-variant-numeric:tabular-nums}
.node.t-mon .mlist{flex:1;overflow:hidden;display:flex;flex-direction:column;gap:1px;font-size:11px}
.mrow{display:flex;gap:6px;white-space:nowrap;overflow:hidden}
.mrow .mt{color:var(--secondary-text-color);flex:none;font-variant-numeric:tabular-nums}
.mrow .mv{overflow:hidden;text-overflow:ellipsis;font-family:var(--ha-font-family-code,monospace)}
.mrow.err .mv{color:var(--fb-red-ink)}.mrow.muted{color:var(--secondary-text-color)}
.nodebar .nbsep{width:1px;align-self:stretch;margin:2px 2px;background:var(--divider-color)}
.nodebar button[disabled]{opacity:.45;cursor:default}
.ttip{position:absolute;z-index:22;max-width:min(420px,80%);padding:8px 10px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 6px 18px rgba(0,0,0,.3);font-size:12px;pointer-events:none}
.ttip .tth{color:var(--secondary-text-color);margin-bottom:4px}
.ttip .ttt{margin-top:4px}
.ttip code{display:block;font-family:var(--ha-font-family-code,monospace);font-size:11px;white-space:pre-wrap;word-break:break-word;color:var(--secondary-text-color)}
.ttip .ttv{font-weight:500;margin-top:2px;word-break:break-word}
.litbar{position:absolute;left:12px;right:12px;bottom:12px;z-index:9;display:flex;align-items:center;gap:6px 12px;flex-wrap:wrap;padding:8px 12px;border-radius:12px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:12.5px}
.litbar .lsteps{flex:1;min-width:200px;display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px}
.litbar .lstep{color:var(--secondary-text-color)}.litbar .lstep.on{color:var(--primary-text-color);font-weight:500}
.litbar .larr{color:var(--secondary-text-color)}
.litbar .lbtns{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.litbar .lrun{margin-right:6px}
.litbar button{padding:5px 10px;border-radius:8px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:12.5px}
.dhead .rec{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--secondary-text-color);margin-right:auto}
.dhead .rec i{width:8px;height:8px;border-radius:50%;background:var(--secondary-text-color)}
.dhead .rec.on i{background:var(--fb-red);animation:blink 1.6s ease-in-out infinite}
@keyframes blink{50%{opacity:.35}}
.dbg{flex:1;display:flex;flex-direction:column;min-height:0}
.dflt{display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--divider-color)}
.dflt .chip{padding:3px 9px;font-size:12px}
.dwhy{padding:8px 10px;border-bottom:1px solid var(--divider-color);background:var(--secondary-background-color);max-height:40%;overflow:auto}
.dwhy .wh{font-size:13px;margin-bottom:4px}
.dwhy .wwarn{color:var(--fb-amber-ink);font-size:12.5px;margin-bottom:4px}
.dtl{flex:1;overflow:auto}
.dbrow,.wrow{display:grid;grid-template-columns:76px 18px 1fr;gap:8px;align-items:start;width:100%;text-align:left;padding:6px 10px;border:0;border-bottom:1px solid var(--divider-color);background:none;cursor:pointer;font-size:12.5px;color:var(--primary-text-color)}
.wrow{grid-template-columns:110px 1fr;border-bottom:0;padding:4px 0;background:none}
.dbrow:hover,.wrow:hover{background:color-mix(in srgb,var(--primary-text-color) 6%,transparent)}
.dbrow.on{background:color-mix(in srgb,var(--primary-color) 14%,transparent)}
.dbrow ha-icon{--mdc-icon-size:16px;color:var(--secondary-text-color);margin-top:1px}
.dbrow .rt,.wrow .rt{color:var(--secondary-text-color);font-variant-numeric:tabular-nums;font-size:11.5px;margin-top:1px}
.dbrow .dm,.wrow .dm{display:flex;flex-direction:column;min-width:0}
.dbrow .dm b,.wrow .dm b{font-weight:500;overflow:hidden;text-overflow:ellipsis}
.dbrow .dm span,.wrow .dm span{color:var(--secondary-text-color);font-size:11.5px}
.dbrow.note{grid-template-columns:76px 1fr;cursor:default;color:var(--secondary-text-color);font-style:italic}
.dbrow.red .dm b,.wrow.red .dm b{color:var(--fb-red-ink)}.dbrow.muted .dm b,.wrow.muted .dm b{color:var(--secondary-text-color)}
.dbrow.amber .dm b,.wrow.amber .dm b{color:var(--fb-amber-ink)}.dbrow.blue .dm b{color:var(--fb-blue-ink)}
.dbrow.k-test ha-icon,.dbrow.k-watch ha-icon{color:var(--fb-blue-ink)}
.runs .run.on{background:color-mix(in srgb,var(--primary-color) 14%,transparent)}
.runs .msg .rn span{white-space:normal}
.runs .msg .mb{font-size:11.5px}
.dlg .tchoice{display:flex;gap:6px;flex-wrap:wrap}
.dlg .tone{font-size:14px}
.dlg .tfields{display:flex;flex-direction:column;gap:10px}
.dlg .fh{font-size:11.5px;color:var(--secondary-text-color)}
.dlg textarea{padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--ha-font-family-code,monospace);font-size:13px;resize:vertical}
.warnbox{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.5;padding:8px 10px;border-radius:10px;border:1px solid var(--fb-amber);background:color-mix(in srgb,var(--fb-amber) 10%,transparent)}
.warnbox ha-icon{--mdc-icon-size:18px;color:var(--fb-amber-ink);flex:none}
@media (prefers-reduced-motion:reduce){.dhead .rec.on i,.node.pulse,.node.wpulse,.edges path.live,.flowx *{animation:none}.fdot{display:none}.sbsech ha-icon{transition:none}}
/* v0.5: the arrow editor (7.5) */
.links{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.links path.ltmp{fill:none;stroke:var(--primary-color);stroke-width:2.2;stroke-dasharray:7 5}
.board.linking .vp,.board.linking .node{cursor:crosshair}
.lh{position:absolute;z-index:6;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:var(--primary-color);border:3px solid var(--card-background-color);box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:crosshair;touch-action:none}
.edgebar{position:absolute;z-index:8;display:flex;align-items:center;gap:2px;flex-wrap:wrap;max-width:min(520px,90%);padding:4px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);box-shadow:0 4px 14px rgba(0,0,0,.3)}
.edgebar .ebtxt{font-size:12.5px;padding:0 8px;max-width:280px}
.edgebar button{display:flex;align-items:center;gap:4px;padding:5px 8px;border:0;border-radius:8px;background:none;cursor:pointer;font-size:12px}
.edgebar button:hover{background:var(--secondary-background-color)}
.edgebar button[disabled]{opacity:.45;cursor:default}
.edgebar ha-icon{--mdc-icon-size:18px}
.edges path.esel{stroke:var(--primary-color);stroke-width:3.2}
.adlg .arefs{display:flex;flex-direction:column;gap:6px;max-height:42vh;overflow:auto}
.dlg label.aref{flex-direction:row;align-items:flex-start;gap:10px;padding:8px 10px;border:1px solid var(--divider-color);border-radius:10px;font-size:13px;color:var(--primary-text-color);cursor:pointer}
.aref pre,.adlg pre.yprev{margin:6px 0 0;padding:8px 10px;border-radius:8px;background:var(--primary-background-color);font-family:var(--ha-font-family-code,monospace);font-size:12px;white-space:pre-wrap;word-break:break-word;color:var(--primary-text-color)}
.adlg pre.yprev{margin:0}
.adlg .aval b{color:var(--fb-red-ink)}
/* v0.5: Node-RED flows (2.7) */
.node.nodered{border-style:dashed;border-color:color-mix(in srgb,#8f0000 60%,var(--divider-color))}
.node.nodered .ic{color:color-mix(in srgb,#c33 70%,var(--secondary-text-color))}
.lgerr{font-size:11.5px;color:var(--fb-amber-ink);margin:2px 0 0 22px}
.lgbtn{font:inherit;font-size:11.5px;color:var(--fb-primary-ink);background:none;border:1px solid var(--primary-color);border-radius:6px;padding:1px 7px;margin-left:4px;cursor:pointer}
/* v0.5: keyboard (4.8) */
.node:focus{outline:none}
.lfind:focus-within{outline:2px solid var(--primary-color);outline-offset:1px}
.nbody:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}
.drawer .dtitle:focus{outline:none}.drawer .dtitle:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.srt{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.node:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}
button:focus-visible,.chip:focus-visible,.mi:focus-visible{outline:2px solid var(--primary-color);outline-offset:1px}
/* v0.3: modes, welcome, about, hint, no-admin */
.board.m-panel{height:100vh;height:100dvh}
.board.m-card{height:75vh;min-height:520px;border-radius:var(--ha-card-border-radius,12px);border:1px solid var(--divider-color)}
.hamenu{display:none!important}
.board.m-panel.narrow .hamenu{display:inline-flex!important}
.empty.wel{pointer-events:auto;overflow:auto}
.welcome{max-width:560px;text-align:left;color:var(--primary-text-color);line-height:1.5;background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:16px;padding:24px 28px}
.welcome>ha-icon{--mdc-icon-size:36px;color:var(--secondary-text-color)}
.welcome h2{margin:8px 0;font-size:20px;font-weight:500}
.welcome p,.welcome ol{font-size:14px;margin:8px 0}
.welcome ol{padding-left:20px}.welcome li{margin:6px 0}
.wbtns{display:flex;gap:8px;margin:16px 0 8px}
.wbtns button{padding:9px 16px;border-radius:10px;border:1px solid var(--divider-color);background:none;cursor:pointer;font-size:14px}
.wbtns button.primary{background:var(--fb-primary-fill);border-color:var(--fb-primary-fill);color:#fff}
.welcome .safe{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--secondary-text-color)}
.welcome .safe ha-icon{--mdc-icon-size:18px;flex:none}
.ver{display:flex;align-items:center;justify-content:space-between;gap:6px}
.ver .ib{padding:2px}.ver ha-icon{--mdc-icon-size:16px;color:var(--secondary-text-color)}
.dlg.about{width:min(560px,94%);overflow:auto}
.dlg.about h3 .muted{font-size:13px;font-weight:400}
.dlg.about h4{margin:6px 0 0;font-size:13px;font-weight:500;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.05em}
.dlg.about ul{margin:0;padding-left:18px;font-size:13.5px;line-height:1.5}.dlg.about p{margin:0;font-size:13.5px;line-height:1.5}
.lnk{margin-right:auto;font-size:13px;color:var(--fb-primary-ink)}
.cardhint{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:90%;padding:6px 6px 6px 12px;border-radius:10px;background:var(--card-background-color);border:1px solid var(--divider-color);font-size:12.5px;color:var(--secondary-text-color);z-index:4}
.cardhint ha-icon{--mdc-icon-size:18px;flex:none}
.cardhint button{border:0;background:none;cursor:pointer;font-size:16px;color:var(--secondary-text-color);padding:2px 6px}
.noadmin{margin:auto;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;max-width:460px;padding:24px;color:var(--secondary-text-color);font-size:14px;line-height:1.5}
.noadmin b{color:var(--primary-text-color);font-size:16px;font-weight:500}
.noadmin ha-icon{--mdc-icon-size:40px}
/* toolbar follows the board's own width (HA's sidebar, dashboard columns), not the window */
@container (max-width:1120px){.tools button.sec span{display:none}.tools button.sec{padding:6px 7px}}
@container (max-width:880px){.tools button span{display:none}.tools button{padding:6px 7px}}
.scrim{display:none}
.board.compact .list{position:absolute;z-index:8;top:0;bottom:0;left:0;width:min(300px,86%);box-shadow:6px 0 18px rgba(0,0,0,.3)}
.board.compact:not(.nolist)>.scrim{display:block;position:absolute;inset:0;z-index:7;background:rgba(0,0,0,.35)}
.board.compact .drawer{width:100%}
.board.compact .legend{max-width:240px}
.board.firstrun .legend,.board.firstrun .zoom{display:none}
/* v0.15.0: Template Studio & 12-Recipes Gallery */
.dlg.tsdlg{width:min(1120px,96vw);max-height:92vh;display:flex;flex-direction:column;gap:10px}
.tsdlg .tshead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid var(--divider-color)}
.tsdlg .tstitle{display:flex;align-items:flex-start;gap:10px;min-width:0;flex:1}
.tsdlg .tstitle ha-icon{--mdc-icon-size:24px;color:var(--primary-color);flex:none;margin-top:2px}
.tsdlg .tstitle h3{margin:0}
.tsdlg .tsmodes{display:flex;gap:6px;flex-wrap:wrap}
.tsdlg .tssrc{display:flex;gap:6px;flex-wrap:wrap}
.tsdlg .tsgrid{display:grid;grid-template-columns:minmax(290px,1fr) minmax(360px,1.25fr);gap:12px;overflow:auto;min-height:0;flex:1;padding-right:2px}
@media (max-width:860px){.tsdlg .tsgrid{grid-template-columns:1fr}}
.tsdlg .tsleft,.tsdlg .tsright{display:flex;flex-direction:column;gap:10px;min-width:0}
.tsdlg .tspane{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--divider-color);border-radius:12px;background:var(--secondary-background-color)}
.tsdlg .tsphead{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:600;flex-wrap:wrap}
.tsdlg .tsed{width:100%;box-sizing:border-box;font-family:var(--ha-font-family-code,monospace);font-size:12.5px;line-height:1.45;padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--primary-background-color);color:var(--primary-text-color)}
.tsdlg .tsed.small{font-size:12px}
.tsdlg .tsavail summary,.tsdlg .tslearn summary{cursor:pointer;font-size:12px;color:var(--secondary-text-color);font-weight:500}
.tsdlg .tsres{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;font-size:13px;border:1px solid var(--divider-color);background:var(--card-background-color)}
.tsdlg .tsres.ok{border-color:color-mix(in srgb,var(--fb-green) 55%,var(--divider-color))}
.tsdlg .tsres.err{border-color:var(--fb-red);color:var(--fb-red-ink)}
.tsdlg .tsresl{font-size:11.5px;color:var(--secondary-text-color);text-transform:uppercase;letter-spacing:.04em}
.tsdlg .tsresv{font-family:var(--ha-font-family-code,monospace);font-weight:600;word-break:break-word;flex:1;min-width:80px}
.tsbadge{font-size:11px;padding:2px 7px;border-radius:99px;background:var(--secondary-background-color);border:1px solid var(--divider-color);color:var(--secondary-text-color);white-space:nowrap}
.tsbadge.ok{border-color:var(--fb-green);color:var(--fb-green)}
.tsbadge.warn,.tsbadge.sim{border-color:var(--fb-amber);color:var(--fb-amber-ink)}
.tsdlg .tslint{display:flex;flex-direction:column;gap:6px}
.tsdlg .tslint:empty{display:none}
.tsdlg .tswarn{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 9px;border-radius:8px;font-size:12px;line-height:1.4;border:1px solid var(--fb-amber);background:color-mix(in srgb,var(--fb-amber) 10%,transparent)}
.tsdlg .tswarn.error{border-color:var(--fb-red);background:color-mix(in srgb,var(--fb-red) 10%,transparent);color:var(--fb-red-ink)}
.tsdlg .tswarn.info{border-color:var(--fb-blue);background:color-mix(in srgb,var(--fb-blue) 10%,transparent)}
.tsdlg .tswarn ha-icon{--mdc-icon-size:16px;flex:none}
.tsdlg .tswarn span{flex:1;min-width:180px}
.tsdlg .tsclauses{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto}
.tsdlg .tscl{display:flex;flex-direction:column;gap:3px;padding:6px 8px;border-radius:8px;background:var(--card-background-color);border-left:3px solid var(--fb-blue)}
.tsdlg .tscl.if,.tsdlg .tscl.elif,.tsdlg .tscl.else{border-left-color:var(--fb-amber)}
.tsdlg .tscl.expr{border-left-color:var(--fb-green)}
.tsdlg .tscl.error{border-left-color:var(--fb-red)}
.tsdlg .tscltop{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12.5px}
.tsdlg .tscle{font-weight:500}
.tsdlg .tsclv{font-size:11.5px;padding:1px 6px;border-radius:6px;background:color-mix(in srgb,var(--fb-blue) 14%,transparent);color:var(--primary-text-color);white-space:nowrap}
.tsdlg .tsclr{font-size:11px;color:var(--secondary-text-color);font-family:var(--ha-font-family-code,monospace);white-space:pre-wrap;word-break:break-word}
.tsdlg .tssim{display:flex;flex-direction:column;gap:6px;max-height:190px;overflow:auto}
.tsdlg .tssimrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px}
.tsdlg .tssimn{min-width:120px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.tsdlg .tssimv{width:92px;padding:3px 6px;font-size:12px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)}
.tsdlg .tsgloss{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;margin-top:8px}
.tsdlg .tsgcard{display:flex;flex-direction:column;gap:3px;padding:8px;border-radius:8px;background:var(--card-background-color);border:1px solid var(--divider-color);font-size:12px}
.tsdlg .tsgcard code{font-size:11.5px;color:var(--fb-blue-ink);font-family:var(--ha-font-family-code,monospace)}
.tsdlg .tsgcard p{margin:0;color:var(--secondary-text-color);line-height:1.4}
.tsdlg .tsrpick,.tsdlg .tssnips,.tsdlg .tsdays{display:flex;gap:5px;flex-wrap:wrap}
.tsdlg .tsep{display:flex;gap:5px;flex-wrap:wrap;max-height:140px;overflow:auto;padding:6px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color)}
.tsdlg .tsep small{opacity:.7;margin-left:3px}
.tsdlg .tsrow2,.ardlg .tsrow2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tsdlg .tsbands{display:flex;flex-direction:column;gap:6px}
.tsdlg .tsbrow{display:flex;align-items:center;gap:6px}
.tsdlg .tsbrow input[type=number]{width:76px}
.tsdlg .tsbrow input:not([type=number]){flex:1}
.tsdlg .tsents{display:flex;flex-direction:column;gap:5px;max-height:180px;overflow:auto}
.tsdlg .tsent{display:flex;align-items:center;gap:8px;font-size:12.5px;padding:5px 8px;border-radius:8px;background:var(--card-background-color)}
.tsdlg .tsent small{color:var(--secondary-text-color);flex:1;overflow:hidden;text-overflow:ellipsis}
.tsdlg .tssum{margin:0;font-size:13.5px;line-height:1.5}
.tsdlg .tsfoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--divider-color)}
.tsdlg .tsgrow{flex:1}
.dlg.rcpdlg{width:min(860px,94vw);max-height:88vh;display:flex;flex-direction:column;gap:10px}
.rcpdlg .rcphead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.rcpdlg .rcphead h3{margin:0;display:flex;align-items:center;gap:8px}
.rcpdlg .rcpbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.rcpdlg .rcpcats{display:flex;gap:6px;flex-wrap:wrap}
.rcpdlg .rcpbar input{min-width:200px;flex:0 1 260px}
.rcpdlg .rcpgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;overflow:auto;min-height:0;flex:1;padding:2px}
.rcpdlg .rcpcard{display:flex;flex-direction:column;gap:6px;text-align:left;padding:12px;border-radius:12px;border:1px solid var(--divider-color);background:var(--secondary-background-color);color:var(--primary-text-color);cursor:pointer}
.rcpdlg .rcpcard:hover{border-color:var(--primary-color);background:color-mix(in srgb,var(--primary-color) 8%,var(--secondary-background-color))}
.rcpdlg .rcpctop{display:flex;align-items:center;gap:7px;width:100%}
.rcpdlg .rcpctop ha-icon{--mdc-icon-size:18px;color:var(--primary-color);flex:none}
.rcpdlg .rcpctop b{flex:1;font-size:13.5px}
.rcpdlg .rcpcard>span{font-size:12px;line-height:1.4;color:var(--secondary-text-color)}`;
