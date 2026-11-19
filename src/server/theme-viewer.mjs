<script>
KIND_LABELS := { module: ⟪theme.kind-module⟫, theme: ⟪theme.kind-theme⟫, framework: ⟪theme.kind-framework⟫, stylesheet: ⟪theme.kind-stylesheet⟫ }
KIND_ORDER  := { theme: 0, module: 1, stylesheet: 2, framework: 3 }

formatKind = (k) -> KIND_LABELS[k] ?? k

COLOR_RE := new RegExp('^#|^rgb\\(|^hsl\\(|^oklch\\(|^color\\(', 'i')

looksLikeColor = (v) -> COLOR_RE.test(v)

REASONS := {
  'not-found':          ⟪theme.pattern-not-found⟫
  ambiguous:            ⟪theme.pattern-ambiguous⟫
  unchanged:            ⟪theme.pattern-unchanged⟫
  'outside-project':    ⟪theme.pattern-outside-project⟫
  'local-machine-only': ⟪theme.pattern-machine-only⟫
  'unknown-root':       ⟪theme.pattern-root-unknown⟫
  'value-rejected':     ⟪theme.pattern-value-refused⟫
  'name-rejected':      ⟪theme.pattern-name-refused⟫
  'missing-file':       ⟪theme.pattern-file-missing⟫
}

LANG := ⟪#lang⟫

COUNTS := {
  source: [⟪theme.count-source-1⟫, ⟪theme.count-source-n⟫]
  variable: [⟪theme.count-variable-1⟫, ⟪theme.count-variable-n⟫]
  declaration: [⟪theme.count-declaration-1⟫, ⟪theme.count-declaration-n⟫]
  fallback: [⟪theme.count-default-1⟫, ⟪theme.count-default-n⟫]
  set: [⟪theme.count-set-1⟫, ⟪theme.count-set-n⟫]
  read: [⟪theme.count-read-1⟫, ⟪theme.count-read-n⟫]
  direct: [⟪theme.count-direct-1⟫, ⟪theme.count-direct-n⟫]
  restore: [⟪theme.count-restore-1⟫, ⟪theme.count-restore-n⟫]
  reader: [⟪theme.count-reader-1⟫, ⟪theme.count-reader-n⟫]
}

plural = (n) -> LANG == 'en' ? n != 1 : n > 1

count = (n, key) -> COUNTS[key][plural(n) ? 1 : 0].replace('{n}', String(n))

$vars     = []
$query    = ''
$kind     = 'all'
$expanded = {}
$live     = false
$clients  = 0
$edits    = {}
$write    = false
$states    = {}
$opened  = {}

