/* EFC docs — vanilla JS, no dependencies. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const DOCS_SRC = 'https://github.com/pr4shxnt/efc.js/blob/main/docs/';

  /* ─── NAV (mobile menu) ─── */
  const nav = $('#navbar');
  const burger = $('#hamburger');
  const menu = $('#mobileMenu');
  burger.addEventListener('click', () => {
    const open = !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    nav.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
  });

  /* ─── Syntax highlighting (ts/js, bash, json) ─── */
  const KW = new Set(('import export from default const let var async await return if else throw new ' +
    'function type interface extends typeof keyof as of in for while try catch finally class true false null ' +
    'undefined void this satisfies declare module enum').split(' '));
  const RULES = {
    ts: [
      ['c', /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
      ['s', /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/y],
      ['n', /\b\d[\d_]*(?:\.\d+)?\b/y],
      ['w', /[A-Za-z_$][\w$]*/y],
    ],
    bash: [
      ['c', /#[^\n]*/y],
      ['s', /'[^'\n]*'|"(?:\\.|[^"\\\n])*"/y],
      ['p', /^\$ /my],
      ['w', /[A-Za-z_][\w.-]*/y],
    ],
    json: [
      ['s', /"(?:\\.|[^"\\])*"/y],
      ['n', /-?\b\d+(?:\.\d+)?\b/y],
      ['w', /[a-z]+/y],
    ],
  };
  const highlight = (src, lang) => {
    const rules = RULES[lang];
    if (!rules) return esc(src);
    let out = '';
    let i = 0;
    let lineStart = true;
    while (i < src.length) {
      let hit = null;
      for (const [kind, re] of rules) {
        re.lastIndex = i;
        const m = re.exec(src);
        if (m && m[0].length) { hit = [kind, m[0]]; break; }
      }
      if (!hit) {
        const ch = src[i++];
        out += esc(ch);
        if (ch === '\n') lineStart = true;
        else if (!/\s/.test(ch)) lineStart = false;
        continue;
      }
      const [kind, text] = hit;
      const rest = src.slice(i + text.length);
      let cls = kind;
      if (kind === 'w') {
        if (lang === 'json') cls = /^(true|false|null)$/.test(text) ? 'k' : null;
        else if (lang === 'bash') cls = lineStart ? 'f' : null;
        else if (KW.has(text)) cls = 'k';
        else if (/^\s*\(/.test(rest)) cls = 'f';
        else if (/^[A-Z]/.test(text)) cls = 't';
        else cls = null;
      } else if (kind === 'p') {
        cls = 'c';
      }
      if (lang === 'json' && kind === 's' && /^\s*:/.test(rest)) cls = null; // keys stay plain
      out += cls ? `<span class="t-${cls}">${esc(text)}</span>` : esc(text);
      lineStart = kind === 'p';
      i += text.length;
    }
    return out;
  };

  /* Every <pre data-file> becomes a code window with a copy button. */
  $$('.doc pre').forEach((pre) => {
    const code = $('code', pre);
    if (code?.dataset.lang) code.innerHTML = highlight(code.textContent.replace(/\s+$/, ''), code.dataset.lang);
    const win = document.createElement('div');
    win.className = 'window';
    win.innerHTML = `<div class="code-bar"><span class="code-bar-label"></span><button class="copy" type="button">Copy</button></div>`;
    $('.code-bar-label', win).textContent = pre.dataset.file || '';
    pre.replaceWith(win);
    win.appendChild(pre);
    $('.copy', win).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(pre.innerText.replace(/^\$ /gm, ''));
        btn.textContent = 'Copied';
        btn.classList.add('done');
      } catch {
        btn.textContent = 'Select to copy';
      }
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1500);
    });
  });

  /* ─── Pages ─── */
  const articles = $$('.doc article');
  const pages = articles.map((a) => ({
    id: a.dataset.page,
    el: a,
    title: $('h1', a).textContent,
    group: a.dataset.group,
    text: a.textContent.toLowerCase(),
  }));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const links = $$('#sideLinks a');

  const slug = (s) => s.toLowerCase().replace(/[`'"().,:/]+/g, '').trim().replace(/\s+/g, '-');
  pages.forEach((p) => {
    const crumb = document.createElement('div');
    crumb.className = 'crumb';
    crumb.textContent = p.group;
    p.el.prepend(crumb);
    $$('h2, h3', p.el).forEach((h) => {
      h.id = `${p.id}--${slug(h.textContent)}`;
      const a = document.createElement('a');
      a.className = 'anchor';
      a.href = `#${h.id}`;
      a.textContent = '#';
      a.setAttribute('aria-label', `Link to ${h.textContent}`);
      h.appendChild(a);
    });
  });

  const toc = $('#toc');
  const pager = $('#pager');
  const edit = $('#editLink');
  let tocSpy;
  let current;

  const show = (id, headingId) => {
    const page = byId.get(id) || pages[0];
    if (current !== page) {
      current = page;
      articles.forEach((a) => a.classList.toggle('on', a === page.el));
      links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === `#${page.id}`));
      $('#sideCurrent').textContent = page.title;
      document.title = `${page.title} — EFC docs`;
      const lead = $('.lead', page.el);
      if (lead) $('meta[name="description"]').setAttribute('content', lead.textContent.trim().replace(/\s+/g, ' '));
      edit.href = DOCS_SRC + page.el.dataset.src;

      // on-this-page
      toc.innerHTML = '';
      tocSpy?.disconnect();
      const heads = $$('h2, h3', page.el);
      heads.forEach((h) => {
        const li = document.createElement('li');
        if (h.tagName === 'H3') li.className = 'sub';
        li.innerHTML = `<a href="#${h.id}"></a>`;
        li.firstChild.textContent = h.firstChild.textContent;
        toc.appendChild(li);
      });
      tocSpy = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          $$('a', toc).forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
        });
      }, { rootMargin: '-90px 0px -70% 0px' });
      heads.forEach((h) => tocSpy.observe(h));

      // previous / next
      const i = pages.indexOf(page);
      const prev = pages[i - 1];
      const next = pages[i + 1];
      pager.innerHTML =
        (prev ? `<a class="prev" href="#${prev.id}"><small>← Previous</small><span>${esc(prev.title)}</span></a>` : '') +
        (next ? `<a class="next" href="#${next.id}"><small>Next →</small><span>${esc(next.title)}</span></a>` : '');
    }
    const target = headingId && document.getElementById(headingId);
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0 });
  };

  const route = () => {
    const hash = decodeURIComponent(location.hash.slice(1));
    const [pageId] = hash.split('--');
    show(byId.has(pageId) ? pageId : 'quickstart', hash.includes('--') ? hash : null);
    side.classList.remove('open');
    sideToggle.setAttribute('aria-expanded', 'false');
  };

  /* ─── Mobile sidebar ─── */
  const side = $('#side');
  const sideToggle = $('#sideToggle');
  sideToggle.addEventListener('click', () => {
    const open = !side.classList.contains('open');
    side.classList.toggle('open', open);
    sideToggle.setAttribute('aria-expanded', String(open));
  });

  /* ─── Search: filters pages by title and full text ─── */
  const search = $('#search');
  const noHits = $('#noHits');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let hits = 0;
    links.forEach((l) => {
      const p = byId.get(l.getAttribute('href').slice(1));
      const match = !q || p.title.toLowerCase().includes(q) || p.text.includes(q);
      l.classList.toggle('hidden', !match);
      if (match) hits++;
    });
    $$('#sideLinks .group').forEach((g) => g.classList.toggle('hidden', !$$('a:not(.hidden)', g).length));
    noHits.hidden = hits > 0;
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('#sideLinks a:not(.hidden)');
      if (first) location.hash = first.getAttribute('href');
    }
    if (e.key === 'Escape') { search.value = ''; search.dispatchEvent(new Event('input')); search.blur(); }
  });
  addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== search && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (getComputedStyle(sideToggle).display !== 'none') { side.classList.add('open'); sideToggle.setAttribute('aria-expanded', 'true'); }
      search.focus();
    }
  });

  addEventListener('hashchange', route);
  route();
})();
