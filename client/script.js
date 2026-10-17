/* EFC public site — vanilla JS, no dependencies. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

  /* Tracks whether an element is on screen, so loops can pause. */
  const visibility = (el, threshold = 0.15) => {
    const state = { visible: false };
    if (!el) return state;
    new IntersectionObserver(([e]) => { state.visible = e.isIntersecting; }, { threshold }).observe(el);
    return state;
  };

  /* ─── Nav ─── */
  const nav = $('#navbar');
  const shotMain = $('.shot-main');
  const shotSide = $('.side-wrap');
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle('scrolled', y > 20);
    // the two hero screenshots separate slightly while the hero is in view
    if (!reduced && shotSide && y < innerHeight * 1.2) {
      shotSide.style.transform = `translateY(${y * -0.06}px)`;
      shotMain.style.transform = `translateY(${y * 0.02}px)`;
    }
    updateStory();
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });

  const burger = $('#hamburger');
  const menu = $('#mobileMenu');
  const setMenu = (open) => {
    menu.classList.toggle('open', open);
    nav.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
  };
  burger.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
  $$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));

  /* ─── Section headings fade in once ─── */
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); }
    });
  }, { threshold: 0.2 });
  $$('.reveal').forEach((el) => revealer.observe(el));

  /* ─── Copy buttons ─── */
  $$('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = 'Copied';
        btn.classList.add('copied');
      } catch {
        btn.textContent = 'Select to copy';
      }
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
    });
  });

  /* ─── Story: words light up as you scroll ─── */
  const story = $('#storyText');
  const storyWords = [];
  const splitWords = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span');
          w.className = 'w';
          w.textContent = part;
          storyWords.push(w);
          frag.appendChild(w);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        splitWords(child);
      }
    });
  };
  if (story) splitWords(story);
  function updateStory() {
    if (!story) return;
    if (reduced) { storyWords.forEach((w) => w.classList.add('lit')); return; }
    const r = story.getBoundingClientRect();
    const start = innerHeight * 0.85;
    const end = innerHeight * 0.5;
    const p = Math.min(1, Math.max(0, (start - r.top) / (start - end + r.height)));
    const n = Math.round(p * storyWords.length);
    storyWords.forEach((w, i) => w.classList.toggle('lit', i < n));
  }
  onScroll();

  /* ─── Routing: sticky steps ─── */
  const steps = $$('#routeScrolly .step');
  const labels = ['src/api/health.ts', 'src/api/users/[id].ts', 'src/api/docs/[...slug].ts', 'src/api/users/[id].ts'];
  const setRouteStep = (n) => {
    steps.forEach((s) => s.classList.toggle('active', +s.dataset.step === n));
    $$('#routeScrolly .tree .f').forEach((f) => {
      f.classList.toggle('hide', +f.dataset.from > n);
      f.classList.toggle('on', (f.dataset.hot || '').split(' ').includes(String(n)));
    });
    $$('#routeScrolly .rt').forEach((r) => {
      r.classList.toggle('show', +r.dataset.from <= n);
      r.classList.toggle('new', (r.dataset.new || '').split(' ').includes(String(n)));
    });
    $$('#routeScrolly .code-swap pre').forEach((p) => p.classList.toggle('on', +p.dataset.step === n));
    $('#routeLabel').textContent = labels[n];
  };
  setRouteStep(0);
  const stepIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) setRouteStep(+e.target.dataset.step); });
  }, {
    // on narrow screens the panel is pinned above the steps, so steps activate below it
    rootMargin: window.matchMedia('(max-width: 1000px)').matches ? '-78% 0px -21% 0px' : '-50% 0px -50% 0px',
  });
  steps.forEach((s) => stepIO.observe(s));

  /* ─── Clustering demo ─── */
  const sim = $('#clusterSim');
  if (sim) {
    const arena = $('#clArena');
    const wrap = $('#clWorkers');
    const logEl = $('#clLog');
    const reqEl = $('#clReq');
    const aliveEl = $('#clAlive');
    const crashBtn = $('#crashBtn');
    const simVis = visibility(sim);
    let total = 0;
    let pid = 4120;
    const workers = Array.from({ length: 4 }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'worker';
      el.innerHTML = `<div class="wn">worker ${i + 1}<span class="led"></span></div><div class="pid">pid ${pid += 7}</div><div class="bar"><i></i></div><div class="cnt">0 req</div>`;
      wrap.appendChild(el);
      return { el, name: `worker ${i + 1}`, state: 'up', count: 0, load: 0, pid };
    });
    const log = (text) => {
      const d = document.createElement('div');
      d.textContent = text;
      logEl.appendChild(d);
      while (logEl.children.length > 3) logEl.firstChild.remove();
    };
    const alive = () => workers.filter((w) => w.state === 'up');
    const render = () => {
      reqEl.textContent = total.toLocaleString();
      aliveEl.textContent = alive().length;
      workers.forEach((w) => {
        w.el.querySelector('.cnt').textContent = `${w.count} req`;
        w.el.querySelector('.bar i').style.width = `${Math.min(100, w.load)}%`;
      });
    };
    let rr = 0;
    const send = () => {
      const up = alive();
      if (!up.length) return;
      const w = up[rr++ % up.length];
      total++; w.count++; w.load += 22;
      if (reduced) return;
      const a = arena.getBoundingClientRect();
      const t = w.el.getBoundingClientRect();
      const p = document.createElement('span');
      p.className = 'packet';
      arena.appendChild(p);
      const x0 = a.width / 2 - 3;
      const x1 = t.left - a.left + t.width / 2 - 3;
      const y1 = t.top - a.top + 4;
      p.animate(
        [{ transform: `translate(${x0}px, 34px)` }, { transform: `translate(${x1}px, ${y1}px)` }],
        { duration: 650, easing: 'cubic-bezier(.5,0,.5,1)' },
      ).onfinish = () => {
        p.remove();
        w.el.classList.add('hit');
        setTimeout(() => w.el.classList.remove('hit'), 150);
      };
    };
    setInterval(() => {
      if (!simVis.visible || document.hidden) return;
      send();
      if (Math.random() > 0.6) setTimeout(send, 140);
      workers.forEach((w) => { w.load = Math.max(0, w.load - 9); });
      render();
    }, 480);

    crashBtn.addEventListener('click', () => {
      const up = alive();
      if (up.length < 2) return;
      const w = up[Math.floor(Math.random() * up.length)];
      w.state = 'dead'; w.load = 0;
      w.el.classList.add('dead');
      crashBtn.disabled = true;
      log(`${w.name} (pid ${w.pid}) exited with code 1`);
      render();
      setTimeout(() => {
        w.el.classList.remove('dead');
        w.el.classList.add('boot');
        w.pid += 113;
        w.el.querySelector('.pid').textContent = `pid ${w.pid}`;
        log(`primary started a replacement`);
      }, 1100);
      setTimeout(() => {
        w.el.classList.remove('boot');
        w.state = 'up'; w.count = 0;
        crashBtn.disabled = false;
        log(`${w.name} (pid ${w.pid}) listening on :3000`);
        render();
      }, 2300);
    });
    log('4 workers listening on :3000');
  }

  /* ─── Job timeline (replays while visible) ─── */
  const flow = $('#flow');
  if (flow) {
    const rows = $$('.flow-row', flow);
    const flowVis = visibility(flow, 0.35);
    const delays = [400, 400, 300, 1200, 1100];
    (async () => {
      if (reduced) { rows.forEach((r) => r.classList.add('on')); return; }
      for (;;) {
        if (!flowVis.visible) { await sleep(400); continue; }
        rows.forEach((r) => r.classList.remove('on'));
        for (let i = 0; i < rows.length; i++) {
          await sleep(delays[i]);
          rows[i].classList.add('on');
        }
        await sleep(3600);
      }
    })();
  }

  /* ─── Closing section: the logo bars draw in once ─── */
  const cta = $('#cta');
  if (cta) {
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { cta.classList.add('in'); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(cta);
  }

  /* ─── Data tabs ─── */
  const tabs = $$('.tabs [role="tab"]');
  const select = (tab) => tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      select(next);
      next.focus();
    });
  });
})();
