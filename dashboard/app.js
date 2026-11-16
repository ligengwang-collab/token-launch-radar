(function () {
  'use strict';
  var DATA = window.RADAR || { rows: [], live: [], categories: [], model: {}, model_version: '', as_of: '', floor_usd: 0, watchlist_size: 0, board_size: 0, early_size: 0, live_size: 0, global_multiple: 0, source: '' };
  var WATCHLIST = {};
  (DATA.rows || []).forEach(function (r) { if (r.watchlist) WATCHLIST[r.slug] = true; });

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }
  function fmtMult(n) { return n.toFixed(3) + '×'; }

  /** Growth multiplier from a row's 7-day change, as lib/model.ts does. */
  function growthMultOf(row) {
    var m = DATA.model || {};
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : Math.min(m.growth_cap === undefined ? 100 : m.growth_cap, Math.max(m.growth_floor === undefined ? -50 : m.growth_floor, row.change_7d));
    return 1 + (g / 100) * (m.growth_weight === undefined ? 0.4 : m.growth_weight);
  }

  /** Maturity multiplier at a given age in days, as lib/model.ts does. */
  function maturityAt(age, m) {
    m = m || DATA.model || {};
    var days = m.maturity_days === undefined ? 1460 : m.maturity_days;
    return (m.maturity_floor === undefined ? 0.7 : m.maturity_floor) + (Math.min(Math.max(age, 0), days) / days) * (m.maturity_range === undefined ? 0.3 : m.maturity_range);
  }

  /** Implied value of a row if it had run `age` days with no token. */
  function valueAtAge(row, age) {
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMultOf(row) * maturityAt(age)));
  }

  /** Recompute one row's implied value from its own figures, as lib/model.ts does. */
  function impliedOf(row) {
    var m = DATA.model || {};
    var age = row.age_days === null || row.age_days === undefined ? (m.unknown_age_days === undefined ? 365 : m.unknown_age_days) : row.age_days;
    return valueAtAge(row, age);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var view = 'board';
    var slug = null;
    var params = {};
    var qAt = h.indexOf('?');
    var path = qAt >= 0 ? h.slice(0, qAt) : h;
    var query = qAt >= 0 ? h.slice(qAt + 1) : '';
    if (path.indexOf('detail/') === 0) { view = 'detail'; slug = decodeURIComponent(path.slice(7)); }
    else if (path === 'live') view = 'live';
    else if (path === 'board' || path === '') view = 'board';
    query.split('&').forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split('=');
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return { view: view, slug: slug, params: params };
  }

  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, sort: 'implied', dir: -1, tab: 'pre-token' };

  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watchlistOnly) parts.push('watchlist=1');
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.dir !== -1) parts.push('dir=' + state.dir);
    var h = '#board' + (parts.length ? '?' + parts.join('&') : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function applyHash() {
    var parsed = parseHash();
    if (parsed.view === 'detail') { state.detail = parsed.slug; state.tab = 'pre-token'; }
    else if (parsed.view === 'live') { state.tab = 'live'; state.detail = null; }
    else {
      state.detail = null; state.tab = 'pre-token';
      state.q = parsed.params.q || '';
      state.category = parsed.params.category || 'all';
      state.chain = parsed.params.chain || 'all';
      state.watchlistOnly = parsed.params.watchlist === '1';
      state.sort = parsed.params.sort || 'implied';
      state.dir = parsed.params.dir ? parseInt(parsed.params.dir, 10) : -1;
    }
  }

  function filteredRows() {
    var list = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCHLIST[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  function openDetail(slug) { location.hash = '#detail/' + encodeURIComponent(slug); }
  function goBoard() { location.hash = '#board'; }

  function header() {
    var kickerText = 'Pre-token protocol radar' + (DATA.model_version ? ' · model ' + DATA.model_version : '');
    var wrap = el('header', { 'class': 'hero-head' }, [
      el('div', { 'class': 'kicker', text: kickerText }),
      el('h1', { html: '<span class="brand">Token Radar</span><span class="radar-dot">.</span> <span class="h1-rest">Pre-token protocols, ranked by implied value</span>' }),
      el('p', { 'class': 'lede', html: 'A radar for tokens that do not exist yet. Each protocol below records no token; the board states what its token would be worth if the protocol\u2019s record stayed as it is, and how to farm it. It does not predict whether or when a token is issued.' }),
      el('div', { 'class': 'radar-deco', 'aria-hidden': 'true', html: '<svg viewBox="0 0 140 140" fill="none"><defs><linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4ade80" stop-opacity="0.55"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></linearGradient></defs><circle cx="70" cy="70" r="64" stroke="#334155" stroke-opacity="0.5"/><circle cx="70" cy="70" r="44" stroke="#334155" stroke-opacity="0.4"/><circle cx="70" cy="70" r="24" stroke="#334155" stroke-opacity="0.35"/><line x1="70" y1="2" x2="70" y2="138" stroke="#334155" stroke-opacity="0.3"/><line x1="2" y1="70" x2="138" y2="70" stroke="#334155" stroke-opacity="0.3"/><path class="radar-sweep" d="M70 70 L70 6 A64 64 0 0 1 115 25 Z" fill="url(#sweepGrad)"/><circle cx="100" cy="48" r="3" fill="#4ade80"/><circle cx="52" cy="92" r="2.5" fill="#22d3ee"/><circle cx="70" cy="70" r="3" fill="#e6edf3"/></svg>' }),
    ]);
    var stats = el('div', { 'class': 'stats' }, [
      el('div', { 'class': 'stat' }, [el('div', { 'class': 'k', text: 'Board rows' }), el('div', { 'class': 'v', text: String(DATA.board_size) }), el('div', { 'class': 's', text: DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early' })]),
      el('div', { 'class': 'stat' }, [el('div', { 'class': 'k', text: 'Top implied value' }), el('div', { 'class': 'v', text: DATA.rows.length ? fmtUsd(DATA.rows[0].implied_value_usd) : '—' }), el('div', { 'class': 's', text: DATA.rows.length ? DATA.rows[0].name : '' })]),
      el('div', { 'class': 'stat' }, [el('div', { 'class': 'k', text: 'Live-token set aside' }), el('div', { 'class': 'v', text: String(DATA.live_size) }), el('div', { 'class': 's', text: 'shown at market value' })]),
      el('div', { 'class': 'stat' }, [el('div', { 'class': 'k', text: 'Snapshot' }), el('div', { 'class': 'v', text: DATA.as_of || '—' }), el('div', { 'class': 's', text: 'floor ' + fmtUsd(DATA.floor_usd) })]),
    ]);
    wrap.appendChild(stats);
    return wrap;
  }

  function tabs() {
    var pre = el('button', { 'class': 'tab', type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; state.detail = null; goBoard(); } });
    var live = el('button', { 'class': 'tab', type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; state.detail = null; location.hash = '#live'; } });
    var ind = el('span', { 'class': 'tab-indicator', 'aria-hidden': 'true' });
    return el('div', { 'class': 'tabs' }, [ind, pre, live]);
  }

  /** Slide the segmented-control indicator under the active tab. Falls back to the
   *  plain active-tab style when the active tab cannot be measured. */
  function positionTabIndicator() {
    var box = document.querySelector('.tabs');
    if (!box) return;
    var active = box.querySelector('.tab[aria-pressed="true"]');
    var ind = box.querySelector('.tab-indicator');
    if (!active || !ind || !active.offsetWidth) return;
    ind.style.left = active.offsetLeft + 'px';
    ind.style.width = active.offsetWidth + 'px';
    box.classList.add('has-indicator');
  }

  var indicatorResizeBound = false;
  function bindIndicatorResize() {
    if (indicatorResizeBound) return;
    indicatorResizeBound = true;
    window.addEventListener('resize', positionTabIndicator);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var searchWrap = el('div', { 'class': 'search-wrap' }, [
      el('span', { 'class': 'search-icon', 'aria-hidden': 'true', html: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.6"/><line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' }),
      search,
    ]);
    var cat = el('select', { 'aria-label': 'Filter by category' }, [el('option', { value: 'all', text: 'All categories' })].concat(categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { 'aria-label': 'Filter by chain' }, [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })));
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var wl = el('label', null, [
      el('input', { type: 'checkbox', checked: state.watchlistOnly ? 'checked' : null }),
      document.createTextNode('Watchlist only'),
    ]);
    wl.querySelector('input').addEventListener('change', function (e) { state.watchlistOnly = e.target.checked; writeHash(); render(); });
    var sort = el('select', { 'aria-label': 'Sort by' }, [
      el('option', { value: 'implied', text: 'Sort: implied value', selected: state.sort === 'implied' ? 'selected' : null }),
      el('option', { value: 'tvl', text: 'Sort: TVL', selected: state.sort === 'tvl' ? 'selected' : null }),
      el('option', { value: 'change', text: 'Sort: 7-day change', selected: state.sort === 'change' ? 'selected' : null }),
      el('option', { value: 'age', text: 'Sort: age', selected: state.sort === 'age' ? 'selected' : null }),
      el('option', { value: 'name', text: 'Sort: name', selected: state.sort === 'name' ? 'selected' : null }),
    ]);
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = state.sort === 'name' ? 1 : -1; writeHash(); render(); });
    var clear = el('button', { 'class': 'clear', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; state.sort = 'implied'; state.dir = -1; writeHash(); render(); } });
    var count = el('span', { 'class': 'count', text: '' });
    var box = el('div', { 'class': 'controls' }, [searchWrap, cat, ch, wl, sort, clear, count]);
    box._count = count;
    return box;
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
    return el('th', null, [el('button', { type: 'button', text: label + arrow, onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } writeHash(); render(); } })]);
  }

  function boardTable(list, box) {
    if (list.length === 0) return el('div', { 'class': 'empty', text: 'No protocols match these filters. Clear them to see the whole board.' });
    var head = el('thead', null, [el('tr', null, [
      sortHeader('implied', 'Rank'),
      sortHeader('name', 'Protocol'),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      sortHeader('tvl', 'TVL'),
      sortHeader('change', '7d'),
      sortHeader('age', 'Age'),
      sortHeader('implied', 'Implied value'),
    ])]);
    var body = el('tbody', null, list.map(function (r) {
      var chg = r.change_7d === null ? el('span', { 'class': 'flat', text: '—' }) : el('span', { 'class': r.change_7d >= 0 ? 'up' : 'down', text: fmtPct(r.change_7d) });
      var row = el('tr', { tabindex: '0', 'data-slug': r.slug, onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } }, [
        el('td', { text: String(r.rank), 'class': r.rank <= 3 ? 'top3' : '' }),
        el('td', null, [el('span', { 'class': 'name', text: r.name }), document.createTextNode(' '), el('span', { 'class': 'slug', text: r.slug }), WATCHLIST[r.slug] ? el('span', { 'class': 'badge', text: 'WATCHLIST' }) : null]),
        el('td', { text: r.category || '—' }),
        el('td', { text: (r.chains || []).slice(0, 3).join(', ') || '—' }),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num' }, [chg]),
        el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
        el('td', { 'class': 'num value', text: fmtUsd(r.implied_value_usd) }),
      ]);
      if (r.rank <= 3) row.classList.add('top3');
      return row;
    }));
    if (box && box._count) box._count.textContent = list.length + ' of ' + DATA.rows.length + ' protocols';
    return el('div', { 'class': 'table-wrap' }, [el('table', null, [head, body])]);
  }

  function liveTable() {
    var head = el('thead', null, [el('tr', null, [
      el('th', { text: '#' }), el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Mcap / TVL' }), el('th', { text: '7d' }),
    ])]);
    var body = el('tbody', null, DATA.live.map(function (r, i) {
      var ratio = r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : '—';
      return el('tr', null, [
        el('td', { text: String(i + 1) }),
        el('td', null, [el('span', { 'class': 'name', text: r.name }), document.createTextNode(' '), el('span', { 'class': 'slug', text: r.slug })]),
        el('td', { text: r.category || '—' }),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { 'class': 'num', text: ratio }),
        el('td', { 'class': 'num', text: fmtPct(r.change_7d) }),
      ]);
    }));
    return el('div', null, [
      el('p', { 'class': 'lede', text: 'These protocols already have a token that trades. Their value is the market\u2019s own number, never this radar\u2019s model. They are set aside so the board ranks only what is still to come.' }),
      el('div', { 'class': 'table-wrap' }, [el('table', null, [head, body])]),
    ]);
  }

  function detailView(slug) {
    var r = DATA.rows.find(function (x) { return x.slug === slug; });
    if (!r) return el('div', { 'class': 'empty', text: 'No protocol on this board has that slug.' });
    var m = DATA.model || {};
    var g = r.change_7d === null ? 0 : Math.min(m.growth_cap === undefined ? 100 : m.growth_cap, Math.max(m.growth_floor === undefined ? -50 : m.growth_floor, r.change_7d));
    var growthMult = 1 + (g / 100) * (m.growth_weight === undefined ? 0.4 : m.growth_weight);
    var age = r.age_days === null ? (m.unknown_age_days === undefined ? 365 : m.unknown_age_days) : r.age_days;
    var mat = (m.maturity_floor === undefined ? 0.7 : m.maturity_floor) + (Math.min(Math.max(age, 0), m.maturity_days === undefined ? 1460 : m.maturity_days) / (m.maturity_days === undefined ? 1460 : m.maturity_days)) * (m.maturity_range === undefined ? 0.3 : m.maturity_range);
    var base = r.tvl_usd * r.multiple;
    var recomputed = impliedOf(r);
    var steps = (r.farm_steps || []).map(function (s) { return el('li', { text: s }); });
    return el('div', { 'class': 'detail' }, [
      el('button', { 'class': 'back', type: 'button', text: '← Back to the board', onclick: goBoard }),
      el('h2', null, [document.createTextNode(r.name + ' '), el('span', { 'class': 'slug', text: r.slug }), WATCHLIST[r.slug] ? el('span', { 'class': 'badge', text: 'WATCHLIST' }) : null]),
      el('p', { 'class': 'sub', text: 'Rank ' + r.rank + ' of ' + DATA.rows.length + ' · ' + (r.category || 'No category') + ' · ' + (r.chains || []).join(', ') + ' · records no token' }),
      el('div', { 'class': 'grid' }, [
        el('div', { 'class': 'cell hero' }, [el('div', { 'class': 'k', text: 'Implied value' }), el('div', { 'class': 'v', text: fmtUsd(r.implied_value_usd) }), el('div', { 'class': 's', text: 'model ' + (DATA.model_version || '') })]),
        el('div', { 'class': 'cell' }, [el('div', { 'class': 'k', text: 'TVL' }), el('div', { 'class': 'v', text: fmtUsd(r.tvl_usd) }), el('div', { 'class': 's', text: 'as of ' + (DATA.as_of || '') })]),
        el('div', { 'class': 'cell' }, [el('div', { 'class': 'k', text: '7-day change' }), el('div', { 'class': 'v', text: fmtPct(r.change_7d) }), el('div', { 'class': 's', text: 'TVL change' })]),
        el('div', { 'class': 'cell' }, [el('div', { 'class': 'k', text: 'Age, no token' }), el('div', { 'class': 'v', text: fmtAge(r.age_days) }), el('div', { 'class': 's', text: r.listed_at ? 'tracked since ' + r.listed_at : 'first tracked date unknown' })]),
      ]),
      el('h3', { text: 'How the value is built' }),
      el('table', { 'class': 'breakdown' }, [el('tbody', null, [
        el('tr', null, [el('td', { text: 'TVL × category multiple (' + (r.category || 'Other') + ', ' + fmtMult(r.multiple) + ' from ' + (r.multiple_comps === 1 ? '1 live comp' : r.multiple_comps + ' live comps') + ')' }), el('td', { text: fmtUsdFull(base) })]),
        el('tr', null, [el('td', { text: 'Growth ' + fmtPct(r.change_7d) + ' → ×' + growthMult.toFixed(3) }), el('td', { text: '×' + growthMult.toFixed(3) })]),
        el('tr', null, [el('td', { text: 'Maturity, ' + fmtAge(r.age_days) + ' with no token → ×' + mat.toFixed(3) }), el('td', { text: '×' + mat.toFixed(3) })]),
        el('tr', null, [el('td', { text: 'Implied value' }), el('td', { text: fmtUsdFull(r.implied_value_usd) })]),
      ])]),
      el('p', { 'class': 'note', html: 'The page recomputes this row from its own figures and gets ' + fmtUsdFull(recomputed) + ' — the same number the board states. The multiple is the market\u2019s own median market-cap-per-TVL for the category, not a hand-picked number.' }),
      maturityChart(r),
      el('h3', { text: 'How to farm it' }),
      el('ol', { 'class': 'steps' }, steps),
    ]);
  }

  /**
   * Maturity curve: the protocol's implied value as its maturity factor rises
   * from the floor at day 0 to 1.00 at day 1,460, with everything else held at
   * today's record. The curve comes from the row's own figures through
   * valueAtAge — the same code path the detail view recomputes with — so the
   * chart and the breakdown always agree. It is not a price history: the
   * snapshot carries no history, and the protocol has no token and no price.
   * Zoom is wheel-centered on the cursor; drag pans; buttons and arrow keys
   * work too. The chart draws instantly, with no entrance animation, so
   * prefers-reduced-motion needs no special case.
   */
  function maturityChart(row) {
    var m = DATA.model || {};
    var plateauDays = m.maturity_days === undefined ? 1460 : m.maturity_days;
    var floor = m.maturity_floor === undefined ? 0.7 : m.maturity_floor;
    var range = m.maturity_range === undefined ? 0.3 : m.maturity_range;
    var age = row.age_days === null || row.age_days === undefined ? (m.unknown_age_days === undefined ? 365 : m.unknown_age_days) : row.age_days;
    var ageKnown = row.age_days !== null && row.age_days !== undefined;
    var xMax = Math.max(1800, Math.ceil(age / 100) * 100);
    var v0 = valueAtAge(row, 0);
    var vTop = valueAtAge(row, plateauDays);
    var pad = (vTop - v0) * 0.08;
    var full = { x0: 0, x1: xMax, y0: Math.max(0, v0 - pad), y1: vTop + pad };
    var view = { x0: full.x0, x1: full.x1, y0: full.y0, y1: full.y1 };
    var layout = { padL: 66, padR: 16, padT: 14, padB: 36, pw: 0, ph: 0, w: 0, h: 0 };

    var section = el('section', { 'class': 'chart' }, [
      el('h3', { text: 'Maturity curve' }),
      el('p', { 'class': 'chart-lede', text: 'This is not a price history — ' + row.name + ' has no token and no price. The curve shows what the model\u2019s implied value would be at each age, as the maturity factor rises from ' + floor + ' to ' + (floor + range).toFixed(2) + ' over ' + plateauDays.toLocaleString('en-US') + ' days, with TVL, multiple and growth held at today\u2019s record.' }),
    ]);
    var tools = el('div', { 'class': 'chart-tools' }, [
      el('button', { type: 'button', 'aria-label': 'Zoom in on the chart', text: '+', onclick: function () { zoomAt(0.5, 0.5, 1 / 1.6); } }),
      el('button', { type: 'button', 'aria-label': 'Zoom out of the chart', text: '−', onclick: function () { zoomAt(0.5, 0.5, 1.6); } }),
      el('button', { type: 'button', text: 'Reset', onclick: function () { resetView(); } }),
      el('span', { 'class': 'hint', text: 'Scroll to zoom · drag to pan · arrow keys pan, + / − zoom, 0 resets' }),
    ]);
    var canvas = el('canvas', { 'class': 'maturity-chart', tabindex: '0', role: 'img', 'aria-label': 'Line chart of implied value against days with no token for ' + row.name });
    var wrap = el('div', { 'class': 'chart-wrap' }, [canvas]);
    var cap = el('p', { 'class': 'chart-cap', text: 'At day 0 the model values ' + row.name + ' at ' + fmtUsdFull(v0) + '; at day ' + plateauDays.toLocaleString('en-US') + ' it reaches ' + fmtUsdFull(vTop) + ' and then stays flat. ' + (ageKnown ? 'Today, at ' + age.toLocaleString('en-US') + ' days, it is ' + fmtUsdFull(row.implied_value_usd) + '.' : 'The first tracked date is unknown, so today is plotted at ' + age + ' days, the model\u2019s fallback age, at ' + fmtUsdFull(row.implied_value_usd) + '.') });
    section.appendChild(tools);
    section.appendChild(wrap);
    section.appendChild(cap);

    canvas._chart = {
      view: view, full: full, age: age, implied: row.implied_value_usd,
      valueAt: function (d) { return valueAtAge(row, d); },
      reset: function () { resetView(); },
    };

    function clampView() {
      var minX = 20, minY = (full.y1 - full.y0) * 0.02;
      if (view.x1 - view.x0 < minX) { var cx = (view.x0 + view.x1) / 2; view.x0 = cx - minX / 2; view.x1 = cx + minX / 2; }
      if (view.y1 - view.y0 < minY) { var cy = (view.y0 + view.y1) / 2; view.y0 = cy - minY / 2; view.y1 = cy + minY / 2; }
      if (view.x1 - view.x0 > full.x1 - full.x0) { view.x0 = full.x0; view.x1 = full.x1; }
      if (view.y1 - view.y0 > full.y1 - full.y0) { view.y0 = full.y0; view.y1 = full.y1; }
      if (view.x0 < full.x0) { view.x1 += full.x0 - view.x0; view.x0 = full.x0; }
      if (view.x1 > full.x1) { view.x0 -= view.x1 - full.x1; view.x1 = full.x1; }
      if (view.y0 < full.y0) { view.y1 += full.y0 - view.y0; view.y0 = full.y0; }
      if (view.y1 > full.y1) { view.y0 -= view.y1 - full.y1; view.y1 = full.y1; }
    }
    function resetView() { view.x0 = full.x0; view.x1 = full.x1; view.y0 = full.y0; view.y1 = full.y1; draw(); }
    function zoomAt(fx, fy, factor) {
      var cx = view.x0 + fx * (view.x1 - view.x0);
      var cy = view.y1 - fy * (view.y1 - view.y0);
      var nx = (view.x1 - view.x0) * factor;
      var ny = (view.y1 - view.y0) * factor;
      view.x0 = cx - fx * nx;
      view.x1 = view.x0 + nx;
      view.y0 = cy - (1 - fy) * ny;
      view.y1 = view.y0 + ny;
      clampView();
      draw();
    }

    function draw() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h || !canvas.isConnected) return;
      var dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var padL = layout.padL, padR = layout.padR, padT = layout.padT, padB = layout.padB;
      var pw = w - padL - padR, ph = h - padT - padB;
      if (pw <= 0 || ph <= 0) return;
      layout.pw = pw; layout.ph = ph; layout.w = w; layout.h = h;
      function X(d) { return padL + ((d - view.x0) / (view.x1 - view.x0)) * pw; }
      function Y(v) { return padT + (1 - (v - view.y0) / (view.y1 - view.y0)) * ph; }
      ctx.font = '11px -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
      ctx.textBaseline = 'middle';
      // Y gridlines and tick labels (4 ticks across the current view).
      ctx.strokeStyle = '#1f2b38';
      ctx.fillStyle = '#64748b';
      ctx.lineWidth = 1;
      var i, ty;
      for (i = 0; i <= 3; i++) {
        ty = view.y0 + (i / 3) * (view.y1 - view.y0);
        ctx.beginPath();
        ctx.moveTo(padL, Y(ty));
        ctx.lineTo(padL + pw, Y(ty));
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(fmtUsd(ty), padL - 8, Y(ty));
      }
      // X gridlines and tick labels.
      var ticks = [0, 365, 730, 1095, plateauDays];
      if (1800 <= view.x1 && ticks.indexOf(1800) < 0) ticks.push(1800);
      if (xMax > 1800 && ticks.indexOf(xMax) < 0) ticks.push(xMax);
      ticks.forEach(function (t) {
        if (t < view.x0 || t > view.x1) return;
        ctx.beginPath();
        ctx.moveTo(X(t), padT);
        ctx.lineTo(X(t), padT + ph);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(t.toLocaleString('en-US'), X(t), padT + ph + 12);
      });
      // Axis titles.
      ctx.save();
      ctx.translate(13, padT + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('Implied value', 0, 0);
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.fillText('Days with no token', padL + pw / 2, h - 6);
      // Plateau guide at the day maturity maxes out.
      if (plateauDays >= view.x0 && plateauDays <= view.x1) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(X(plateauDays), padT);
        ctx.lineTo(X(plateauDays), padT + ph);
        ctx.stroke();
        ctx.restore();
        var platLabel = 'maturity maxes · ' + plateauDays.toLocaleString('en-US') + 'd';
        var platW = ctx.measureText(platLabel).width;
        ctx.fillStyle = '#64748b';
        if (X(plateauDays) + 8 + platW <= padL + pw) { ctx.textAlign = 'left'; ctx.fillText(platLabel, X(plateauDays) + 6, padT + 9); }
        else { ctx.textAlign = 'right'; ctx.fillText(platLabel, X(plateauDays) - 6, padT + 9); }
      }
      // The curve itself, sampled every 10 days (exact: linear to the plateau, flat after).
      ctx.beginPath();
      var step = 10, d;
      for (d = 0; d <= xMax; d += step) {
        var px = X(d), py = Y(valueAtAge(row, d));
        if (d === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      if (xMax % step !== 0) ctx.lineTo(X(xMax), Y(valueAtAge(row, xMax)));
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineTo(X(xMax), padT + ph);
      ctx.lineTo(X(0), padT + ph);
      ctx.closePath();
      ctx.fillStyle = 'rgba(74, 222, 128, 0.07)';
      ctx.fill();
      // Today: vertical guide, dot, and label.
      var dotX = X(age), dotY = Y(row.implied_value_usd);
      if (age >= view.x0 && age <= view.x1) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#22d3ee';
        ctx.beginPath();
        ctx.moveTo(dotX, padT);
        ctx.lineTo(dotX, padT + ph);
        ctx.stroke();
        ctx.restore();
      }
      if (dotX >= padL && dotX <= padL + pw && dotY >= padT && dotY <= padT + ph) {
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#4ade80';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#e9eff5';
        ctx.stroke();
        var label = 'Today · ' + fmtAge(age) + ' · ' + fmtUsd(row.implied_value_usd);
        ctx.font = '12px -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        var lw = ctx.measureText(label).width;
        var lx = dotX + 10;
        if (lx + lw + 16 > padL + pw) lx = dotX - 10 - lw - 16;
        var ly = dotY - 30;
        if (ly < padT + 2) ly = dotY + 12;
        ctx.fillStyle = 'rgba(14, 21, 29, 0.92)';
        ctx.strokeStyle = '#2c3d4f';
        ctx.beginPath();
        ctx.rect(lx, ly, lw + 16, 20);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e9eff5';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx + 8, ly + 10);
      }
      canvas.dataset.drawn = '1';
    }

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      var fx = (e.clientX - rect.left - layout.padL) / layout.pw;
      var fy = (e.clientY - rect.top - layout.padT) / layout.ph;
      if (!isFinite(fx) || !isFinite(fy) || layout.pw <= 0) return;
      fx = Math.min(1, Math.max(0, fx));
      fy = Math.min(1, Math.max(0, fy));
      zoomAt(fx, fy, Math.exp(e.deltaY * 0.0012));
    }, { passive: false });

    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is best-effort */ }
      drag = { x: e.clientX, y: e.clientY, x0: view.x0, x1: view.x1, y0: view.y0, y1: view.y1 };
      canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || layout.pw <= 0) return;
      var dx = (e.clientX - drag.x) / layout.pw * (drag.x1 - drag.x0);
      var dy = (e.clientY - drag.y) / layout.ph * (drag.y1 - drag.y0);
      view.x0 = drag.x0 - dx;
      view.x1 = drag.x1 - dx;
      view.y0 = drag.y0 + dy;
      view.y1 = drag.y1 + dy;
      clampView();
      draw();
    });
    function endDrag() { drag = null; canvas.classList.remove('dragging'); }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('keydown', function (e) {
      var span = 0.1;
      if (e.key === '+' || e.key === '=') { zoomAt(0.5, 0.5, 1 / 1.6); e.preventDefault(); }
      else if (e.key === '-') { zoomAt(0.5, 0.5, 1.6); e.preventDefault(); }
      else if (e.key === '0') { resetView(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { var sx = span * (view.x1 - view.x0); view.x0 -= sx; view.x1 -= sx; clampView(); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { var sx2 = span * (view.x1 - view.x0); view.x0 += sx2; view.x1 += sx2; clampView(); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { var sy = span * (view.y1 - view.y0); view.y0 += sy; view.y1 += sy; clampView(); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { var sy2 = span * (view.y1 - view.y0); view.y0 -= sy2; view.y1 -= sy2; clampView(); draw(); e.preventDefault(); }
    });

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { draw(); });
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', draw);
    }
    requestAnimationFrame(function () { draw(); });
    return section;
  }

  function methodSection() {
    var m = DATA.model || {};
    var cats = (DATA.categories || []).slice(0, 12);
    var rows = cats.map(function (c) {
      return el('tr', null, [
        el('td', { text: c.category }),
        el('td', { 'class': 'num', text: fmtMult(c.multiple) }),
        el('td', { 'class': 'num', text: String(c.comps) }),
      ]);
    });
    return el('section', { 'class': 'method' }, [
      el('h2', { text: 'How the radar works' }),
      el('p', { html: 'Implied value = TVL × category multiple × growth × maturity. The multiple is the median market-cap-per-TVL of the live protocols in the same category, shrunk toward the global median (' + fmtMult(DATA.global_multiple || 0) + ') where the category has few live comps, and clamped to [' + (m.multiple_floor || 0) + ', ' + (m.multiple_cap || 0) + ']. Growth is the seven-day TVL change, clamped to [' + (m.growth_floor || 0) + '%, ' + (m.growth_cap || 0) + '%] and weighted ' + (m.growth_weight || 0) + '. Maturity rises with the days a protocol has run with no token, from ' + (m.maturity_floor || 0) + ' to ' + (((m.maturity_floor || 0) + (m.maturity_range || 0)).toFixed(2)) + ' over ' + (m.maturity_days || 0) + ' days.' }),
      el('p', { text: 'No protocol name is special-cased. A farm plan is six steps built from the protocol\u2019s own record — its category, its chains, its TVL and its age — with a cost and a time on every step. The board never says a token will be issued, or when: it says what the token would be worth if the record stayed as it is.' }),
      el('h3', { text: 'Category multiples (highest first)' }),
      el('div', { 'class': 'table-wrap' }, [el('table', null, [el('thead', null, [el('tr', null, [el('th', { text: 'Category' }), el('th', { text: 'Multiple' }), el('th', { text: 'Live comps' })])]), el('tbody', null, rows)])]),
    ]);
  }

  function footer() {
    return el('footer', { 'class': 'foot' }, [
      el('p', { text: 'Snapshot: ' + (DATA.source || 'DefiLlama public API') + ', as of ' + (DATA.as_of || '') + '. Watchlist floor ' + fmtUsd(DATA.floor_usd) + '. ' + (DATA.board_size || 0) + ' protocols ranked; ' + (DATA.live_size || 0) + ' live-token protocols set aside at market value.' }),
      el('p', { text: 'A protocol is called pre-token only because its record carries no token. It may still have one the record does not carry. Nothing here is investment advice, and no farm step is a promise of a reward.' }),
    ]);
  }

  var lastViewKey = null;

  function render() {
    applyHash();
    var main = document.getElementById('board');
    // Keep the search box focused across rebuilds: render() replaces the whole
    // page on every keystroke, so remember the caret and put it back.
    var active = document.activeElement;
    var wasSearch = !!(active && active.getAttribute && active.getAttribute('aria-label') === 'Search protocols');
    var caret = null;
    if (wasSearch) { try { caret = [active.selectionStart, active.selectionEnd]; } catch (e) { caret = null; } }
    main.setAttribute('aria-busy', 'false');
    main.innerHTML = '';
    main.appendChild(header());
    main.appendChild(tabs());
    var viewKey = state.tab + '|' + (state.detail || '');
    var view = el('div', { 'class': 'view' + (viewKey !== lastViewKey ? ' view-enter' : '') });
    lastViewKey = viewKey;
    if (state.tab === 'live') {
      view.appendChild(liveTable());
    } else if (state.detail) {
      view.appendChild(detailView(state.detail));
    } else {
      var box = controls();
      view.appendChild(box);
      view.appendChild(boardTable(filteredRows(), box));
    }
    main.appendChild(view);
    if (!state.detail) main.appendChild(methodSection());
    main.appendChild(footer());
    positionTabIndicator();
    if (wasSearch) {
      var s = main.querySelector('input[type="search"]');
      if (s) {
        s.focus();
        if (caret) { try { s.setSelectionRange(caret[0], caret[1]); } catch (e) { /* caret restore is best-effort */ } }
      }
    }
  }

  window.addEventListener('hashchange', render);
  bindIndicatorResize();
  render();
})();
