<script>
  $items    = []
  $size     = 40
  $overscan = 3
  $key      = null
  $start    = 0
  $end      = 0
  $before   = 0
  $total    = 0

  slotRef = null
  vp      = null
  rows    = []
  # place de chaque ligne dessinée dans la liste, hauteur mesurée par clé de ligne (une insertion ou un tri ne la perd pas, une clé retirée
  # de la liste l'oublie), place pour laquelle un nœud a été mesuré (`{for}` réemploie ses nœuds détachés : un nœud mesuré pour une autre
  # ligne ne compte pas)
  at      = new WeakMap()
  sizes   = new Map()
  seen    = new WeakMap()
  # la liste, la clé et la hauteur de chaque élément (relues une fois par changement de liste), les débuts cumulés
  shown   = []
  keys    = []
  hs      = new Float64Array(0)
  off     = new Float64Array(1)
  ro      = null
  watched = new Set()
  # la place de la ligne qui a le focus ou l'aura, le nœud qui le tient, le focus rangé sur la liste quand sa ligne sort de la fenêtre
  focusAt = -1
  holder  = null
  inside  = false
  parked  = false
  grid    = false
  wanted  = null
  live    = false
  tick    = 0

  num   = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d
  est   = -> Math.max(1, num($size, 40))
  count = -> shown.length
  keyOf = (it)-> if $key? and it? and typeof it is 'object' then it[$key] else it

  # la première ligne dont le bas dépasse `y`, par dichotomie sur les débuts cumulés
  indexAt = (y)->
    n = count()
    return 0 unless n
    lo = 0
    hi = n - 1
    while lo < hi
      mid = (lo + hi + 1) >> 1
      if off[mid] <= y then lo = mid else hi = mid - 1
    lo

  # débuts cumulés à partir de la ligne `low`
  sum = (low)->
    n = count()
    i = low
    while i < n
      off[i + 1] = off[i] + hs[i]
      i++

  # la hauteur à défiler ne dépend pas des lignes dessinées : quand la fenêtre saute, `{for}` retire les anciennes lignes avant de poser
  # les neuves, et une hauteur qui fondrait entre les deux ramènerait le défilement plus haut
  pad = ->
    n = count()
    $before = off[Math.min(µread($start), n)]
    $total  = off[n]

  rowOf = (t)=>
    t = t.parentNode while t? and t.parentNode isnt @
    if t? and at.has(t) then t else null

  # la ligne focalisée va sortir de la fenêtre : le focus passe sur la zone qui défile (jamais sur la page), et revient sur la ligne quand
  # elle reparaît ; cette zone porte `tabindex="-1"` dans l'ombre : jamais un arrêt de tabulation (Firefox en ferait un), ses lignes le restent
  park = =>
    parked = true
    vp.focus({ preventScroll: true })

  update = =>
    return unless slotRef and live and vp
    vh = vp.clientHeight
    return unless vh
    n = count()
    ov = Math.max(0, Math.floor(num($overscan, 3)))
    y = vp.scrollTop
    s = Math.max(0, indexAt(y) - ov)
    e = Math.min(n, indexAt(y + vh - 1) + 1 + ov)
    park() if inside and not parked and holder?.parentNode is @ and at.has(holder) and (at.get(holder) < s or at.get(holder) >= e)
    # la page redessine entre deux écritures : en remontant, `end` d'abord, sinon `start` d'abord ; la fenêtre intermédiaire est toujours
    # comprise dans l'ancienne ou la nouvelle (jamais `slice(0, 100000)` après un saut du bas vers le haut)
    if s < µread($start)
      $end   = e if e isnt µread($end)
      $start = s
    else
      $start = s if s isnt µread($start)
      $end   = e if e isnt µread($end)
    pad()

  # rôle, place et arrêt de tabulation de chaque ligne dessinée
  label = =>
    n = count()
    first = if vp then indexAt(vp.scrollTop + 1) else 0
    stop = if focusAt >= 0 and rows.some((r)-> at.get(r) is focusAt) then focusAt else first
    stop = at.get(rows[0]) if rows.length and not rows.some((r)-> at.get(r) is stop)
    @setAttribute('aria-rowcount', String(n)) if grid
    for el in rows
      i = at.get(el)
      if grid
        el.setAttribute('aria-rowindex', String(i + 1))
      else
        el.setAttribute('role', 'listitem') unless el.hasAttribute('role')
        el.setAttribute('aria-setsize', String(n))
        el.setAttribute('aria-posinset', String(i + 1))
      el.tabIndex = if i is stop then 0 else -1

  refresh = =>
    return unless slotRef
    rows = slotRef.assignedElements()
    base = Math.min(µread($start), count())
    # la page pose une fenêtre neuve en deux temps (`start` puis `end`, ou l'inverse) : entre les deux, ses lignes ne sont pas celles de la
    # fenêtre, leurs places attendent la pose suivante
    return if rows.length isnt Math.min(µread($end), count()) - base
    # à mesurer : les lignes neuves et celles posées à une autre place (une liste sans clé recycle ses éléments) ; une ligne restée à sa
    # place ne se réobserve pas, sa taille changée se dit d'elle-même ; une ligne sortie de la fenêtre n'est plus suivie
    shifted = new Set(rows.filter((el, k)-> at.get(el) isnt base + k))
    at.set(el, base + k) for el, k in rows
    label()
    if ro
      kept = new Set(rows)
      watched.forEach((el)-> ro.unobserve(el) unless kept.has(el))
      ro.observe(el) for el in rows.filter((el)-> shifted.has(el) or not watched.has(el))
      watched = kept
    if parked and vp?.matches(':focus')
      el = rows.find((r)-> at.get(r) is focusAt)
      if el
        parked = false
        el.focus({ preventScroll: true })
    requestAnimationFrame(settle) if wanted

  # la hauteur réelle d'une ligne (marges comprises) remplace l'estimation ; les lignes qui changent de hauteur au-dessus de la première
  # ligne visible déjà mesurée (celle que l'on regardait) décalent le défilement d'autant : elle ne bouge pas à l'écran ; une vue qui
  # touchait le bas de la liste (barre tirée au bout) y reste, la dernière ligne entière
  measure = (entries)=>
    low = Infinity
    moved = new Set()
    for ent in entries
      el = ent.target
      continue unless at.has(el) and el.parentNode is @
      i = at.get(el)
      seen.set(el, i)
      continue if i >= count()
      cs = getComputedStyle(el)
      h = (ent.borderBoxSize?[0]?.blockSize ?? el.offsetHeight) + (parseFloat(cs.marginTop) or 0) + (parseFloat(cs.marginBottom) or 0)
      continue if Math.abs(hs[i] - h) < .01 and sizes.has(keys[i])
      sizes.set(keys[i], h)
      hs[i] = h
      moved.add(i)
      low = Math.min(low, i)
    if low < Infinity
      y    = vp.scrollTop
      n    = count()
      tail = y > 0 and y + vp.clientHeight >= off[n] - 1
      a    = indexAt(y)
      for el in rows
        i = at.get(el)
        if off[i + 1] > y and not moved.has(i)
          a = i
          break
      was = off[a]
      sum(low)
      pad()
      if not wanted and y > 0
        if tail then vp.scrollTop = off[n] - vp.clientHeight else if off[a] isnt was then vp.scrollTop = y + off[a] - was
    later()

  # la fenêtre et l'alignement suivent à l'image d'après : des lignes posées pendant la livraison des mesures n'y seraient pas mesurées
  later = =>
    tick ||= requestAnimationFrame =>
      tick = 0
      update()
      settle()

  # alignement demandé par `scrollToIndex`, refait tant que les lignes mesurées entre-temps déplacent la ligne visée
  target = =>
    { i, align } = wanted
    top = off[i]
    h = off[i + 1] - top
    vh = vp.clientHeight
    y = vp.scrollTop
    y = if align is 'start' then top else if align is 'center' then top - (vh - h) / 2 else if align is 'end' then top + h - vh else if top < y then top else if top + h > y + vh then top + h - vh else y
    Math.max(0, Math.min(y, off[count()] - vh))

  place = =>
    y = target()
    vp.scrollTop = y if Math.abs(vp.scrollTop - y) > .5
    wanted.y = vp.scrollTop
    update()

  # la promesse du saut est tenue (la ligne, ou `null`) et le défilement de nouveau corrigé
  done = (el)=>
    w      = wanted
    wanted = null
    vp?.removeEventListener(t, halt) for t in gestures
    w?.resolve(el)

  # le défilement n'est plus là où le saut l'a posé : un geste de l'utilisateur (molette, toucher, barre, touches) ou la page ; une liste
  # qui raccourcit ramène le défilement à son bout, ce n'en est pas un ; Chromium et WebKit rangent les positions en flottant de 32 bits,
  # au pas de y / 2^23 au plus (2 px à 30 M px) : ce pas, couvert par y / 8e6, s'ajoute au pixel toléré sans jamais passer pour un geste
  away = -> Math.abs(vp.scrollTop - Math.min(wanted.y, vp.scrollHeight - vp.clientHeight)) > 1 + vp.scrollTop / 8e6

  # liste cachée, le saut attend qu'elle paraisse ; un défilement qu'il n'a pas fait l'interrompt avant toute correction : `null`, la liste
  # reste où ce défilement l'a menée ; ligne visée pas encore dessinée, il est refait ; dix essais au plus, puis la ligne là où elle est
  settle = =>
    return unless wanted and vp.clientHeight
    return done(null) if away()
    el = rows.find((r)-> at.get(r) is wanted.i)
    if el
      return unless seen.get(el) is wanted.i
      return done(el) if Math.abs(vp.scrollTop - target()) <= 1 or wanted.tries >= 10
    else
      return done(null) if wanted.tries >= 10
    wanted.tries++
    place()
    requestAnimationFrame(settle)

  @scrollToIndex = (i, align = 'auto')=>
    n = count()
    return Promise.resolve(null) unless n and slotRef and vp
    i = Math.max(0, Math.min(n - 1, Math.floor(num(i, 0))))
    done(null)
    new Promise (resolve)=>
      wanted = { i, align, resolve, tries: 0, y: 0 }
      vp.addEventListener(t, halt) for t in gestures
      place()
      settle()

  # la liste change : la ligne du haut garde sa place à l'écran si elle y est encore (une insertion, un retrait, un tri au-dessus d'elle ne la
  # déplacent pas) ; tout en haut, la liste reste en haut
  reset = (list)=>
    # un défilement que le saut n'a pas fait l'arrête avant que la liste qui change recale le défilement
    done(null) if wanted and vp?.clientHeight and away()
    old = shown
    y = if vp then vp.scrollTop else 0
    a = if old.length and y > 0 then indexAt(y) else -1
    k = keys[a] if a >= 0
    d = y - off[a] if a >= 0
    shown = if Array.isArray(list) then list else []
    n = shown.length
    e = est()
    keys = new Array(n)
    hs = new Float64Array(n)
    off = new Float64Array(n + 1)
    mem = new Map()
    i   = 0
    while i < n
      keys[i] = keyOf(shown[i])
      h       = sizes.get(keys[i])
      mem.set(keys[i], h) if h?
      hs[i] = h ?? e
      i++
    sizes = mem
    sum(0)
    pad()
    # un saut demandé plus loin que la liste qui rétrécit finit sur son dernier élément ; liste vide : `null`
    if wanted and wanted.i >= n
      if n then wanted.i = n - 1 else done(null)
    return unless slotRef and vp
    if a >= 0
      j = keys.indexOf(k)
      # écrit seulement si la ligne du haut a bougé : sous WebKit, une écriture à sa propre valeur arrête un défilement animé en cours (touche Fin)
      vp.scrollTop = off[j] + d if j >= 0 and Math.abs(vp.scrollTop - off[j] - d) > .5
    if wanted then place() else update()
    label()

  onScroll = =>
    done(null) if wanted and vp.clientHeight and away()
    update()

  # pendant le saut, un geste de l'utilisateur l'arrête dès son début : écouté sans `passive`, il passe par la page avant que le navigateur
  # fasse défiler hors d'elle, où une correction du saut posée entre-temps annulerait son défilement
  halt     = -> done(null)
  gestures = ['wheel', 'touchmove', 'pointerdown', 'keydown']

  onFocusIn = (e)=>
    inside = true
    el = rowOf(e.target)
    return unless el
    parked = false
    holder = el
    focusAt = at.get(el)
    label()

  onFocusOut = (e)=>
    return if e.relatedTarget? and @contains(e.relatedTarget)
    inside = false
    parked = false

  onKey = (e)=>
    return if e.altKey or e.ctrlKey or e.metaKey or e.defaultPrevented
    t = e.target
    i = if t is @ and parked then focusAt else if t.parentNode is @ and at.has(t) then at.get(t) else -1
    n = count()
    return if i < 0 or not n
    # Page suivante, Page précédente : le focus passe à la première ligne qui commence une hauteur de liste plus bas (plus haut) ; la liste
    # défile de sa hauteur, puis de ce qu'il faut pour montrer cette ligne entière
    d = if e.key is 'PageDown' then vp.clientHeight else if e.key is 'PageUp' then -vp.clientHeight else 0
    y = off[i] + d
    k = indexAt(y)
    k++ if off[k] < y
    j = if e.key is 'ArrowDown' then i + 1 else if e.key is 'ArrowUp' then i - 1 else if e.key is 'Home' then 0 else if e.key is 'End' then n - 1 else if d > 0 then Math.max(i + 1, k) else if d < 0 then Math.min(i - 1, k) else null
    return unless j?
    e.preventDefault()
    vp.scrollTop += d if d
    focusAt = Math.max(0, Math.min(n - 1, j))
    @scrollToIndex(focusAt).then (el)-> el?.focus({ preventScroll: true }) if el and at.get(el) is focusAt

  watch = (box)=>
    vp = box
    slot = box.querySelector('slot')
    slot.addEventListener('slotchange', refresh)
    box.addEventListener('scroll', onScroll, { passive: true })
    @addEventListener('focusin', onFocusIn)
    @addEventListener('focusout', onFocusOut)
    @addEventListener('keydown', onKey)
    ro = new ResizeObserver(measure) if typeof ResizeObserver is 'function'
    host = null
    host = new ResizeObserver(-> if wanted then place() else update()) if typeof ResizeObserver is 'function'
    host?.observe(box)
    =>
      slot.removeEventListener('slotchange', refresh)
      box.removeEventListener('scroll', onScroll)
      @removeEventListener('focusin', onFocusIn)
      @removeEventListener('focusout', onFocusOut)
      @removeEventListener('keydown', onKey)
      ro?.disconnect()
      host?.disconnect()
      ro      = null
      watched = new Set()
      done(null)

  # la fenêtre (`start`, `end`) se lit partout par `µread` : écrite à chaque pas de défilement, elle ne doit pas rejouer ce reffet, qui
  # refait les tables de la liste entière (une clé, une hauteur et un début par élément)
  µeffect ->
    list = $items
    $size
    $key
    reset(list)

  # la fenêtre ne s'écrit qu'une image après le montage : une page rendue par le serveur a repris ses lignes, que `{for}` garde alors
  µmount =>
    role = @getAttribute('role')
    grid = role is 'grid' or role is 'table' or role is 'treegrid'
    @setAttribute('role', 'list') unless role
    refresh()
    requestAnimationFrame =>
      live = true
      reset(shown)
</script>

<div class="viewport" part="viewport" tabindex="-1" :attach={watch}>
  <div class="sizer" --mjs-virtual-total={$total + 'px'}>
    <div class="rows" part="rows" --mjs-virtual-before={$before + 'px'}>
      <slot :this=!{slotRef}></slot>
    </div>
  </div>
</div>

<style :display="block">
  :host
    max-height: 100vh

  .viewport
    height: 100%
    max-height: inherit
    overflow: auto
    overflow-anchor: none

  .sizer
    position: relative
    height: var(--mjs-virtual-total)

  .rows
    position: absolute
    top: var(--mjs-virtual-before)
    left: 0
    right: 0
    display: flex
    flex-direction: column
</style>
