<script module>
  # les repères `@@` (script `# @@`, gabarit `<!-- @@ -->`, style `// @@`) cernent ce qui ne sert qu'aux groupes (attribut `group`) : le build de production les ôte quand aucune liste de l'appli ne l'écrit, le développement et la copie dans un projet gardent tout (les repères y sont des commentaires), ils ne partent jamais dans le code envoyé
  # `group` : le morceau propre aux groupes ; `!group` : l'autre forme des lignes qui existent avec et sans `group`, écrite en commentaire et remise en code quand `group` part ; `dev group` : l'avertissement du développement, gardé tant qu'aucune page n'écrit `group`
  # `transition` : le morceau propre au fondu des lignes (une ligne que la page fait sortir avec une transition, que `*crossfade` fait voler), ôté en production quand aucune page de l'application n'écrit de transition (`@in`, `@out`, `@transition`) ; `!transition` et `dev transition` sur le même modèle
  # @@ group
  # les listes vivantes, tous groupes confondus : chacune s'y inscrit à son réveil et s'en retire à son sommeil
  sortableLists = new Set()
  # @@
  # @@ dev group
  told    = false
  # le texte de l'avertissement : développement seulement, tant qu'aucune page n'écrit `group`
  warning = { fr: '<@@sortable> : une liste reçoit « group » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — en production, les groupes (l\'échange de lignes entre listes) ne seraient pas envoyés. Écrivez « group » sur la liste dans votre page plutôt que de le poser par un script.', en: '<@@sortable>: a list gets "group" from a script, but no page of the application writes that attribute — in production the groups (rows moving between lists) would not be shipped. Write "group" on the list in your page instead of setting it from a script.' }
  # @@
  # @@ dev transition
  toldFade    = false
  # le texte de l'avertissement : développement seulement, tant qu'aucune page n'écrit de transition
  warningFade = { fr: '<@@sortable> : une ligne quitte sa liste avec une transition, mais aucune page de l\'application n\'écrit de transition — en production, le fondu des lignes qui changent de liste ne serait pas envoyé. Écrivez la transition (@in, @out ou @transition) sur la ligne dans votre page plutôt que de la poser par un script.', en: '<@@sortable>: a row leaves its list with a transition, but no page of the application writes a transition — in production the cross-fade of rows changing list would not be shipped. Write the transition (@in, @out or @transition) on the row in your page instead of setting it from a script.' }
  # @@
</script>