toHex = (v) ->
  s := (v ?? '').trim()
  short := s.match(/^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/)
  return '#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3] if short
  long := s.match(/^#([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?$/)
  return '#' + long[1].toLowerCase() if long
  channels := s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return '' unless channels
  '#' + [1, 2, 3].map((i) -> Math.min(255, +channels[i]).toString(16).padStart(2, '0')).join('')

send = (name, value) ->
  fetch('/__mjs/theme/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vars: { [name]: value } }) }).then((r) -> r.json()).then((d) -> $clients = d.clients).catch((err) -> µ.error(err))

cmp = (x, y) -> x < y ? -1 : x > y ? 1 : 0

writable = (d) -> d.kind != 'framework' and not d.read and not d.set

sourceKey = (d) -> [d.kind, d.declaredBy, d.file, d.variant ?? '', d.set ? 'set' : d.read ? 'read' : ''].join('::')

groupRank = (g) -> g.set ? 2 : g.read ? 1 : 0

buildGroups = (vars) ->
  index := new Map()
  vars.forEach (themeVar) ->
    themeVar.declarations.forEach (d, rank) ->
      key := sourceKey(d)
      group := index.get(key) ?? { key, kind: d.kind, declaredBy: d.declaredBy, file: d.file, variant: d.variant ?? '', read: !!d.read and not d.set, set: !!d.set, rows: [] }
      group.rows.push({ key: key + '::' + themeVar.name + '::' + rank, name: themeVar.name, decl: d, readBy: themeVar.readBy, others: themeVar.declarations.filter((x) -> x != d and not x.read) })
      index.set(key, group)
  [...index.values()].sort((a, b) -> ((KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)) or cmp(a.declaredBy, b.declaredBy) or cmp(a.variant, b.variant) or cmp(a.file, b.file) or (groupRank(a) - groupRank(b)))

matches = (row, q) -> not q or row.name.toLowerCase().includes(q) or row.decl.declaredBy.toLowerCase().includes(q) or row.readBy.some((r) -> r.toLowerCase().includes(q))

save = (row) ->
  return unless writable(row.decl)
  payload := { name: row.name, value: $edits[row.name], file: row.decl.file, line: row.decl.line }
  fetch('/__mjs/theme/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((r) -> r.json()).then((res) -> $states[row.key] = { ok: res.written, text: if res.written then ⟪theme.written-in⟫ + ' ' + res.file + ':' + res.line else (REASONS[res.reason] ?? res.reason) }).catch((err) -> µ.error(err))

applyEdit = (row, value) ->
  $edits[row.name] = value
  send(row.name, value)

commitEdit = (row) ->
  save(row) if $write

restore = (row) ->
  delete $edits[row.name]
  delete $states[row.key]
  send(row.name, '')

restoreAll = ->
  Object.keys($edits).forEach((name) -> send(name, ''))
  $edits = {}
  $states = {}

resetOnClose = ->
  return unless $live and Object.keys($edits).length > 0
  vars := {}
  Object.keys($edits).forEach((name) -> vars[name] = '')
  navigator.sendBeacon('/__mjs/theme/edit', new Blob([JSON.stringify({ vars })], { type: 'application/json' }))

refresh = ->
  fetch('/__mjs/theme.json').then((r) -> r.json()).then((data) -> $vars = Object.keys(data ?? {}).sort().map((name) -> ({ name, declarations: data[name].declarations, readBy: data[name].readBy }))).catch((err) -> µ.error(err))

fetchLiveState = ->
  fetch('/__mjs/theme/edit').then((r) -> r.json()).then((d) -> $live = d.live; $clients = d.clients).catch(-> $live = false)

toggle = (key) ->
  $expanded[key] = not $expanded[key]

toggleKey = (e, key) ->
  return unless e.key is 'Enter' or e.key is ' '
  e.preventDefault()
  toggle(key)

toggleGroup = (g) ->
  $opened[g.key] = not g.open

$groups = buildGroups($vars)
$filtered = $groups.filter((g) -> $kind == 'all' or g.kind == $kind).map((g) -> ({ ...g, open: $opened[g.key] ?? (not g.set or $query.trim() != ''), rows: g.rows.filter((l) -> matches(l, $query.trim().toLowerCase())) })).filter((g) -> g.rows.length > 0)

$countRead   = $vars.filter((themeVar) -> themeVar.readBy.length > 0).length
$countDecl   = $vars.reduce((n, themeVar) -> n + themeVar.declarations.filter((d) -> not d.read and not d.set).length, 0)
$countReadVars   = $vars.reduce((n, themeVar) -> n + themeVar.declarations.filter((d) -> d.read and not d.set).length, 0)
$countSet = $vars.filter((themeVar) -> themeVar.declarations.some((d) -> d.set)).length

$countEdits = Object.keys($edits).length

µmount ->
  refresh()
  fetchLiveState()
</script>

<@window @pagehide={resetOnClose()}>

<div class="workshop">
  <div class="bar">
    <h1>⟪theme.title⟫</h1>
    <div class="stats">
      <span class="stat">{count($groups.length, 'source')}</span>
      <span class="stat">{count($vars.length, 'variable')}</span>
      <span class="stat">{count($countDecl, 'declaration')}</span>
      <span class="stat">{count($countReadVars, 'fallback')}</span>
      {if $countSet > 0}<span class="stat">{count($countSet, 'set')}</span>{end}
      <span class="stat">{count($countRead, 'read')}</span>
    </div>
  </div>

  <div class="direct">
    {if $live}
      <span class="indicator"></span>
      <span class="status">{count($clients, 'direct')}</span>
      <label class="toggle">
        <input type="checkbox" checked=!{$write}>
        <span>⟪theme.save⟫</span>
      </label>
      {if $write}
        <span class="precision written">⟪theme.precision-written⟫</span>
      {else}
        <span class="precision">⟪theme.precision-preview⟫</span>
      {end}
    {else}
      <span class="indicator off"></span>
      <span class="status off">⟪theme.read-only-direct⟫</span>
    {end}
    {if $countEdits > 0}
      <button class="restore-all" @click={restoreAll()}>{count($countEdits, 'restore')}</button>
    {end}
  </div>

  {if $vars.length == 0}
    <p class="empty">⟪theme.empty⟫</p>
  {else}
    <div class="controls">
      <input class="search" type="text" aria-label="⟪theme.search-label⟫" placeholder="⟪theme.search-placeholder⟫" value=!{$query}>
      <div class="filters">
        <button :class{$kind == 'all'}="active" @click={$kind = 'all'}>⟪theme.filter-all⟫</button>
        <button :class{$kind == 'theme'}="active" @click={$kind = 'theme'}>⟪theme.filter-themes⟫</button>
        <button :class{$kind == 'module'}="active" @click={$kind = 'module'}>⟪theme.filter-modules⟫</button>
        <button :class{$kind == 'stylesheet'}="active" @click={$kind = 'stylesheet'}>⟪theme.filter-sheets⟫</button>
        <button :class{$kind == 'framework'}="active" @click={$kind = 'framework'}>⟪theme.filter-framework⟫</button>
      </div>
    </div>

    {if $filtered.length == 0}
      <p class="empty">⟪theme.none⟫</p>
    {else}
      <div class="groups">
        {for g in $filtered by key}
          <section class="group">
            <header class="head">
              <span class="badge badge-{g.kind}">{formatKind(g.kind)}</span>
              <span class="source">{g.declaredBy}</span>
              {if g.variant}<span class="variant">⟪theme.variant⟫ {g.variant}</span>{end}
              {if g.read}<span class="variant">⟪theme.badge-defaults⟫</span>{end}
              {if g.set}<span class="variant">⟪theme.badge-set⟫</span>{end}
              <span class="location">{g.file}</span>
              {if not writable(g.rows[0].decl)}<span class="read-only">⟪theme.badge-read-only⟫</span>{end}
              <span class="count">{count(g.rows.length, 'variable')}</span>
              {if g.set}<button class="fold" aria-label="⟪theme.fold⟫ {g.declaredBy}" aria-expanded="{g.open}" @click={toggleGroup(g)}>{if g.open}▾{else}▸{end}</button>{end}
            </header>
            {if g.open}
            <div class="list">
              {for l in g.rows by key}
                <div class="variable" role="button" tabindex="0" @click={toggle(l.key)} @keydown={toggleKey(e, l.key)}>
                  {const current = $edits[l.name] ?? l.decl.value}
                  {const hex = $live and not l.decl.set ? toHex(current) : ''}
                  <div class="row">
                    {if hex}
                      <input class="swatch live" type="color" aria-label="⟪theme.color-of⟫ {l.name}" value={hex} @click.stop={} @input.stop={applyEdit(l, e.target.value)} @change.stop={commitEdit(l)}>
                    {else}
                      {if looksLikeColor(current)}<span class="swatch" :style.background={current}></span>{end}
                    {end}
                    <span class="name">{l.name}</span>
                    <span class="value">{current}</span>
                    {if $edits[l.name]}
                      <span class="value source-value">⟪theme.source⟫ {l.decl.value}</span>
                      <button class="restore" aria-label="⟪theme.restore-name⟫ {l.name}" @click.stop={restore(l)}>⟪theme.restore⟫</button>
                    {end}
                    {if $states[l.key]}
                      <span class="write" :class{$states[l.key].ok == false}="failed">{$states[l.key].text}</span>
                    {end}
                    <span class="location">{if l.decl.read}⟪theme.default⟫{elsif l.decl.line > 0}⟪theme.line⟫ {l.decl.line}{else}⟪theme.line-unknown⟫{end}</span>
                    {if l.others.length > 0 and not l.decl.read}
                      <span class="elsewhere">+{l.others.length} ⟪theme.elsewhere⟫</span>
                    {end}
                    <span class="readers">{count(l.readBy.length, 'reader')}</span>
                  </div>
                  {if $expanded[l.key]}
                    <div class="detail">
                      {if l.decl.doc}<p class="doc">{l.decl.doc}</p>{end}
                      {if l.decl.set}
                        <p class="doc">{l.decl.declaredBy} ⟪theme.doc-set⟫</p>
                      {elsif l.decl.read}
                        <p class="doc">{l.decl.declaredBy} ⟪theme.doc-read⟫</p>
                      {end}
                      {if $write}
                        {if l.decl.set}
                          <p class="target">⟪theme.target-set⟫</p>
                        {elsif l.decl.read}
                          <p class="target">⟪theme.target-default⟫</p>
                        {elsif writable(l.decl)}
                          <p class="target">⟪theme.target-to⟫ {l.decl.file}{if l.decl.line > 0}:{l.decl.line}{else} — ⟪theme.target-line-searched⟫{end}</p>
                        {else}
                          <p class="target">⟪theme.target-framework⟫</p>
                        {end}
                      {end}
                      {if l.others.length > 0}
                        {if l.decl.read}
                          <p class="cascade">⟪theme.cascade-read⟫</p>
                        {else}
                          <p class="cascade">⟪theme.cascade-elsewhere⟫</p>
                        {end}
                        <div class="declarations">
                          {for d in l.others}
                            <div class="declaration">
                              <span class="badge badge-{d.kind}">{formatKind(d.kind)}</span>
                              <span class="declared-by">{d.declaredBy}</span>
                              {if d.variant}<span class="variant">⟪theme.variant⟫ {d.variant}</span>{end}
                              <span class="value">{d.value}</span>
                              <span class="location">{d.file}:{d.line}</span>
                            </div>
                          {end}
                        </div>
                      {end}
                      {if l.readBy.length == 0}
                        <p class="no-reader">⟪theme.no-reader⟫</p>
                      {else}
                        <div class="reader-list">
                          <span class="readers-title">⟪theme.read-by⟫</span>
                          {for r in l.readBy}
                            <span class="reader">{r}</span>
                          {end}
                        </div>
                      {end}
                    </div>
                  {end}
                </div>
              {end}
            </div>
            {end}
          </section>
        {end}
      </div>
    {end}
  {end}
</div>

<style>
  .workshop
    display: block
    background: #14171f
    color: #e4e6ec
    font: 14px/1.5 system-ui, sans-serif
    min-height: 100vh
    padding: 1.5rem
    box-sizing: border-box
  .bar
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 1rem
    margin-bottom: 1.25rem
  h1
    font-size: 1.1rem
    margin: 0
    margin-right: auto
    color: #f4f4f5
  .stats
    display: flex
    gap: 1rem
    color: #8a8f9c
    font-size: 0.85rem
  .empty
    color: #8a8f9c
  .controls
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.75rem
    margin-bottom: 1.25rem
  .search
    flex: 1
    min-width: 240px
    background: #1b1f29
    color: #e4e6ec
    border: 1px solid #363c4c
    border-radius: 6px
    padding: 0.45rem 0.7rem
    font: inherit
    &:focus
      outline: none
      border-color: #3a6df0
  .filters
    display: flex
    flex-wrap: wrap
    gap: 0.4rem
  button
    background: #232733
    color: #e4e6ec
    border: 1px solid #363c4c
    border-radius: 6px
    padding: 0.4rem 0.8rem
    cursor: pointer
    font: inherit
    &:hover
      background: #2c3140
  button.active
    background: #3a6df0
    border-color: #3a6df0
    color: #fff
  .groups
    display: flex
    flex-direction: column
    gap: 0.9rem
  .group
    background: #171b24
    border: 1px solid #2a2f3c
    border-radius: 8px
    overflow: hidden
  .head
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.6rem
    padding: 0.55rem 0.8rem
    background: #1f2430
    border-bottom: 1px solid #2a2f3c
  .source
    font-family: ui-monospace, monospace
    font-weight: 600
    color: #f4f4f5
  .count
    margin-left: auto
    color: #6b7280
    font-size: 0.75rem
    white-space: nowrap
  .fold
    background: none
    border: none
    color: #8a8f9c
    padding: 0 0.3rem
    font-size: 0.9rem
  .read-only
    color: #c07a2a
    font-size: 0.75rem
  .list
    display: flex
    flex-direction: column
    gap: 0.3rem
    padding: 0.5rem
  .variable
    background: #1b1f29
    border: 1px solid #2a2f3c
    border-radius: 6px
    padding: 0.5rem 0.7rem
    cursor: pointer
    &:hover
      border-color: #3a6df0
  .row
    display: flex
    align-items: center
    gap: 0.6rem
  .swatch
    display: inline-block
    width: 12px
    height: 12px
    border-radius: 50%
    border: 1px solid rgba(255, 255, 255, 0.3)
    flex-shrink: 0
  input.swatch.live
    width: 18px
    height: 18px
    padding: 0
    cursor: pointer
    background: none
    &::-webkit-color-swatch-wrapper
      padding: 0
    &::-webkit-color-swatch
      border: none
      border-radius: 50%
    &::-moz-color-swatch
      border: none
      border-radius: 50%
  .direct
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.6rem
    margin-bottom: 1.25rem
    padding: 0.5rem 0.8rem
    background: #1b1f29
    border: 1px solid #2a2f3c
    border-radius: 8px
  .indicator
    width: 8px
    height: 8px
    border-radius: 50%
    background: #3fb950
    flex-shrink: 0
  .indicator.off
    background: #6b7280
  .status
    color: #e4e6ec
    font-size: 0.85rem
  .status.off
    color: #8a8f9c
  .precision
    color: #6b7280
    font-size: 0.8rem
  .precision.written
    color: #d8b34a
  .toggle
    display: inline-flex
    align-items: center
    gap: 0.35rem
    color: #e4e6ec
    font-size: 0.8rem
    cursor: pointer
    user-select: none
  .toggle input
    accent-color: #3fb950
    cursor: pointer
  .restore-all
    margin-left: auto
    font-size: 0.8rem
    padding: 0.3rem 0.6rem
  .restore
    font-size: 0.7rem
    padding: 0.05rem 0.4rem
    border-radius: 4px
    flex-shrink: 0
  .write
    color: #3fb950
    font-size: 0.75rem
    font-family: ui-monospace, monospace
  .write.failed
    color: #e5714d
  .name
    font-family: ui-monospace, monospace
    font-weight: 600
  .value
    color: #a9afbc
    font-family: ui-monospace, monospace
    font-size: 0.85rem
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
  .source-value
    color: #6b7280
    font-size: 0.75rem
  .badge
    font-size: 0.7rem
    text-transform: uppercase
    letter-spacing: 0.04em
    padding: 0.1rem 0.45rem
    border-radius: 4px
    background: #363c4c
    flex-shrink: 0
  .badge-module
    background: #3a6df0
  .badge-theme
    background: #8a5ff0
  .badge-framework
    background: #c07a2a
  .badge-stylesheet
    background: #2a6f5f
  .declared-by
    color: #8a8f9c
    font-size: 0.8rem
  .elsewhere
    color: #d8b34a
    font-size: 0.75rem
    white-space: nowrap
  .readers
    margin-left: auto
    color: #6b7280
    font-size: 0.75rem
    white-space: nowrap
  .detail
    margin-top: 0.6rem
    padding-top: 0.6rem
    border-top: 1px solid #2a2f3c
  .cascade
    margin: 0 0 0.5rem
    color: #d8b34a
    font-size: 0.8rem
  .target
    margin: 0 0 0.5rem
    color: #8a8f9c
    font-size: 0.8rem
    font-family: ui-monospace, monospace
  .declarations
    display: flex
    flex-direction: column
    gap: 0.4rem
  .declaration
    display: flex
    flex-wrap: wrap
    align-items: baseline
    gap: 0.5rem
    padding: 0.4rem 0.5rem
    background: #0d0f14
    border-radius: 6px
  .variant
    color: #6b7280
    font-size: 0.75rem
    font-style: italic
  .location
    color: #6b7280
    font-size: 0.75rem
    font-family: ui-monospace, monospace
  .doc
    margin: 0 0 0.5rem
    color: #8a8f9c
    font-size: 0.8rem
  .no-reader
    margin: 0.5rem 0 0
    color: #6b7280
    font-size: 0.8rem
  .reader-list
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 0.4rem
    margin-top: 0.5rem
  .readers-title
    color: #6b7280
    font-size: 0.75rem
  .reader
    background: #232733
    border-radius: 4px
    padding: 0.1rem 0.5rem
    font-size: 0.8rem
    font-family: ui-monospace, monospace
</style>
