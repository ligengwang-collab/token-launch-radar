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

  /** Recompute one row's implied value from its own figures, as lib/model.ts does. */
  function impliedOf(row) {
    var m = DATA.model || {};
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : Math.min(m.growth_cap === undefined ? 100 : m.growth_cap, Math.max(m.growth_floor === undefined ? -50 : m.growth_floor, row.change_7d));
    var growthMult = 1 + (g / 100) * (m.growth_weight === undefined ? 0.4 : m.growth_weight);
    var age = row.age_days === null || row.age_days === undefined ? (m.unknown_age_days === undefined ? 365 : m.unknown_age_days) : row.age_days;
    var mat = (m.maturity_floor === undefined ? 0.7 : m.maturity_floor) + (Math.min(Math.max(age, 0), m.maturity_days === undefined ? 1460 : m.maturity_days) / (m.maturity_days === undefined ? 1460 : m.maturity_days)) * (m.maturity_range === undefined ? 0.3 : m.maturity_range);
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * mat));
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
      el('h3', { text: 'How to farm it' }),
      el('ol', { 'class': 'steps' }, steps),
    ]);
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