<script>
  $announce = ''

  # seuils fixes : un clic reste un clic, un balayage au doigt reste un défilement
  MOUSE_MOVE = 5
  TOUCH_HOLD = 250
  TOUCH_SLOP = 10
  EDGE       = 64
  STEP       = 14
  DROP_EDGE  = 24
  CLICK_WAIT = 350
  GLIDE      = 150
  SAY_WAIT   = 100

  # ce qui garde son clic dans une ligne : boutons, liens, champs et leurs équivalents ARIA
  IGNORE = 'a[href], button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="spinbutton"], [role="textbox"]'

  # annonces du clavier : le dictionnaire du projet (mjs.core.<clé>) passe avant ces textes, qui vivent ici
  # pour qu'une appli sans ce module n'en porte aucun octet (le groupe core de la table part chez toute appli qui lit la langue)
  TEXTS = {
    fr: {
      sortableGrab:      'Ligne saisie, place {n} sur {total}. Flèches haut et bas pour la déplacer, Espace pour la poser, Échap pour annuler'
      sortableGrabGroup: 'Ligne saisie, place {n} sur {total}. Flèches haut et bas pour la déplacer, droite et gauche pour changer de groupe, Espace pour la poser, Échap pour annuler' # @@ group
      sortableMove:      'Déplacée en place {n} sur {total}'
      sortableHop:       'Déplacée dans {list}, place {n} sur {total}' # @@ group
      sortableEnter:     'Entrée dans {list}, place {n} sur {total}' # @@ group
      sortableLeave:     'Sortie vers {list}, place {n} sur {total}' # @@ group
      sortableNamed:     'la liste « {name} »' # @@ group
      sortableUnnamed:   'la liste {n} sur {total}' # @@ group
      sortableDrop:      'Ligne posée en place {n} sur {total}'
      sortableCancel:    'Déplacement annulé, ligne remise en place {n}'
      sortableRole:      'ligne déplaçable'
      sortableHint:      'Espace pour saisir la ligne et la déplacer'
    }
    en: {
      sortableGrab:      'Row grabbed, position {n} of {total}. Up and down arrows move it, Space drops it, Escape cancels'
      sortableGrabGroup: 'Row grabbed, position {n} of {total}. Up and down arrows move it, left and right arrows change group, Space drops it, Escape cancels' # @@ group
      sortableMove:      'Moved to position {n} of {total}'
      sortableHop:       'Moved to {list}, position {n} of {total}' # @@ group
      sortableEnter:     'Entered {list}, position {n} of {total}' # @@ group
      sortableLeave:     'Moved out to {list}, position {n} of {total}' # @@ group
      sortableNamed:     'the list “{name}”' # @@ group
      sortableUnnamed:   'list {n} of {total}' # @@ group
      sortableDrop:      'Row dropped at position {n} of {total}'
      sortableCancel:    'Move cancelled, row back at position {n}'
      sortableRole:      'movable row'
      sortableHint:      'Press Space to grab the row and move it'
    }
  }

  slotRef  = null
  hostRef  = null
  rows     = []
  deco     = new Map()
  swallow  = null
  sayTimer = null
  me       = null
  roving   = null
  watch    = null

  # le geste en cours, null au repos : { mode: 'pointer' | 'key', row, started, src, cands, geo, start, n, dest, shown, … }
  g = null

  textOf = (key)->
    table = TEXTS[µ._mjs_labelLang()] ?? TEXTS[µ._runtimeLabelsLang] ?? TEXTS.en
    String(µ._mjs_label('core', key) ?? table[key])

  # chaque pas est annoncé : un texte identique à celui d'avant ne change rien dans la région et rien ne serait relu, elle est donc vidée puis remplie un instant après
  say = (key, n, total, list)->
    text = textOf(key).replace('{n}', n).replace('{total}', total).replace('{list}', -> list) # @@ group
    # text = textOf(key).replace('{n}', n).replace('{total}', total) # @@ !group
    clearTimeout(sayTimer)
    if text is $announce
      $announce = ''
      sayTimer  = setTimeout((-> $announce = text), SAY_WAIT)
    else
      $announce = text
    return

  matches = (el, selector)->
    try
      el.nodeType is 1 and el.matches(selector)
    catch
      false

  handleSel = -> if typeof $handle is 'string' and $handle.trim() then $handle.trim() else null

  # les lignes sont les enfants directs ; rôle, tabulation, description du rôle et consigne (pour les lecteurs d'écran) ne sont posés que là où
  # l'auteur n'en a pas mis, et retirés ensuite
  ROW_ATTRS = ['role', 'tabindex', 'aria-roledescription', 'aria-description']

  # les textes posés sur les lignes, dans la langue de la page (lire µlang rend le dérivé réactif à la bascule)
  rowTextsOf = (lang)-> { role: textOf('sortableRole'), hint: textOf('sortableHint') }
  $rowTexts  = rowTextsOf(µlang)

  undeco = (el, rec)->
    for a in rec
      el.removeAttribute(a)
    return

  retext = (el, rec)->
    el.setAttribute('aria-roledescription', $rowTexts.role) if rec.includes('aria-roledescription')
    el.setAttribute('aria-description', $rowTexts.hint) if rec.includes('aria-description')
    return

  # une ligne cachée (hidden, display: none, visibility: hidden, inert) ne prend pas le focus ; cachée avec toute la liste (visibility
  # héritée d'un parent), elle garde l'arrêt pour le moment où la liste reparaît
  shown = (el)->
    css = getComputedStyle(el)
    css.display isnt 'none' and not el.inert and (css.visibility is 'visible' or getComputedStyle(hostRef).visibility isnt 'visible')

  # une ligne peut porter l'arrêt de tabulation si elle se voit et que son tabindex est le nôtre, ou celui, positif ou nul, de l'auteur
  canStop = (el)-> shown(el) and (deco.get(el)?.includes('tabindex') or el.tabIndex >= 0)

  # une seule ligne dans l'ordre de tabulation, la dernière qui a eu le focus si elle peut encore le porter, sinon la première qui le peut
  # (aucune, aucun arrêt) : Tab traverse la liste d'un coup, les flèches vont de ligne en ligne ; une ligne dont l'auteur a écrit le
  # tabindex garde le sien
  rove = ->
    roving = rows.find(canStop) unless rows.includes(roving) and canStop(roving)
    deco.forEach (rec, el)->
      tab = if el is roving then '0' else '-1'
      el.setAttribute('tabindex', tab) if rec.includes('tabindex') and el.getAttribute('tabindex') isnt tab
    return

  # une ligne que la page cache ou montre après coup (un filtre qui pose hidden, une classe, un style, inert) : l'arrêt est recalculé ;
  # pas pendant un geste, qui anime le style des lignes et recalcule tout à sa fin
  onRowAttr = (records)->
    rove() if not g and records.some((r)-> deco.has(r.target))
    return

  refresh = ->
    return unless slotRef
    rows = listRows()
    for el in rows
      continue if deco.has(el)
      rec = ROW_ATTRS.filter((a)-> not el.hasAttribute(a))
      deco.set(el, rec)
      el.setAttribute('role', 'listitem') if rec.includes('role')
      retext(el, rec)
    deco.forEach (rec, el)->
      return if rows.includes(el)
      undeco(el, rec)
      deco.delete(el)
    rove()
    remeasure() if g?.started
    return

  # ce que les autres listes du groupe voient de celle-ci ; une ligne que la page fait sortir avec une transition reste dans le DOM le temps de sa sortie : elle n'est plus une ligne de la liste
  groupName = -> $group # @@ group
  listRows  = -> (slotRef?.assignedElements() ?? []).filter((el)-> not el._mjs_dying)
  listSlot  = -> slotRef
  # @@ group
  listValue = -> $value
  setValue  = (list)-> $value = list
  emitSort  = (data)-> µemit 'sort', data
  # @@

  # @@ group
  # le parent d'un nœud dans l'arbre composé : une racine fantôme passe à son hôte
  up = (el)->
    p = el.parentNode
    if p and p.nodeType is 11 then p.host else p

  inside = (el, box)->
    while el
      return true if el is box
      el = up(el)
    false

  # les listes vivantes du groupe, et combien d'entre elles portent la liste q
  members = (name)-> Array.from(sortableLists).filter((q)-> q.group() is name and q.host.isConnected)
  depthOf = (q, all)-> all.filter((o)-> o isnt q and inside(q.host, o.host)).length

  # où la ligne tenue peut se poser : sa liste et les autres du groupe, jamais dans elle-même ; une ligne qui porte des listes du groupe reste à son étage ou monte
  targetsFor = (row)->
    return [me] unless $group
    all   = members($group)
    carry = all.some((q)-> inside(q.host, row))
    floor = depthOf(me, all)
    all.filter((q)-> not inside(q.host, row) and (not carry or depthOf(q, all) <= floor))
  # @@
  # @@ !group
  # depthOf    = -> 0
  # targetsFor = -> [me]
  # @@

  pageOf = (sc)-> sc is document.scrollingElement or sc is document.documentElement or sc is document.body

  # la zone qui défile : le plus proche ancêtre à barre verticale, sinon la page
  scrollerOf = (host)->
    el = host.parentElement ?? host.getRootNode().host
    while el and el isnt document.body and el isnt document.documentElement
      oy = getComputedStyle(el).overflowY
      return el if (oy is 'auto' or oy is 'scroll') and el.scrollHeight > el.clientHeight
      el = el.parentElement ?? el.getRootNode().host
    document.scrollingElement ?? document.documentElement

  viewOf = (sc)-> if pageOf(sc) then { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight } else sc.getBoundingClientRect()

  # le haut de la zone qui défile, moins son défilement : de quoi passer d'un repère de contenu à l'écran
  frameOf = (sc)->
    base = if pageOf(sc) then 0 else sc.getBoundingClientRect().top
    base - sc.scrollTop

  # le décalage vertical qu'une ligne porte à cet instant, transition ou glissement en cours compris
  shiftOf = (el)->
    t = getComputedStyle(el).translate
    if t and t isnt 'none' then parseFloat(t.split(' ')[1]) or 0 else 0

  # @@ group
  # celui d'un nœud et de ses ancêtres que le geste a marqués : une liste dans une ligne écartée suit sa ligne
  lift = (el)->
    sum = 0
    while el
      sum += shiftOf(el) if g.shown.has(el)
      el = up(el)
    sum
  # @@
  # @@ !group
  # lift = (el)-> if g.shown.has(el) then shiftOf(el) else 0
  # @@

  # les places des lignes de la liste q dans le repère du contenu de sa zone qui défile : ni le défilement ni les décalages portés n'y comptent
  measure = (q)->
    sc   = scrollerOf(q.host)
    s0   = sc.scrollTop
    base = if pageOf(sc) then 0 else sc.getBoundingClientRect().top
    box  = q.host.getBoundingClientRect()
    own  = lift(q.host)
    geo  = { q: q, sc: sc, rows: q.rows(), seen: q.host.getClientRects().length > 0, tops: [], heights: [], gaps: [] }
    for el in geo.rows
      r = el.getBoundingClientRect()
      geo.tops.push(r.top - base + s0 - lift(el))
      geo.heights.push(r.height)
    for top, j in geo.tops
      geo.gaps.push(if j < geo.tops.length - 1 then geo.tops[j + 1] - top - geo.heights[j] else 0)
    geo.box = { left: box.left, right: box.right, top: box.top - base + s0 - own, bottom: box.bottom - base + s0 - own }
    g.first.set(sc, s0) unless g.first.has(sc)
    g.geo.set(q, geo)
    geo

  # les listes où la ligne peut se poser sont mesurées, rien ne s'est encore décalé
  ready = (cands)->
    g.cands = cands
    g.free  = cands.length > 1 # @@ group
    g.deep  = new Map()
    g.deep.set(q, depthOf(q, cands)) for q in cands
    g.geo.clear()
    measure(q) for q in cands
    return

  limitOf = (q)-> if q is g.src then g.n - 1 else g.geo.get(q).rows.length
  totalOf = (q)-> if q is g.src then g.n else g.geo.get(q).rows.length + 1

  # les lignes d'une liste empilées dans l'ordre `order` (un indice, ou -1 pour la ligne tenue, de hauteur `held`) : le décalage de chaque ligne et le haut de la place de la ligne tenue
  stack = (geo, order, gaps, held)->
    dys = new Array(geo.rows.length).fill(0)
    y   = geo.tops[0] ?? geo.box.top
    at  = null
    for j, k in order
      if j < 0
        at = y
        y += held + gaps[k]
      else
        dys[j] = y - geo.tops[j]
        y     += geo.heights[j] + gaps[k]
    { dys: dys, at: at }

  # @@ group
  # les écarts d'une liste portée à `len` places : les siens, puis le dernier connu
  gapsFor = (geo, len, spare)->
    n    = geo.rows.length
    last = if n > 1 then geo.gaps[n - 2] else spare
    Array.from({ length: len }, (_, k)-> if k < n - 1 then geo.gaps[k] else last)
  # @@

  # ce que montre une arrivée en (q, at) : le décalage de chaque autre ligne, et où va la ligne tenue (au clavier) ; les lignes gardent leurs écarts
  arrange = (dest)->
    S     = g.geo.get(g.src)
    out   = new Map()
    order = Array.from({ length: S.rows.length }, (_, i)-> i)
    order.splice(g.start, 1)
    order.splice(dest.at, 0, g.start) if dest.q is g.src
    res = stack(S, order, S.gaps, 0)
    S.rows.forEach (el, j)->
      out.set(el, res.dys[j]) unless j is g.start
    return { out: out, dx: 0, dy: res.dys[g.start] } if dest.q is g.src
    # @@ group
    T    = g.geo.get(dest.q)
    plan = Array.from({ length: T.rows.length }, (_, i)-> i)
    plan.splice(dest.at, 0, -1)
    low  = stack(T, plan, gapsFor(T, T.rows.length + 1, S.gaps[0] ?? 0), S.heights[g.start])
    T.rows.forEach (el, j)->
      out.set(el, low.dys[j])
    { out: out, dx: T.box.left - S.box.left, dy: low.at + frameOf(T.sc) - (S.tops[g.start] + frameOf(S.sc)) }
    # @@

  put = (el, dy, state, dx)->
    el.setAttribute('mjs-sortable', state) unless el.getAttribute('mjs-sortable') is state
    unless g.shown.get(el) is dy
      el.style.setProperty('--mjs-sortable-dy', dy + 'px')
      g.shown.set(el, dy)
    # @@ group
    if dx isnt undefined and g.heldDx isnt dx
      el.style.setProperty('--mjs-sortable-dx', dx + 'px')
      g.heldDx = dx
    # @@
    return

  # les lignes s'écartent selon g.dest ; la ligne tenue suit le pointeur, ou (au clavier) va à sa place d'arrivée
  show = ->
    d = g.dest
    if d?.q isnt g.seen?.q or d?.at isnt g.seen?.at
      g.seen = d
      g.view = if d then arrange(d) else null
      if g.view
        g.view.out.forEach (dy, el)->
          put(el, dy, 'shift') if dy isnt 0 or g.shown.has(el)
      g.shown.forEach (dy, el)->
        put(el, 0, 'shift') unless el is g.row or g.view?.out.has(el)
    if g.mode is 'pointer'
      geo = g.geo.get(g.src)
      dy  = g.y - g.offY - (geo.tops[g.start] + geo.heights[g.start] / 2 + frameOf(geo.sc))
      put(g.row, dy, 'held', (if g.free then g.x - g.x0 else undefined)) # @@ group
      # put(g.row, dy, 'held') # @@ !group
    else
      put(g.row, g.view.dy, 'held', (if g.free then g.view.dx else undefined)) # @@ group
      # put(g.row, g.view.dy, 'held') # @@ !group
    return

  # où la ligne tenue se poserait d'après le pointeur : la liste la plus proche (la plus profonde si le pointeur est dedans), à la place que dit le milieu de la ligne ; nulle part hors de toute liste
  aim = ->
    best = null
    rank = 0
    for q in g.cands
      geo = g.geo.get(q)
      continue unless geo?.seen
      k      = frameOf(geo.sc)
      view   = viewOf(geo.sc)
      pad    = if geo.rows.length then 0 else DROP_EDGE
      left   = Math.max(geo.box.left, view.left)
      right  = Math.min(geo.box.right, view.right)
      top    = Math.max(geo.box.top + k, view.top) - pad
      bottom = Math.min(geo.box.bottom + k, view.bottom) + pad
      dx     = Math.max(left - g.x, 0, g.x - right)
      dy     = Math.max(top - g.y, 0, g.y - bottom)
      continue if dx > DROP_EDGE or dy > DROP_EDGE
      score  = if dx + dy is 0 then -1000 - g.deep.get(q) else dx + dy
      continue if best and score >= rank
      best = q
      rank = score
    unless best
      g.dest = null
      return
    geo = g.geo.get(best)
    k   = frameOf(geo.sc)
    cy  = g.y - g.offY
    at  = 0
    for h, j in geo.heights
      continue if best is g.src and j is g.start
      at++ if geo.tops[j] + h / 2 + k < cy
    g.dest = { q: best, at: at }
    return

  update = ->
    return unless g?.started and g.mode is 'pointer'
    aim()
    show()
    return

  # jamais plus bas que le bas des listes : la ligne tenue, décalée, agrandirait sinon la zone qui défile, sans fin
  clamp = (sc)->
    view = viewOf(sc)
    low  = 0
    g.geo.forEach (geo)->
      low = Math.max(low, geo.box.bottom) if geo.sc is sc
    base = if pageOf(sc) then 0 else view.top
    last = Math.max(g.first.get(sc) ?? 0, low + base - view.bottom)
    sc.scrollTop = last if sc.scrollTop > last
    return

  # la page défile seule quand le pointeur touche un bord de la zone de la liste qu'il survole (de la liste de départ, hors de toute liste)
  tick = ->
    return unless g?.started and g.mode is 'pointer'
    sc   = g.geo.get(g.dest?.q ?? g.src).sc
    view = viewOf(sc)
    was  = sc.scrollTop
    sc.scrollTop -= STEP if g.y < view.top + EDGE
    sc.scrollTop += STEP if g.y > view.bottom - EDGE
    clamp(sc)
    update() if sc.scrollTop isnt was
    g.frame = requestAnimationFrame(tick)
    return

  # une ligne qui change de hauteur, ou la liste qui change en plein geste : les places sont relues, la ligne tenue reste sous le pointeur
  remeasure = ->
    return unless g?.started
    list  = me.rows()
    cands = targetsFor(g.row)
    unless list.includes(g.row) and (list.length > 1 or cands.length > 1)
      end(false)
      return
    was     = g.start
    d       = g.dest
    # la place visée se retient par la ligne qui la précède, lue dans les places d'avant le changement
    lead    = if d?.at > 0 then g.geo.get(d.q)?.rows.filter((el)-> el isnt g.row)[d.at - 1] else null
    g.start = list.indexOf(g.row)
    g.n     = list.length
    ready(cands)
    g.seen = undefined
    if g.mode is 'pointer'
      update()
    else
      # sans avoir bougé, la ligne tenue reste sur place ; déplacée, elle garde sa voisine du dessus : une ligne que la page ajoute ou retire,
      # au-dessus de la ligne tenue comme entre sa place de départ et la place visée, ne la pose jamais une place à côté ; sa voisine retirée,
      # la place se décale comme la ligne tenue
      d    = { q: g.src, at: was } unless d and cands.includes(d.q)
      rest = g.geo.get(d.q).rows.filter((el)-> el isnt g.row)
      at   = if d.q is g.src and d.at is was then g.start else (if lead and rest.includes(lead) then rest.indexOf(lead) + 1 else (if d.q is g.src then Math.max(d.at + g.start - was, 0) else d.at))
      g.dest = { q: d.q, at: Math.min(at, limitOf(d.q)) }
      show()
    return

  onResize = ->
    return unless g?.started
    changed = false
    g.geo.forEach (geo)->
      now = geo.q.rows()
      changed = true if now.length isnt geo.rows.length or now.some((el, j)-> Math.abs(el.getBoundingClientRect().height - geo.heights[j]) > .5)
    remeasure() if changed
    return

  onScroll = ->
    return unless g?.started
    g.scrollers.forEach(clamp)
    update()
    return

  # au doigt, le navigateur décide de défiler au premier mouvement : seul un écouteur qui BLOQUE, posé avant l'appui, l'en empêche une fois la ligne saisie
  onTouchMove = (e)->
    e.preventDefault() if g?.started and e.cancelable
    return

  onSelect = (e)-> e.preventDefault()
  onMenu   = (e)-> e.preventDefault()

  swallowClick = ->
    unswallow()
    block = (e)->
      e.stopPropagation()
      e.preventDefault()
      unswallow()
    swallow = { block: block, timer: setTimeout(unswallow, CLICK_WAIT) }
    window.addEventListener('click', block, true)
    return

  unswallow = ->
    return unless swallow
    clearTimeout(swallow.timer)
    window.removeEventListener('click', swallow.block, true)
    swallow = null
    return

  # plus rien du geste : écouteurs de window, minuteries, observateur ; les marques des lignes sont à `clear`
  release = ->
    return unless g
    clearTimeout(g.timer)
    cancelAnimationFrame(g.frame)
    g.observer?.disconnect()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onEscape)
    window.removeEventListener('contextmenu', onMenu)
    window.removeEventListener('selectstart', onSelect)
    window.removeEventListener('dragstart', onSelect)
    g.scrollers?.forEach (sc)->
      target = if pageOf(sc) then window else sc
      target.removeEventListener('scroll', onScroll)
    hostRef.removeAttribute('mjs-sortable-key')
    g = null
    return

  clear = (s)->
    s.shown.forEach (dy, el)->
      el.removeAttribute('mjs-sortable')
      el.style.removeProperty('--mjs-sortable-dy')
      el.style.removeProperty('--mjs-sortable-dx') # @@ group
      el.removeAttribute('style') if el.getAttribute('style') is ''
    s.shown.clear()
    return

  # la nouvelle liste : les liaisons `value` sont remises dans l'ordre (la ligne quitte la liste de départ, entre dans celle d'arrivée), et `sort` part une seule fois, de la liste d'arrivée
  commit = (s)->
    d = s.dest
    if d.q is s.src
      order = Array.from({ length: s.n }, (_, i)-> i)
      order.splice(s.start, 1)
      order.splice(d.at, 0, s.start)
      item = undefined
      if Array.isArray($value) and $value.length is s.n
        list = Array.from($value)
        item = list[s.start]
        list.splice(s.start, 1)
        list.splice(d.at, 0, item)
        $value = list
      µemit 'sort', { from: s.start, to: d.at, item: item, order: order }
      return
    # @@ group
    item   = undefined
    source = s.src.value()
    if Array.isArray(source) and source.length is s.n
      list = Array.from(source)
      item = list.splice(s.start, 1)[0]
      s.src.set(list)
    target = d.q.value()
    if item isnt undefined and Array.isArray(target) and target.length is s.geo.get(d.q).rows.length
      list = Array.from(target)
      list.splice(d.at, 0, item)
      d.q.set(list)
    d.q.emit({ from: s.start, to: d.at, item: item, source: s.src.host })
    return
    # @@

  # chaque ligne qui n'était pas à sa place glisse de là où elle est jusqu'à sa place, sans toucher à `transform` (que `@flip` utilise) ; la ligne arrivée dans une autre liste est une ligne neuve, qui part d'où l'ancienne a été lâchée ; si la page fait voler l'ancienne (`arrived` est null), la transition de la page amène la neuve : ici elle ne glisse pas
  glide = (before, old, arrived)->
    return if matchMedia('(prefers-reduced-motion: reduce)').matches
    # @@ group
    if arrived isnt old
      first = before.get(old)
      before.delete(old)
      before.set(arrived, first) if first and arrived # @@ transition
      # before.set(arrived, first) if first # @@ !transition
    # @@
    before.forEach (r0, el)->
      return unless el.isConnected and el.animate
      r1 = el.getBoundingClientRect()
      gx = r0.left - r1.left
      gy = r0.top - r1.top
      return if Math.abs(gx) < 1 and Math.abs(gy) < 1
      el.animate([{ translate: gx + 'px ' + gy + 'px' }, { translate: '0px 0px' }], { duration: GLIDE, easing: 'ease-out' })
    return

  # le nouvel ordre est posé par la page (ou ne l'est pas : la liste est calculée) : alors les marques partent, d'un coup
  settle = (s, before, focused, cross)->
    done    = false
    dst     = if cross then s.dest.q else null # @@ group
    count   = if cross then s.geo.get(dst).rows.length else 0 # @@ group
    slots   = [s.src.slot()]
    slots.push(dst.slot()) if cross # @@ group
    applied = -> not cross or (not s.src.rows().includes(s.row) and dst.rows().length > count) # @@ group
    # applied = -> true # @@ !group
    clean   = ->
      return if done
      done = true
      slots.forEach((slot)-> slot?.removeEventListener('slotchange', check))
      clear(s)
      arrived = s.row
      # @@ group
      leaving = false # @@ transition
      if cross and applied()
        # @@ transition
        # la page fait sortir l'ancienne ligne avec une transition (`*crossfade`) : elle reste dans le flux le temps de voler ; elle en sort là où elle a été lâchée, et les voisines se referment
        leaving = s.row._mjs_dying and s.row.isConnected
        if leaving
          # @@ dev transition
          unless toldFade
            toldFade = true
            µ.warn('[ModularJS] ' + (warningFade[µ._mjs_labelLang()] ?? warningFade[µ._runtimeLabelsLang] ?? warningFade.fr))
          # @@
          box    = before.get(s.row)
          anchor = s.row.offsetParent
          µ._mjs_fixPosition?.(s.row, { left: box.left + (anchor?.scrollLeft or 0), top: box.top + (anchor?.scrollTop or 0) })
          s.src.refresh()
        # @@
        dst.refresh()
        arrived = dst.rows()[s.dest.at]
      # @@
      if focused and arrived?.isConnected and arrived.getRootNode().activeElement isnt arrived
        arrived.focus({ preventScroll: true })
      # @@ group
      glide(before, s.row, (if leaving then null else arrived)) # @@ transition
      # glide(before, s.row, arrived) # @@ !transition
      # @@
      # glide(before, s.row, arrived) # @@ !group
      return
    check = ->
      clean() if applied()
      return
    slots.forEach((slot)-> slot?.addEventListener('slotchange', check))
    requestAnimationFrame(clean)
    return

  # fin du geste : drop vrai = poser, faux = annuler ; rien n'est émis hors d'une pose qui change la place
  end = (drop)->
    return unless g
    s = g
    release()
    return unless s.started
    swallowClick() if s.mode is 'pointer'
    before = new Map()
    # @@ group
    # une ligne qui change de liste change la hauteur de ses deux listes, et les sections voisines se décalent : toutes les lignes des listes sont relevées, les plus extérieures d'abord (une section glisse, ses lignes avec elle)
    if drop and s.dest and s.dest.q isnt s.src
      for q in s.cands.slice().sort((a, b)-> s.deep.get(a) - s.deep.get(b))
        continue unless s.geo.get(q).seen
        before.set(el, el.getBoundingClientRect()) for el in s.geo.get(q).rows
    # @@
    s.shown.forEach (dy, el)->
      before.set(el, el.getBoundingClientRect()) if dy isnt 0 or el is s.row
    focused = s.row.getRootNode().activeElement is s.row
    d       = s.dest
    moved   = drop and d and (d.q isnt s.src or d.at isnt s.start)
    commit(s) if moved
    settle(s, before, focused, moved and d.q isnt s.src)
    return

  begin = ->
    return unless g and not g.started
    clearTimeout(g.timer)
    refresh()
    cands = targetsFor(g.row)
    unless rows.includes(g.row) and (rows.length > 1 or cands.length > 1)
      release()
      return
    g.started = true
    g.src     = me
    g.geo     = new Map()
    g.first   = new Map()
    g.start   = rows.indexOf(g.row)
    g.n       = rows.length
    ready(cands)
    geo    = g.geo.get(me)
    g.offY = g.y0 - (geo.tops[g.start] + geo.heights[g.start] / 2 + frameOf(geo.sc))
    g.dest = { q: me, at: g.start }
    getSelection()?.removeAllRanges()
    try
      g.row.setPointerCapture(g.id)
    catch
      null
    if typeof ResizeObserver is 'function'
      g.observer = new ResizeObserver(onResize)
      for q in cands
        g.observer.observe(q.host)
        g.observer.observe(el) for el in q.rows()
    g.scrollers = new Set()
    g.geo.forEach (one)->
      g.scrollers.add(one.sc)
    g.scrollers.forEach (sc)->
      target = if pageOf(sc) then window else sc
      target.addEventListener('scroll', onScroll)
    g.frame = requestAnimationFrame(tick)
    update()
    return

  onMove = (e)->
    return unless g and e.pointerId is g.id
    g.x = e.clientX
    g.y = e.clientY
    unless g.started
      far = Math.hypot(e.clientX - g.x0, e.clientY - g.y0)
      if g.type is 'mouse'
        begin() if far >= MOUSE_MOVE
      else if far > TOUCH_SLOP
        release()
      return unless g?.started
    update()
    return

  onUp = (e)->
    return unless g and e.pointerId is g.id
    if g.started
      g.x = e.clientX
      g.y = e.clientY
      aim()
    end(g.started and g.dest isnt null)
    return

  onCancel = (e)->
    end(false) if g and e.pointerId is g.id
    return

  onEscape = (e)->
    end(false) if e.key is 'Escape' and g?.started
    return

  # la ligne qu'un appui désigne, si cet appui peut la saisir : toute la ligne sauf ses boutons, liens et champs, ou la seule poignée
  rowOf = (path, row)->
    before   = path.slice(0, path.indexOf(row))
    selector = handleSel()
    if selector
      return if before.some((el)-> matches(el, selector)) then row else null
    if before.some((el)-> matches(el, IGNORE)) then null else row

  # un appui dans une ligne de cette liste est à elle seule : la liste qui contient celle-ci ne le prend pas, même si cette ligne refuse (poignée, bouton)
  onDown = (e)->
    return if g or not e.isPrimary or e._mjs_sortable
    return if e.pointerType is 'mouse' and e.button isnt 0
    path = e.composedPath()
    hit  = path.find((el)-> rows.includes(el))
    return unless hit
    e._mjs_sortable = true
    row = rowOf(path, hit)
    return unless row
    g = { mode: 'pointer', row: row, id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false, shown: new Map(), timer: 0, frame: 0 }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('contextmenu', onMenu)
    window.addEventListener('selectstart', onSelect)
    window.addEventListener('dragstart', onSelect)
    g.timer = setTimeout(begin, TOUCH_HOLD) unless e.pointerType is 'mouse'
    return

  # la ligne (ou sa poignée) qui a le focus : Espace la saisit
  grabRowOf = (target)->
    return target if rows.includes(target)
    selector = handleSel()
    return null unless selector and matches(target, selector)
    rows.find((r)-> r.contains(target)) ?? null

  grab = (row)->
    cands = targetsFor(row)
    return if rows.length < 2 and cands.length < 2
    g = { mode: 'key', row: row, started: true, src: me, geo: new Map(), first: new Map(), shown: new Map(), timer: 0, frame: 0 }
    g.start = rows.indexOf(row)
    g.n     = rows.length
    ready(cands)
    g.dest = { q: me, at: g.start }
    hostRef.setAttribute('mjs-sortable-key', '')
    show()
    say((if cands.length > 1 then 'sortableGrabGroup' else 'sortableGrab'), g.start + 1, g.n) # @@ group
    # say('sortableGrab', g.start + 1, g.n) # @@ !group
    return

  onKey = (e)->
    return if e.altKey or e.ctrlKey or e.metaKey
    # une touche Espace tenue ne saisit pas puis ne pose pas aussitôt
    if e.repeat and e.key is ' ' and (g?.mode is 'key' or grabRowOf(e.target))
      e.preventDefault()
      return
    if g?.mode is 'key'
      keyStep(e)
    else if e.key is ' ' and not g
      refresh()
      row = grabRowOf(e.target)
      return unless row
      e.preventDefault()
      grab(row)
    # hors geste, les flèches haut et bas mènent le focus à la ligne voisine qui se voit, sans boucler (depuis la ligne elle-même, jamais depuis un champ qu'elle contient)
    else if (e.key is 'ArrowDown' or e.key is 'ArrowUp') and not g and rows.includes(e.target)
      e.preventDefault()
      d = if e.key is 'ArrowDown' then 1 else -1
      i = rows.indexOf(e.target) + d
      i += d while rows[i] and not shown(rows[i])
      rows[i]?.focus()
    return

  # la ligne qui prend le focus (flèches, clic, Tab, script) devient la ligne itinérante
  onFocusIn = (e)->
    return unless rows.includes(e.target) and e.target isnt roving
    roving = e.target
    rove()
    return

  # @@ group
  # la liste du groupe qui porte la liste q (la plus proche)
  parentOf = (q)->
    best = null
    for o in g.cands
      continue if o is q or not inside(q.host, o.host)
      best = o if not best or g.deep.get(o) > g.deep.get(best)
    best

  # la liste la plus haute du groupe dans une ligne, si elle se voit
  childOf = (row)->
    best = null
    for o in g.cands
      continue unless inside(o.host, row) and o.host.getClientRects().length
      best = o if not best or g.deep.get(o) < g.deep.get(best)
    best

  # flèche droite : entrer dans la liste du groupe qui suit la place, sinon dans celle qui la précède
  enterOf = (d)->
    list = g.geo.get(d.q).rows.filter((el)-> el isnt g.row)
    for row, i in [list[d.at], list[d.at - 1]]
      continue unless row
      c = childOf(row)
      return { q: c, at: (if i is 0 then 0 else g.geo.get(c).rows.length) } if c
    null

  # flèche gauche : sortir vers la liste qui porte celle-ci, juste après la ligne qui la contient
  leaveOf = (d)->
    q = parentOf(d.q)
    return null unless q
    list = g.geo.get(q).rows
    i    = list.findIndex((el)-> inside(d.q.host, el))
    return null if i < 0
    i-- if q is g.src and i > g.start
    { q: q, at: i + 1 }

  # une liste de premier niveau n'a pas de groupe d'où sortir : flèches gauche et droite passent à sa voisine, à la même place
  sideOf = (d, step)->
    return null if parentOf(d.q)
    tops = g.cands.filter((o)-> not parentOf(o))
    i    = tops.indexOf(d.q) + step
    return null if i < 0 or i >= tops.length or not tops[i].host.getClientRects().length
    { q: tops[i], at: Math.min(d.at, limitOf(tops[i])) }

  # où se trouve une liste, pour qui l'entend : son nom (aria-labelledby, puis aria-label), sinon sa place parmi les listes voisines
  whereOf = (q)->
    root = q.host.getRootNode()
    name = (q.host.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id)-> root.getElementById?(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
    name ||= q.host.getAttribute('aria-label')?.trim()
    return textOf('sortableNamed').replace('{name}', -> name) if name
    near = g.cands.filter((o)-> parentOf(o) is parentOf(q))
    textOf('sortableUnnamed').replace('{n}', near.indexOf(q) + 1).replace('{total}', near.length)

  hop = (right)->
    d   = g.dest
    to  = if right then enterOf(d) else leaveOf(d)
    key = if right then 'sortableEnter' else 'sortableLeave'
    unless to
      to  = sideOf(d, if right then 1 else -1)
      key = 'sortableHop'
    return unless to
    g.dest = to
    show()
    say(key, to.at + 1, totalOf(to.q), whereOf(to.q))
    g.row.scrollIntoView?({ block: 'nearest' })
    return
  # @@

  keyStep = (e)->
    if e.key is 'ArrowDown' or e.key is 'ArrowUp'
      e.preventDefault()
      d  = g.dest
      at = Math.max(0, Math.min(limitOf(d.q), d.at + (if e.key is 'ArrowDown' then 1 else -1)))
      return if at is d.at
      g.dest = { q: d.q, at: at }
      show()
      say('sortableMove', at + 1, totalOf(d.q))
      g.row.scrollIntoView?({ block: 'nearest' })
    else if e.key is 'ArrowRight' or e.key is 'ArrowLeft'
      e.preventDefault()
      hop(e.key is 'ArrowRight') # @@ group
    else if e.key is ' '
      e.preventDefault()
      say('sortableDrop', g.dest.at + 1, totalOf(g.dest.q))
      end(true)
    else if e.key is 'Escape'
      e.preventDefault()
      e.stopPropagation()
      say('sortableCancel', g.start + 1, g.n)
      end(false)
    return

  # Espace sur un bouton se joue au relâchement : la touche qui saisit ou pose ne doit pas le cliquer
  onKeyUp = (e)->
    e.preventDefault() if e.key is ' ' and (g?.mode is 'key' or grabRowOf(e.target))
    return

  # le focus quitte la ligne saisie et ses éléments (boutons, champs) : le geste est annulé, sans annonce
  onFocusOut = (e)->
    return unless g?.mode is 'key'
    to = e.relatedTarget
    return if to and g.row.contains(to)
    return if not to and not document.hasFocus()
    end(false)
    return

  # tout ce que le module a posé s'en va, au retrait comme au repos
  abort = ->
    if g
      s = g
      release()
      clear(s)
    unswallow()
    clearTimeout(sayTimer)
    return

  # une bascule de langue réécrit les textes des lignes
  µeffect ->
    $rowTexts
    deco.forEach (rec, el)-> retext(el, rec)

  # @@ dev group
  # la production retire les groupes quand aucune page n'écrit `group` : une liste qui le reçoit d'un script, ici, ne les aurait plus là-bas
  µeffect ->
    if $group and not told
      told = true
      µ.warn('[ModularJS] ' + (warning[µ._mjs_labelLang()] ?? warning[µ._runtimeLabelsLang] ?? warning.fr))
  # @@

  µawake =>
    hostRef = @
    sortableLists.delete(me) if me # @@ group
    me = { host: @, group: groupName, rows: listRows, slot: listSlot, value: listValue, set: setValue, emit: emitSort, refresh: refresh } # @@ group
    # me = { host: @, rows: listRows, slot: listSlot } # @@ !group
    sortableLists.add(me) # @@ group
    hostRef.addEventListener('pointerdown', onDown)
    hostRef.addEventListener('keydown', onKey)
    hostRef.addEventListener('keyup', onKeyUp)
    hostRef.addEventListener('focusout', onFocusOut)
    hostRef.addEventListener('focusin', onFocusIn)
    hostRef.addEventListener('touchmove', onTouchMove, { passive: false })
    watch ||= new MutationObserver(onRowAttr)
    watch.observe(hostRef, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'inert'] })
    refresh()

  µmount =>
    slotRef.addEventListener('slotchange', refresh)
    refresh()

  µsleep =>
    abort()
    sortableLists.delete(me) # @@ group
    hostRef.removeEventListener('pointerdown', onDown)
    hostRef.removeEventListener('keydown', onKey)
    hostRef.removeEventListener('keyup', onKeyUp)
    hostRef.removeEventListener('focusout', onFocusOut)
    hostRef.removeEventListener('focusin', onFocusIn)
    hostRef.removeEventListener('touchmove', onTouchMove)
    watch.disconnect()
    deco.forEach (rec, el)-> undeco(el, rec)
    deco.clear()
