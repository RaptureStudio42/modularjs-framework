<script>
removeToken = ->
  params := new URLSearchParams(location.search)
  return unless params.has('token')
  params.delete('token')
  rest := params.toString()
  history.replaceState(null, '', location.pathname + (if rest then '?' + rest else '') + location.hash)

formatDate = (ms) ->
  return '' unless ms
  new Date(ms).toLocaleString()

$entries = []
$filter = 'all'
$expanded = {}
$failed = false

markFailed = (err) ->
  $failed = true
  µ.error(err)

refresh = ->
  $failed = false
  fetch('/__mjs/errors.json').then((r) -> r.json()).then((data) -> $entries = data ?? []).catch(markFailed)

toggle = (sig) ->
  $expanded[sig] = not $expanded[sig]

toggleKey = (e, sig) ->
  return unless e.key is 'Enter' or e.key is ' '
  e.preventDefault()
  toggle(sig)

doPurge = (source) ->
  question = if source then ⟪journal.purge-source-question⟫.replace('{source}', source) else ⟪journal.purge-all-question⟫
  return unless window.confirm(question)
  qs = source ? ('?source=' + source) : ''
  fetch('/__mjs/errors' + qs, { method: 'DELETE' }).then((-> refresh())).catch((err) -> µ.error(err))

filtered = (entries, filter) -> entries.filter (e) -> filter == 'all' or e.source == filter

µmount ->
  removeToken()
  refresh()
</script>

<div class="panel">
  <div class="bar">
    <h1>⟪journal.title⟫</h1>
    <div class="filters">
      <button :class{$filter == 'all'}="active" @click={$filter = 'all'}>⟪journal.all⟫</button>
      <button :class{$filter == 'server'}="active" @click={$filter = 'server'}>⟪journal.server⟫</button>
      <button :class{$filter == 'client'}="active" @click={$filter = 'client'}>⟪journal.client⟫</button>
    </div>
    <div class="actions">
      <button @click={refresh()}>⟪journal.refresh⟫</button>
      <button class="danger" @click={doPurge('server')}>⟪journal.purge-server⟫</button>
      <button class="danger" @click={doPurge('client')}>⟪journal.purge-client⟫</button>
      <button class="danger" @click={doPurge(null)}>⟪journal.purge-all⟫</button>
    </div>
  </div>

  {if $failed}
    <p class="empty failed">⟪journal.failed⟫</p>
  {elsif filtered($entries, $filter).length == 0}
    <p class="empty">⟪journal.empty⟫</p>
  {else}
    <div class="list">
      {for ent in filtered($entries, $filter) by signature}
        <div class="entry" role="button" tabindex="0" @click={toggle(ent.signature)} @keydown={toggleKey(e, ent.signature)}>
          <div class="row">
            <span class="badge badge-{ent.source}">{ent.source}</span>
            <span class="counter">×{ent.n}</span>
            <span class="message">{ent.message}</span>
            {if ent.version}<span class="version">{ent.version}</span>{end}
          </div>
          <div class="dates">⟪journal.first⟫ {formatDate(ent.first)} — ⟪journal.last⟫ {formatDate(ent.last)}{if ent.url} — {ent.url}{end}</div>
          {if $expanded[ent.signature]}
            <pre class="stack">{ent.stack}</pre>
          {end}
        </div>
      {end}
    </div>
  {end}
</div>

<style>
  .panel
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
  .filters
    display: flex
    gap: 0.4rem
  .actions
    display: flex
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
  button.danger
    color: #ff8a8a
    &:hover
      background: #3a1f24
  .empty
    color: #8a8f9c
  .empty.failed
    color: #ff8a8a
  .list
    display: flex
    flex-direction: column
    gap: 0.4rem
  .entry
    background: #1b1f29
    border: 1px solid #2a2f3c
    border-radius: 8px
    padding: 0.6rem 0.8rem
    cursor: pointer
    &:hover
      border-color: #3a6df0
  .row
    display: flex
    align-items: baseline
    gap: 0.6rem
  .badge
    font-size: 0.7rem
    text-transform: uppercase
    letter-spacing: 0.04em
    padding: 0.1rem 0.45rem
    border-radius: 4px
    background: #363c4c
  .badge-server
    background: #5a3a8a
  .badge-client
    background: #2a6f5f
  .counter
    color: #8a8f9c
    font-variant-numeric: tabular-nums
  .message
    flex: 1
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
  .version
    color: #6b7280
    font-size: 0.75rem
  .dates
    margin-top: 0.25rem
    color: #6b7280
    font-size: 0.75rem
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
  .stack
    margin-top: 0.5rem
    padding: 0.5rem
    background: #0d0f14
    border-radius: 6px
    overflow-x: auto
    font: 12px/1.4 ui-monospace, monospace
    white-space: pre-wrap
    word-break: break-all
</style>
