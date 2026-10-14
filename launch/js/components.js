/*
 * Componentes de interface (HTML/CSS reais) e montagem das cenas. Os textos são curtos e os dados
 * fictícios são os mesmos em todas as cenas (Ana, Leo, "Study chapter 4", foco de 25 min...).
 */
(function () {
  const NB = window.NB;
  const C_SMALL = 2 * Math.PI * 46; // anel da ilha (cena 3)
  const C_BIG = 2 * Math.PI * 130; // anel do foco (cena 4)
  NB.RING = { small: C_SMALL, big: C_BIG };

  const check = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 12.5 L10 17 L19 7"/></svg>`;
  const bell = `<svg class="bell" viewBox="0 0 24 24" width="26" height="26"><path d="M6 17h12l-1.5-2.2V10a4.5 4.5 0 0 0-9 0v4.8Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 19.5a2 2 0 0 0 4 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const pauseIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="7" y="5" width="3.2" height="14" rx="1" fill="#050505"/><rect x="13.8" y="5" width="3.2" height="14" rx="1" fill="#050505"/></svg>`;
  const skipIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l9 6-9 6Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M18 6v12" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;

  const ring = (size, r, stroke, cls, c) => `
    <svg class="${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="prog" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" style="stroke-dasharray:${c};stroke-dashoffset:${c}"/>
    </svg>`;

  NB.ui = {
    desktop: (id) => `
      <div class="desktop" id="${id}">
        <div class="win win-a">
          <div class="win-bar"><i></i><i></i><i></i><span>Notes — Monday</span></div>
          <div class="win-body">
            <div class="doc-title">Weekly plan</div>
            <div class="ln" style="width:88%"></div><div class="ln" style="width:72%"></div>
            <div class="ln" style="width:80%"></div><div class="ln" style="width:46%"></div>
            <div class="ln" style="width:64%"></div>
          </div>
        </div>
        <div class="win win-b">
          <div class="win-bar"><i></i><i></i><i></i><span>Inbox</span></div>
          <div class="win-body">
            <div class="mail"><b>Ana</b><span>Design review moved to 3 PM</span></div>
            <div class="mail"><b>Leo</b><span>Logo shapes, round two</span></div>
            <div class="mail"><b>Team</b><span>Sprint notes are ready</span></div>
          </div>
        </div>
        <div class="taskbar"><span class="tb-start"></span><span class="ico"></span><span class="ico"></span><span class="ico"></span><span class="ico"></span><span class="clock">09:41</span></div>
      </div>`,

    /** Ilha de controle (cena 3): Tasks, Focus e Notes. */
    controlIsland: () => `
      <div class="ui-card" id="ctrlIsland">
        <div class="ib-head">
          <span class="ui-mark">${NB.markSVG(26)}</span><span class="ib-title">Today</span>
          <div class="ib-tabs"><span class="on">Tasks</span><span>Focus</span><span>Notes</span></div>
        </div>
        <div class="ib-grid">
          <section class="ib-sec ib-tasks">
            <header><h4>Tasks</h4><span class="count"><span class="c3">3 left</span><span class="c2">2 left</span></span></header>
            <ul>
              <li class="task" id="taskDone"><span class="cb">${check}</span><span class="tt">Reply to Ana</span><span class="due">10:30</span><span class="strike"></span></li>
              <li class="task"><span class="cb">${check}</span><span class="tt">Review sprint notes</span><span class="due">13:00</span></li>
              <li class="task"><span class="cb">${check}</span><span class="tt">Study chapter 4</span><span class="due">18:00</span></li>
            </ul>
          </section>
          <section class="ib-sec ib-focus">
            <h4>Focus</h4>
            <div class="ib-focus-row">${ring(110, 46, 7, 'ib-ring', C_SMALL)}<div><div class="ib-time">25:00</div><div class="ib-sub">Deep work</div></div></div>
          </section>
          <section class="ib-sec ib-notes">
            <h4>Notes</h4>
            <p class="note-title">Ideas for Friday</p>
            <div class="ln" style="width:86%"></div><div class="ln" style="width:58%"></div>
          </section>
        </div>
      </div>`,

    /** Temporizador de foco (cena 4). */
    focusCard: () => `
      <div class="ui-card" id="focusCard">
        <div class="fc-head">
          <span class="pill">Focus</span><span class="fc-task">Study chapter 4</span>
          <span class="fc-session">Session 2 of 4 <i class="dots"><b class="on"></b><b class="d2"></b><b></b><b></b></i></span>
        </div>
        <div class="fc-body">
          <div class="fc-ring">${ring(300, 130, 9, 'big-ring', C_BIG)}
            <div class="fc-center"><div class="fc-time">25:00</div><div class="fc-label">remaining</div></div>
          </div>
          <div class="fc-side">
            <div class="fc-stat"><span>Next break</span><b>5 min</b></div>
            <div class="fc-stat"><span>Focused today</span><b>1h 40m</b></div>
            <div class="fc-ctrls"><span class="btn solid">${pauseIcon}</span><span class="btn">${skipIcon}</span></div>
          </div>
        </div>
      </div>`,

    noteCard: () => `
      <div class="ui-card float" id="note4">
        <span class="kicker">Note</span>
        <p class="note-title">Ideas for Friday</p>
        <div class="ln" style="width:90%"></div><div class="ln" style="width:70%"></div><div class="ln" style="width:52%"></div>
      </div>`,

    reminderCard: () => `
      <div class="ui-card float row" id="rem4">${bell}<div><span class="kicker">Reminder</span><p>Drink water</p></div><span class="due">15:30</span></div>`,

    taskChip: () => `
      <div class="ui-card float row" id="chip4"><span class="cb">${check}</span><p>Review sprint notes</p><span class="due">13:00</span></div>`,

    /** Ilha compacta que se expande numa conversa (cena 5). */
    island5: () => `
      <div class="ui-card" id="island5">
        <div class="pill-row">${ring(30, 11, 3, 'mini-ring', 2 * Math.PI * 11)}<span>Focus</span><span class="pill-time">24:56</span></div>
        <div class="open-body">
          <div class="chat-head"><span class="ui-mark">${NB.markSVG(30)}</span><b>${NB.config.name}</b><span class="online">here with you</span></div>
          <div class="msg me">What's next today?</div>
          <div class="msg bot"><span class="bot-text"></span></div>
          <div class="note-chip"><span class="cb on">${check}</span><span>Note saved · Ask Leo about the logo</span></div>
        </div>
      </div>`,

    cursor: () => `
      <svg id="cursor" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
        <path d="M5 3 L5 19 L9.5 14.8 L12.6 21 L15.2 19.8 L12.2 13.7 L18.4 13.4 Z" fill="#ffffff" stroke="#050505" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>`,
  };

  /** Monta todas as cenas na composição. */
  NB.mount = () => {
    const $ = (s) => document.querySelector(s);
    const cfg = NB.config;

    $('#brandLayer').innerHTML = `
      <div id="glow"></div>
      <div id="logoWrap" class="logo-wrap">${NB.logoSVG()}</div>
      <div id="wordmark">${cfg.brand}</div>
      <div id="tagline">${cfg.tagline}</div>`;

    $('#s2').innerHTML = `
      ${NB.ui.desktop('desktop')}
      <h1 class="h" id="h2">Your desktop.<br><span class="g">A little more</span> alive.</h1>`;

    $('#s3').innerHTML = `
      <h1 class="h" id="h3"><span class="strong">MORE</span> <span class="small">than a</span> <span class="strong">MASCOT.</span></h1>
      ${NB.ui.controlIsland()}
      <div id="burst">${Array.from({ length: 6 }, (_, i) => `<span style="--a:${-150 + i * 24}deg"><i></i></span>`).join('')}</div>`;

    $('#s4').innerHTML = `
      <h1 class="h" id="h4">Your routine,<br><span class="g">with a little</span> company.</h1>
      ${NB.ui.focusCard()}${NB.ui.noteCard()}${NB.ui.reminderCard()}${NB.ui.taskChip()}`;

    $('#s5').innerHTML = `
      ${NB.ui.desktop('desktop2')}
      <div id="scrim"></div>
      <h1 class="h" id="h5">Always there.<br><span class="g">Never in the way.</span></h1>
      ${NB.ui.island5()}`;

    $('#s6').innerHTML = `
      <div class="giant" style="--o:.05">BUDDY</div>
      <div class="giant" style="--o:.09">BUDDY</div>
      <div class="giant solid" style="--o:.06">BUDDY</div>
      <h1 class="h" id="h6"><span class="g">A little buddy.</span> A big difference.</h1>`;

    // Mascote (ator único que atravessa as cenas 2–6) e elementos que orbitam junto dele na cena 6.
    $('#actorLayer').innerHTML = `
      <div class="orb" id="orb0"><div class="orb-c orb-chip"><span class="cb on">${check}</span><span class="done">Reply to Ana</span></div></div>
      <div class="orb" id="orb1"><div class="orb-c orb-ring">${ring(92, 38, 6, 'o-ring', 2 * Math.PI * 38)}<span>24:52</span></div></div>
      <div class="orb" id="orb2"><div class="orb-c orb-note"><span class="kicker">Note</span><p>Ideas for Friday</p><div class="ln" style="width:80%"></div></div></div>
      <div class="orb" id="orb3"><div class="orb-c orb-pill"><i></i>Focus<span>24:52</span></div></div>
      <div id="actor" class="actor">${NB.mascotSVG('m')}</div>`;

    // Fragmentos que convergem para formar o símbolo final (cena 7).
    const frags = [];
    for (let i = 0; i < 16; i++) frags.push(`<i class="frag${i % 4 === 3 ? ' sq' : ''}" style="--w:${i % 4 === 3 ? 12 : 70 + ((i * 53) % 170)}px"></i>`);
    $('#fxLayer').innerHTML = `<div id="shell" class="ui-card"></div>${NB.ui.cursor()}<div id="frags">${frags.join('')}</div>`;
  };
})();