</script>

<div class="list" part="list" role="list" @class{$handle}="handled">
  <slot @this=!{slotRef}></slot>
</div>
<div class="live" role="status" aria-live="assertive" aria-atomic="true">{$announce}</div>

<style @display="block">
  .live
    position: absolute
    width: 1px
    height: 1px
    margin: -1px
    padding: 0
    border: 0
    overflow: hidden
    clip: rect(0, 0, 0, 0)
    white-space: nowrap

  .list:not(.handled) ::slotted(*)
    cursor: grab

  ::slotted([mjs-sortable])
    position: relative
    translate: var(--mjs-sortable-dx, 0px) var(--mjs-sortable-dy, 0px)
    user-select: none
    -webkit-user-select: none
    -webkit-touch-callout: none

  ::slotted([mjs-sortable="shift"])
    transition: translate .15s ease

  ::slotted([mjs-sortable="held"])
    z-index: 2
    cursor: grabbing
    box-shadow: var(--mjs-sortable-shadow, 0 8px 22px rgba(0, 0, 0, .22))
    transition: none

  :host([mjs-sortable-key]) ::slotted([mjs-sortable="held"])
    transition: translate .15s ease

  @media (prefers-reduced-motion: reduce)
    ::slotted([mjs-sortable])
      transition: none

    :host([mjs-sortable-key]) ::slotted([mjs-sortable="held"])
      transition: none
</style>
