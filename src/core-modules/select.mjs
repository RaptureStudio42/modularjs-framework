@formAssociated

<script module>
  # les repères `@@` (script `# @@`, gabarit `<!-- @@ -->`, style `// @@`) cernent ce qui ne sert qu'à l'attribut `other` : le build de production les ôte quand aucune liste de l'appli ne l'écrit, le développement et la copie dans un projet gardent tout (les repères y sont des commentaires), ils ne partent jamais dans le code envoyé
  # `other` : le morceau propre à `other` ; `!other` : l'autre forme des lignes qui existent avec et sans `other`, écrite en commentaire et remise en code quand `other` part ; `dev other` : l'avertissement du développement, gardé tant qu'aucune page n'écrit `other`
  # `reprise` : le morceau qui écrit le choix de la liste dans sa balise quand le serveur la rend, ôté en production quand l'application ne reprend aucune page rendue par le serveur
  nextId = 0
  # @@ dev other
  told = false
  # @@
</script>

<script>
  $value = null
  $open  = false

  $placeholder       = null
  $searchPlaceholder = null
  $emptyLabel        = null
  $match             = 'contains'

  $iconChecked   = '✔'
  $iconUnchecked = ''

  $optionsData = []
  $query       = ''
  $activeIndex = -1
  $panelUp     = false
  $panelMax    = '280px'

  $comboLabel   = null
  $comboInvalid = null
  $formDisabled = false

  # @@ other
  $otherEditing = false
  $otherText    = ''
  # @@

  uid         = "mjs-select-#{nextId++}"
  panelId     = "#{uid}-panel"
  otherHintId = "#{uid}-other-hint" # @@ other

  optionId = (i)-> "#{uid}-opt-#{i}"

  # libellés par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang)-> µ._mjs_label('core', key)

  $placeholderText = $placeholder ?? tr('selectPlaceholder', µlang)
  $searchText      = $searchPlaceholder ?? tr('selectSearch', µlang)

  wrapperRef      = null
  buttonRef       = null
  searchInputRef  = null
  otherInputRef   = null # @@ other
  slotRef         = null
  optionsObserver = null
  hostObserver    = null
  labelObserver   = null
  watched         = []
  watchedDeep     = false
  cited           = []
  keyScrolled     = false
  probe           = null
  typed           = ''
  typedAt         = 0
  pointerAt       = ''
  composing       = false
  composed        = null

  multiOf    = (multiple)-> multiple !== undefined and multiple !== false
  stickyOf   = (sticky, multiple)-> sticky !== undefined and sticky !== false and not multiOf(multiple)
  searchOnOf = (search)-> search !== undefined and search !== false
  offOf      = (disabled)-> disabled? and disabled !== false and String(disabled).toLowerCase() !== 'false' # `disabled="false"`, toute casse (le rendu serveur la lit ici, sans le socle du cœur), laisse la liste active ; lu à l'usage, comme `search` : la liste reste à 40 variables d'état (seuil du lint)
  lockedOf   = (disabled, formDisabled)-> offOf(disabled) or formDisabled # désactivée par elle-même ou par un `<fieldset disabled>` autour d'elle (`formDisabled`, posé par le socle du cœur) : les deux se cumulent
  normalize  = (s)-> (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss') # NFKD défait aussi les ligatures (« ﬁ »), œ, æ et ß s'écrivent en lettres

  # sous-suite : chaque lettre de q, dans l'ordre, avec des trous permis
  subsequence = (label, q)->
    j = 0
    for ch in label
      j++ if j < q.length and ch == q[j]
    j == q.length

  # sans prototype : seuls ces quatre modes existent, `constructor` ou `toString` retombent sur contains comme tout nom inconnu
  matchers = {
    __proto__:      null
    contains:       (label, q)-> label.includes(q)
    starts:         (label, q)-> label.startsWith(q)
    fuzzy:          (label, q)-> subsequence(label, q)
    'starts-fuzzy': (label, q)-> label[0] == q[0] and subsequence(label.slice(1), q.slice(1))
  }

  # le libellé normalisé vient de optionData (calculé une fois) : chaque touche, chaque survol
  # refiltrait sinon toutes les options en renormalisant chaque libellé
  filterFn = (query, search, match, options)->
    return options unless searchOnOf(search)
    return options if match == 'async'
    q = normalize(query.trim())
    return options unless q
    test = matchers[match] or matchers.contains
    options.filter (o)-> test(o.norm ?? normalize(o.label), q)

  # une valeur vide ne choisit rien : null == null cochait toutes les options sans valeur ; la forme texte garde « 18 » et 18 pour la même valeur, mais distingue 0, '' et false que == confondait (le bouton disait « Zéro » après le choix de « Vide »)
  isSelected = (v, value, multiple)->
    if multiOf(multiple) then Array.isArray(value) and value.includes(v) else value != null and String(value) == String(v)

  # `match="async"` : la page remplace les options pendant la recherche, l'option choisie peut n'y plus être ; le choix garde alors le libellé et l'icône sous lesquels on l'a vue la dernière fois (une valeur jamais vue n'en a pas)
  # seules les valeurs CHOISIES y sont retenues (une liste servie par un serveur ne s'y accumule pas) ; sans `match="async"` rien n'y entre
  kept = new Map()

  # refait la mémoire : une entrée par valeur choisie, prise parmi les options données (les plus récentes d'abord), sinon parmi celles déjà gardées ; une valeur qui n'est plus choisie en sort
  keepChosen = (value, multiple, match, pool)->
    next = new Map()
    if match == 'async'
      multi = multiOf(multiple)
      list  = if multi then (if Array.isArray(value) then value else []) else [value]
      for v in list when v?
        key = String(v)
        o   = pool.find((x)-> isSelected(x.value, (if multi then [v] else v), multiple)) ?? kept.get(key)
        next.set(key, o) if o
    kept = next

  # les options du choix ; sous `match="async"` dans l'ordre des valeurs, chacune prise parmi les options affichées, sinon parmi celles gardées
  selectedOf = (value, multiple, options, match)->
    sel = options.filter (o)-> isSelected(o.value, value, multiple)
    return sel unless match == 'async'
    multi = multiOf(multiple)
    list  = if multi then (if Array.isArray(value) then value else []) else [value]
    list.filter((v)-> v?).map((v)-> sel.find((o)-> isSelected(o.value, (if multi then [v] else v), multiple)) ?? kept.get(String(v))).filter(Boolean)

  # choix simple : un seul libellé, même si deux options portent la même valeur
  labelFn = (value, multiple, options, placeholder, match)->
    sel = selectedOf(value, multiple, options, match)
    return placeholder unless sel.length
    if multiOf(multiple) then sel.map((o)-> o.label).join(', ') else sel[0].label

  # rien de choisi (ni option, ni réponse libre) : le bouton montre le texte d'attente, qu'on grise ; même condition que labelFn
  waitingOf = (value, multiple, options, match)-> not selectedOf(value, multiple, options, match).length

  iconFn = (value, multiple, options, match)->
    return null if multiOf(multiple)
    sel = selectedOf(value, multiple, options, match)
    if sel.length then sel[0].icon else null

  activeDescendantFn = (open, activeIndex, count)->
    return undefined unless open
    return undefined unless activeIndex >= 0 and activeIndex < count
    optionId(activeIndex)

  # les options affichées par section : une suite d'options du même <@@optgroup> sous son titre, une suite
  # hors groupe sans titre ; `i` reste la place dans la liste filtrée (flèches, ids) ; les clés viennent des places, jamais
  # des valeurs : deux options de même valeur (ou deux suites qui commencent par elle) s'affichent toutes
  sectionsOf = (filtered)->
    out = []
    for o, i in filtered
      n   = if o.group then o.group.n else -1
      sec = out[out.length - 1]
      unless sec and sec.n == n
        sec = { key: (if n >= 0 then "g#{n}-#{i}" else "h#{i}"), n: n, grouped: n >= 0, label: (if n >= 0 then o.group.label else undefined), items: [] }
        out.push(sec)
      sec.items.push({ i: i, value: o.value, o: o })
    out

  # la jauge qui donne sa largeur à la liste fermée ne garde que les cinq libellés les plus longs (une icône compte pour deux caractères, un titre de groupe décale d'un) : mille options n'y laissent pas mille éléments
  widestOf = (options)->
    return options if options.length <= 5
    weight = (o)-> o.label.length + (if o.icon then 2 else 0) + (if o.group then 1 else 0)
    options.slice().sort((a, b)-> weight(b) - weight(a)).slice(0, 5)

  # @@ other
  # le nombre de caractères permis à la réponse libre ; 0 = pas de réponse libre (absent ou false, comme multiple et search) ; tout ce qui n'est pas un entier d'au moins 1 donne 80
  otherMaxOf = (other)->
    return 0 if other === undefined or other === false
    n = String(other).trim()
    if /^\d+$/.test(n) and Number(n) >= 1 then Number(n) else 80

  # les réponses libres se déduisent : toute valeur qui n'est celle d'aucune option (même comparaison que isSelected) ; null, '' et un texte fait de blancs n'en sont jamais
  freeOf = (value, multiple, options, max)->
    return [] unless max
    list = if multiOf(multiple) then (if Array.isArray(value) then value else []) else [value]
    list.filter (v)-> v? and String(v).trim() !== '' and not options.some((o)-> isSelected(o.value, (if multiOf(multiple) then [v] else v), multiple))

  # une réponse libre est une option comme les autres (cochée, retirée, cherchée, annoncée par le même geste), après celles de la balise ; seule sa marque `free` la distingue
  choicesOf = (options, value, multiple, max)->
    free = freeOf(value, multiple, options, max)
    return options unless free.length
    options.concat free.map((v)-> { value: v, icon: null, label: String(v), norm: normalize(String(v)), group: null, free: true })

  # choix simple : la réponse libre donnée n'est pas une ligne de plus, elle est la ligne « Autre : texte » ; en choix multiple elle est une ligne
  givenOf = (choices, multi)->
    return null if multi
    choices.find((o)-> o.free) ?? null

  listedOf = (choices, given)-> if given then choices.filter((o)-> o != given) else choices

  # coupe au maximum sans scinder une paire de substituts : un émoji pèse deux unités, sa moitié n'est pas un caractère
  cutText = (text, max)->
    out = text.slice(0, max)
    if out.length < text.length and /[\uD800-\uDBFF]$/.test(out) then out.slice(0, -1) else out

  # les textes de la réponse libre : ceux de l'auteur d'abord, sinon ceux de la langue de la page
  otherTextsOf = (label, placeholder, lang)->
    { label: label ?? tr('selectOther', lang), placeholder: placeholder ?? tr('selectOtherPlaceholder', lang), hint: tr('selectOtherHint', lang), ok: tr('selectOtherOk', lang), sep: tr('selectOtherSep', lang) }

  # le texte de la ligne « Autre… » : « Autre : texte » (le libellé sans ses points de suspension finaux) quand une réponse libre est donnée en choix simple
  otherRowOf = (texts, given)->
    if given then String(texts.label).replace(/\s*(?:…|\.\.\.)+\s*$/, '') + texts.sep + given.label else texts.label

  # le nom du champ caché des réponses libres : celui du sélecteur suivi de `_other`, avant le dernier crochet fermant
  otherName = (name)->
    s    = String(name)
    tail = if s.endsWith('[]') then '[]' else ''
    s    = s.slice(0, s.length - tail.length)
    cut  = if s.endsWith(']') then s.length - 1 else s.length
    s.slice(0, cut) + '_other' + s.slice(cut) + tail

  # les champs cachés voulus, [nom, valeur] : les options choisies sous le nom du sélecteur, les réponses libres sous ce nom suivi de `_other` ; une valeur qu'aucune option ne porte (le bouton dit alors « Choisir… ») ne part pas, comme avec un <select> natif ; tant qu'aucune option n'est lue (rendu du serveur, options pas encore arrivées), la valeur part telle quelle et le champ écrit par le serveur reste
  fieldsOf = (name, value, multiple, options, max, match)->
    free  = freeOf(value, multiple, options, max)
    known = selectedOf(value, multiple, options, match)
    all   = if multiOf(multiple) then (if Array.isArray(value) then value else []) else (if value? then [value] else [])
    all.filter((v)-> not free.includes(v) and (not options.length or known.some((o)-> String(o.value) == String(v)))).map((v)-> [name, String(v)]).concat(free.map((v)-> [otherName(name), String(v)]))
  # @@
  # @@ !other
  # fieldsOf = (name, value, multiple, options, match)->
  #   known = selectedOf(value, multiple, options, match)
  #   all   = if multiOf(multiple) then (if Array.isArray(value) then value else []) else (if value? then [value] else [])
  #   all.filter((v)-> not options.length or known.some((o)-> String(o.value) == String(v))).map((v)-> [name, String(v)])
  # @@

  hiddenOf = (name, v)->
    input = document.createElement('input')
    input.type  = 'hidden'
    input.name  = name
    input.value = String(v)
    input.setAttribute('mjs-f', '') if µserver # @@ reprise
    input

  $multi            = multiOf($multiple)
  # @@ other
  $otherMax         = otherMaxOf($other)
  $choices          = choicesOf($optionsData, $value, $multiple, $otherMax)
  $given            = givenOf($choices, $multi)
  $listed           = listedOf($choices, $given)
  # @@
  $filtered         = filterFn($query, $search, $match, $listed)
  # @@ other
  $rowCount         = $filtered.length + (if $otherMax then 1 else 0)
  $otherTexts       = otherTextsOf($otherLabel, $otherPlaceholder, µlang)
  # @@
  $currentLabel     = labelFn($value, $multiple, $choices, $placeholderText, $match)
  $currentIcon      = iconFn($value, $multiple, $choices, $match)
  $activeDescendant = activeDescendantFn($open and not $otherEditing, $activeIndex, $rowCount) # @@ other
  # @@ !other
  # $choices          = $optionsData
  # $listed           = $optionsData
  # $rowCount         = $filtered.length
  # $activeDescendant = activeDescendantFn($open, $activeIndex, $rowCount)
  # @@

  # une icône est un texte ou une image `{ src }` : tout autre objet (`icon={{}}`) n'affiche rien, au lieu de « [object Object] »
  iconOf = (icon)-> if icon and typeof icon == 'object' then (if icon.src then icon else null) else icon

  # la valeur telle que le parent l'a posée, dans son type (`value={m.id}` reste le nombre 18, son
  # attribut n'en garde que le texte « 18 ») : l'état de l'option, sinon son attribut, sinon son
  # libellé, comme une <option> native sans value
  optionData = (el, seen)->
    label = (el.textContent or '').trim()
    etat  = el._state
    { value: etat?.value ?? el.getAttribute('value') ?? label, icon: iconOf(etat?.icon ?? el.getAttribute('icon')), label: label, norm: normalize(label), group: groupOf(el, seen) }

  # le <@@optgroup> d'une option, numéroté dans l'ordre : deux groupes de même titre restent deux
  groupOf = (el, seen)->
    g = el.closest('mjs-core-optgroup')
    return null unless g
    n = seen.indexOf(g)
    if n == -1
      seen.push(g)
      n = seen.length - 1
    { n: n, label: String(g._state?.label ?? g.getAttribute('label') ?? '') }

  refreshOptions = ->
    return unless slotRef
    assigned = slotRef.assignedElements()
    # assignedElements() ne rend que les enfants DIRECTS du slot : un wrapper intermédiaire est
    # lui-même slotté, pas les <mjs-core-option> qu'il contient → on descend dedans au besoin
    els          = assigned.flatMap (el)-> if el.tagName.toLowerCase() == 'mjs-core-option' then [el] else Array.from(el.querySelectorAll('mjs-core-option'))
    seen         = []
    fresh        = els.map (el)-> optionData(el, seen)
    keepChosen($value, $multiple, $match, fresh.concat($optionsData))
    $optionsData = fresh
    keepActive() if $open
    # une option peut être modifiée EN PLACE (liste {for} réactive, même clé, même noeud
    # <mjs-core-option> réutilisé) sans jamais déclencher slotchange → on observe le sous-arbre
    # projeté lui-même, réobservé à chaque passage pour suivre un remplacement de noeuds
    optionsObserver?.disconnect()
    for el in assigned
      optionsObserver?.observe(el, { attributes: true, childList: true, characterData: true, subtree: true })

  # `match="async"` : la page remplace les options pendant que le panneau est ouvert ; la ligne active reste dans les bornes (la première si elle sortait, aucune si la liste est vide) et se montre
  keepActive = ->
    return unless $match == 'async'
    return if $otherEditing # @@ other
    count = filterFn($query, $search, $match, $optionsData).length + (if $otherMax then 1 else 0) # @@ other
    # count = filterFn($query, $search, $match, $optionsData).length # @@ !other
    $activeIndex = if count then (if $activeIndex >= 0 and $activeIndex < count then $activeIndex else 0) else -1
    queueMicrotask -> reveal($activeIndex)

  updatePlacement = ->
    return unless buttonRef
    rect      = buttonRef.getBoundingClientRect()
    vh        = window.innerHeight
    below     = vh - rect.bottom
    above     = Math.min(rect.top, vh)
    $panelUp  = below < 280 and above > below
    available = if $panelUp then above else below
    $panelMax = "#{Math.round(Math.max(Math.min(available - 12, 280), 0))}px"
    # @@ other
    queueMicrotask(fitOther) if $otherMax

  # une liste `other` ne sort jamais de la fenêtre (trop à droite : le bord droit du panneau suit celui de la balise, puis la fenêtre le borne) et le bloc de son champ se voit en entier dans le panneau, qui défile (jamais la page) ; le champ de recherche collant masque le haut du panneau
  # le panneau est posé d'abord sur le bord droit de la balise (rien ne dépasse à droite avant la mesure : WebKit garde le débordement d'une première pose et en fait un défilement horizontal de la page)
  fitOther = ->
    panel = wrapperRef?.querySelector('.select-panel')
    return unless panel
    panel.style.removeProperty('--mjs-select-panel-left')
    box  = buttonRef.getBoundingClientRect()
    wide = panel.getBoundingClientRect().width
    room = document.documentElement.clientWidth
    left = if box.left + wide > room then box.right - wide else box.left
    panel.style.setProperty('--mjs-select-panel-left', "#{Math.max(Math.min(left, room - wide), 0) - box.left}px")
    block = panel.querySelector('.select-other-edit')
    return unless block
    view = panel.getBoundingClientRect()
    edit = block.getBoundingClientRect()
    high = view.top + panel.clientTop + (panel.querySelector('.select-search')?.offsetHeight ?? 0)
    down = Math.max(edit.bottom - (view.top + panel.clientTop + panel.clientHeight), 0)
    panel.scrollTop += down - Math.max(high - edit.top + down, 0)
  # @@

  # le panneau défile (jamais la page) du seul nécessaire pour garder la ligne `i` en vue, mesuré dans la mise en page du panneau (un zoom ou une transformation du parent n'y change rien) : le champ de recherche collant masque le haut du panneau, et le titre d'un groupe se montre avec sa première ligne
  # `sticky` : l'option choisie, collée en haut ou en bas, masque une bande du panneau ; elle est mesurée à sa place libre (le temps de la mesure, le panneau ne la colle plus) et la ligne ne s'arrête jamais sous elle
  reveal = (i)->
    panel = wrapperRef?.querySelector('.select-panel')
    row   = panel?.querySelector("[id='#{optionId(i)}']")
    return unless row
    stuck = if stickyOf($sticky, $multiple) then panel.querySelector('.select-option.selected') else null
    panel.setAttribute('data-free', '') if stuck
    lead  = row.previousElementSibling
    head  = (if lead?.classList.contains('select-group-label') then lead else row).offsetTop
    foot  = row.offsetTop + row.offsetHeight
    top   = panel.querySelector('.select-search')?.offsetHeight ?? 0
    # un panneau sans la place d'une ligne en plus de la recherche et de l'option collée : l'option ne colle plus (la ligne active reste en vue)
    if stuck and panel.clientHeight - top - stuck.offsetHeight < foot - head
      stuck = null
    high  = panel.scrollTop + top
    low   = panel.scrollTop + panel.clientHeight
    shift = if head < high then head - high else if foot > low then Math.min(foot - low, head - high) else 0
    if stuck and stuck != row
      sTop = stuck.offsetTop
      sEnd = sTop + stuck.offsetHeight
      size = sEnd - sTop
      next = Math.max(panel.scrollTop + shift, 0)
      if row.offsetTop >= sEnd - 1 and sTop < next + top and head < next + top + size
        shift = head - top - size - panel.scrollTop
      else if foot <= sTop + 1 and sEnd > next + panel.clientHeight and foot > next + panel.clientHeight - size
        shift = foot - panel.clientHeight + size - panel.scrollTop
    panel.removeAttribute('data-free') if stuck
    return unless shift
    panel.scrollTop += shift
    keyScrolled = true

  # la souris désigne une ligne en y entrant ou en y bougeant ; mais un défilement au clavier amène une autre ligne sous un pointeur immobile, et le navigateur y rejoue `mouseenter` (WebKit aussi `mousemove`), à la même place : tant que le pointeur n'a pas changé de place, cette ligne ne reprend pas la ligne active
  hover = (e, i)->
    at = "#{e.clientX},#{e.clientY}"
    if at != pointerAt
      pointerAt   = at
      keyScrolled = false
    $activeIndex = i unless keyScrolled

  # obligatoire (`required`, lu comme `disabled`), la liste manque tant que rien n'est choisi (ni option, ni réponse libre) ou que son choix est une valeur vide, comme un <select required> natif sur son texte d'attente ; en `multiple`, tant que rien n'est coché ; désactivée, elle ne compte plus
  missingOf = (required, locked, value, multiple, choices, match)->
    return false if locked or not offOf(required)
    sel = selectedOf(value, multiple, choices, match)
    not sel.length or (not multiOf(multiple) and String(sel[0].value) == '')

  # la validité dite au formulaire par le socle du cœur : le message est celui que le navigateur donne à un <select required> natif, lu sur une liste jetable hors de la page, et la bulle s'accroche au bouton ; sans le socle (navigateur sans attachInternals), rien
  syncValidity = =>
    return unless buttonRef and @internals
    probe ||= document.createElement('select')
    probe.multiple = $multi
    µ._mjs_formValid @, probe, missingOf($required, lockedOf($disabled, $formDisabled), $value, $multiple, $choices, $match), buttonRef

  # une touche qui écrit un caractère, sans Ctrl, Alt ni Méta ; Espace n'en est une qu'au milieu d'une saisie au vol (« new y » va à New York, comme dans une liste native), sinon il garde son rôle
  typingOf = (e)-> e.key.length == 1 and not (e.ctrlKey or e.altKey or e.metaKey) and (e.key != ' ' or (typed != '' and e.timeStamp - typedAt < 500))

  # saisie au vol, comme une liste native : les lettres tapées à moins d'une demi-seconde d'écart font un seul texte, cherché au début des libellés (sans accents ni casse), à partir de l'option où l'on est ; une lettre seule, ou la même lettre retapée, va à la suivante qui commence par elle, en bouclant
  # liste ouverte, la ligne active y va (« Autre… » n'est pas une étape) ; fermée, l'option est choisie comme à la souris, et en `multiple` la liste s'ouvre sur elle ; une réponse libre donnée reste en place sur la liste fermée, comme aux flèches
  typeAhead = (e)->
    typed   = '' if e.timeStamp - typedAt >= 500
    typedAt = e.timeStamp
    typed  += normalize(e.key)
    return if not $open and $given # @@ other
    q     = if typed.split('').every((c)-> c == typed[0]) then typed[0] else typed
    rows  = if $open then $filtered else $optionsData
    at    = if $open then $activeIndex else rows.findIndex((o)-> isSelected(o.value, $value, $multiple))
    begin = if q.length == 1 then at + 1 else Math.max(at, 0)
    for k in [0...rows.length]
      i = (begin + k) % rows.length
      continue unless rows[i].norm.startsWith(q)
      if $open
        $activeIndex = i
        reveal(i)
      else if $multi
        openPanel()
        $activeIndex = i
      else
        toggleValue(rows[i].value)
      return

  # une page de la liste ouverte, comme une liste native : les lignes que le panneau montre sous le champ de recherche, moins une, qui reste en vue ; une au moins
  pageOf = ->
    panel = wrapperRef?.querySelector('.select-panel')
    row   = panel?.querySelector('.select-option')
    return 1 unless row?.offsetHeight
    Math.max(Math.floor((panel.clientHeight - (panel.querySelector('.select-search')?.offsetHeight ?? 0)) / row.offsetHeight) - 1, 1)

  # à l'ouverture, la ligne active est l'option choisie (la première des choisies en `multiple`), et le panneau la montre une fois rendu
  openPanel = ->
    return if $open or lockedOf($disabled, $formDisabled)
    refreshOptions()
    composing = false
    composed  = null
    $query    = ''
    idx = $optionsData.findIndex (o)-> isSelected(o.value, $value, $multiple)
    $activeIndex = if idx >= 0 then idx else 0
    $activeIndex = $optionsData.length if $given # @@ other
    $open = true
    updatePlacement()
    queueMicrotask -> reveal($activeIndex)

  closePanel = ->
    # la recherche qui portait du texte se vide : la page remet sa liste
    if $open and $query
      $query = ''
      µemit 'search', ''
    $open         = false
    $activeIndex  = -1
    composing     = false
    composed      = null
    # @@ other
    $otherEditing = false
    $otherText    = ''
    # @@

  # le geste d'une ligne : une option ou une réponse libre, choisie ou retirée de la même façon. Le champ du formulaire est à jour AVANT `change` (un gestionnaire qui lit `new FormData(form)` voit le choix d'après), puis `other` part si les réponses libres ont changé
  toggleValue = (v)->
    before = freeOf($value, $multiple, $optionsData, $otherMax) # @@ other
    next   = v
    if $multi
      next = if Array.isArray($value) then Array.from($value) else []
      idx  = next.indexOf(v)
      if idx == -1 then next.push(v) else next.splice(idx, 1)
    changed = $multi or $value !== v
    $value  = next
    unless $multi
      closePanel()
      buttonRef?.focus()
    return unless changed
    syncHidden()
    µemit 'change', (if $multi then next.slice() else next)
    # @@ other
    after = freeOf(next, $multiple, $optionsData, $otherMax)
    return if before.length == after.length and before.every((x, i)-> String(x) == String(after[i]))
    µemit 'other', (if $multi then after else (after[0] ?? null))
    # @@

  # @@ other
  openOther = ->
    $otherText    = $given?.label ?? ''
    $otherEditing = true

  # Échap dans le champ : retour à la liste, « Autre… » active, le focus d'où l'on pilotait la liste
  cancelOther = ->
    $otherEditing = false
    $activeIndex  = $filtered.length
    target        = if searchOnOf($search) then searchInputRef else buttonRef
    target?.focus()

  # le texte est rogné puis coupé au maximum, sans scinder un caractère ; resté celui de la réponse préremplie par la page, il ne change rien (même plus long que le maximum) ; égal au libellé ou à la forme texte de la valeur d'une ligne de la liste, c'est cette ligne qui est choisie ; sinon c'est une valeur de plus, choisie comme toute ligne
  submitOther = ->
    raw = String($otherText ?? '')
    if raw == $given?.label
      closePanel()
      buttonRef?.focus()
      return
    text = cutText(raw.trim(), $otherMax)
    return unless text
    norm = normalize(text)
    opt  = $listed.find (o)-> o.norm == norm or String(o.value) == text
    v    = if opt then opt.value else text
    toggleValue(v) unless $multi and isSelected(v, $value, $multiple)
    if $multi
      $otherText = ''
      otherInputRef?.focus({ preventScroll: true })
  # @@

  # Entrée sur la ligne active : une option se coche, une réponse libre se retire, « Autre… » ouvre le champ
  chooseRow = (i)->
    if i < $filtered.length
      opt = $filtered[i]
      toggleValue(opt.value) if opt
    # @@ other
    else if $otherMax and i == $filtered.length
      openOther()
    # @@

  # flèche droite (1) ou gauche (-1), liste fermée : l'option voisine de celle qui est choisie, choisie comme à la souris ; aux bords rien, pas de boucle ; une option de même valeur est enjambée ; « Autre… » n'est pas une étape, et une réponse libre donnée n'est pas remplacée
  stepValue = (dir)->
    options = $optionsData
    i       = options.findIndex (o)-> isSelected(o.value, $value, $multiple)
    return if i < 0 and $given # @@ other
    i += dir
    i += dir while options[i] and isSelected(options[i].value, $value, $multiple)
    toggleValue(options[i].value) if options[i]

  onButtonClick = ->
    if $open then closePanel() else openPanel()

  # une composition de saisie (IME) n'envoie rien tant qu'elle dure : un seul passage à `compositionend` ; WebKit y fait suivre un dernier `input` de même texte, qui ne repart pas
  # le texte cherché ne suit le champ qu'ici : pendant une composition il garde son état d'avant
  onCompositionEnd = ->
    composing = false
    composed  = searchInputRef.value
    searchFor(composed)

  onSearchInput = ->
    return if composing
    text     = searchInputRef.value
    skip     = composed == text
    composed = null
    searchFor(text) unless skip

  searchFor = (text)->
    $query = text
    µemit 'search', $query
    $activeIndex = (if filterFn($query, $search, $match, $optionsData).length or $otherMax then 0 else -1) # @@ other
    # $activeIndex = (if filterFn($query, $search, $match, $optionsData).length then 0 else -1) # @@ !other
    queueMicrotask -> reveal($activeIndex)

  onKeydown = (e)->
    return if lockedOf($disabled, $formDisabled)
    unless $open
      # liste fermée : une lettre va à l'option qui commence par elle ; les flèches basse et haute l'ouvrent, sur l'option choisie, avec ou sans Alt, Ctrl, Méta ou Maj (Alt + flèche ouvre une liste native) ; la gauche et la droite, elles, restent au navigateur avec ces touches
      if typingOf(e)
        e.preventDefault()
        typeAhead(e)
      else if e.key == 'ArrowDown' or e.key == 'ArrowUp' or e.key == 'Enter' or e.key == ' '
        e.preventDefault()
        openPanel()
      else if (e.key == 'ArrowRight' or e.key == 'ArrowLeft') and not ($multi or e.altKey or e.ctrlKey or e.metaKey or e.shiftKey)
        e.preventDefault()
        stepValue(if e.key == 'ArrowRight' then 1 else -1)
      return
    # pendant une composition (IME) toute touche est à l'IME ; une touche franche, elle, périme le texte attendu à `compositionend`
    return if e.isComposing or e.keyCode == 229
    composed = null
    # @@ other
    if $otherEditing
      if e.key == 'Enter'
        e.preventDefault()
        submitOther()
      else if e.key == 'Escape'
        e.preventDefault()
        e.stopPropagation()
        cancelOther()
      return
    # @@
    # la saisie au vol, sauf avec `search` : les lettres vont alors au champ de recherche
    if typingOf(e) and not searchOnOf($search)
      e.preventDefault()
      typeAhead(e)
    else if e.key == 'ArrowDown'
      e.preventDefault()
      $activeIndex = Math.min($activeIndex + 1, $rowCount - 1)
      reveal($activeIndex)
    else if e.key == 'ArrowUp'
      e.preventDefault()
      $activeIndex = Math.max($activeIndex - 1, 0)
      reveal($activeIndex)
    # Page bas, Page haut : une page plus loin, bornée à la dernière ligne et à la première
    else if e.key == 'PageDown' or e.key == 'PageUp'
      e.preventDefault()
      $activeIndex = if e.key == 'PageDown' then Math.min($activeIndex + pageOf(), $rowCount - 1) else Math.max($activeIndex - pageOf(), 0)
      reveal($activeIndex)
    else if e.key == 'Home'
      e.preventDefault()
      $activeIndex = 0
      reveal($activeIndex)
    else if e.key == 'End'
      e.preventDefault()
      $activeIndex = $rowCount - 1
      reveal($activeIndex)
    else if e.key == 'Enter'
      e.preventDefault()
      chooseRow($activeIndex)
    # Espace choisit comme Entrée (coche en `multiple`), sauf dans le champ de recherche où il s'écrit ; annulé ici, le clic natif du bouton au relâchement n'a pas lieu
    else if e.key == ' ' and e.target == buttonRef
      e.preventDefault()
      chooseRow($activeIndex)
    # l'Échap pris par la liste ne remonte pas : un tiroir ou une fenêtre qui la contient reste ouvert
    else if e.key == 'Escape'
      e.preventDefault()
      e.stopPropagation()
      closePanel()
      buttonRef?.focus()
    else if e.key == 'Tab'
      closePanel()

  onWrapperClick = (e)->
    e._mjs_mjsSelectWrappers = e._mjs_mjsSelectWrappers or new Set()
    e._mjs_mjsSelectWrappers.add(wrapperRef)

  onDocumentClick = (e)->
    return unless $open
    return if e._mjs_mjsSelectWrappers?.has(wrapperRef)
    closePanel()

  # la balise <mjs-core-select> est ignorée des lecteurs d'écran, le combobox est le bouton interne : le nom
  # (`aria-label`, `aria-labelledby`) et l'erreur (`aria-invalid`) posés sur la balise, par <@@field> ou à la
  # main, lui sont reportés et le suivent. `aria-labelledby` cite des éléments de l'arbre de la balise, que
  # l'ombre du composant ne résout pas : il passe par la propriété `ariaLabelledByElements` du bouton.
  # Une étiquette qui paraît après le montage (dans un {if}) est attendue : la racine de la balise n'est
  # guettée en profondeur que le temps qu'il en manque une. Une fois toutes là, le module ne guette plus que
  # les parents (sans leur sous-arbre) de chaque étiquette et de ses ancêtres, jusqu'à la racine : une étiquette
  # retirée, puis réaffichée, est un NOUVEL élément, et la liste le retrouve. Sans `aria-labelledby`, le nom du bouton est
  # celui que pose le socle du cœur (une `<label for>`, `aria-label`), qu'un changement d'`aria-invalid` ou d'`aria-label` n'efface
  # pas : la liste ne retire que les éléments qu'elle citait elle-même, s'ils sont encore cités et que le socle ne cite rien (l'étiquette que
  # citait `aria-labelledby` peut être la `<label for>` de la liste, que le socle cite de nouveau quand `aria-labelledby` est ôté)
  syncAria = =>
    $comboLabel   = @getAttribute('aria-label')
    $comboInvalid = @getAttribute('aria-invalid')
    return if buttonRef?.ariaLabelledByElements is undefined
    root = @getRootNode()
    ids  = (@getAttribute('aria-labelledby') or '').split(/\s+/).filter(Boolean)
    unless ids.length
      now                              = buttonRef.ariaLabelledByElements
      buttonRef.ariaLabelledByElements = null if cited.length and not @_mjs_l and now?.length is cited.length and cited.every((n, i)-> n is now[i])
      cited                            = []
      labelObserver?.disconnect()
      watched = []
      return
    refs                             = ids.map((id)-> root.getElementById?(id)).filter(Boolean)
    buttonRef.ariaLabelledByElements = if refs.length then refs else null
    cited                            = refs
    deep    = refs.length < ids.length
    targets = if deep then [root] else watchTargetsOf(refs, root)
    return if deep is watchedDeep and targets.length is watched.length and targets.every((n, i)-> n is watched[i])
    labelObserver?.disconnect()
    labelObserver ||= new MutationObserver(syncAria)
    for target in targets
      labelObserver.observe(target, if deep then { childList: true, subtree: true } else { childList: true })
    watched     = targets
    watchedDeep = deep

  # les parents de chaque étiquette et de ses ancêtres, jusqu'à la racine, sans doublon
  watchTargetsOf = (refs, root)->
    targets = []
    for ref in refs
      node = ref
      while node and node isnt root and node.parentNode
        targets.push(node.parentNode) unless node.parentNode is in targets
        node = node.parentNode
    targets

  # le choix de départ, comme celui qu'on rend à la remise, est une COPIE du tableau : la page qui modifie le sien en place ne déplace pas le départ
  copyOf = (v)-> if Array.isArray(v) then v.slice() else v

  µeffect ->
    if $open and searchOnOf($search)
      queueMicrotask -> searchInputRef?.focus()

  # le choix retenu suit le texte de son option et la valeur posée par la page
  µeffect ->
    keepChosen($value, $multiple, $match, $optionsData)

  # `sticky` : l'option choisie se colle sous le champ de recherche, dont la hauteur se mesure une fois le panneau rendu
  µeffect ->
    if $open and stickyOf($sticky, $multiple)
      queueMicrotask -> wrapperRef?.querySelector('.select-panel')?.style.setProperty('--mjs-select-search-h', "#{searchInputRef?.offsetHeight ?? 0}px")

  # @@ other
  µeffect ->
    if $otherEditing
      queueMicrotask -> otherInputRef?.focus({ preventScroll: true })

  # le bloc du champ change de place quand la liste s'allonge (choix multiple) : il se remontre en entier
  µeffect ->
    if $otherEditing and $rowCount
      queueMicrotask fitOther
  # @@

  # @@ dev other
  # la production retire la réponse libre quand aucune page n'écrit `other` : une liste qui le reçoit d'un script, ici, ne l'aurait plus là-bas
  µeffect ->
    if $otherMax and not told
      told = true
      µ.warn(µ._mjs_msg('dev.selectOtherScript', {}, '<@@select> : une liste reçoit « other » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — en production, la réponse libre « Autre » ne serait pas envoyée. Écrivez « other » sur la liste dans votre page plutôt que de le poser par un script.'))
  # @@

  # @@ reprise
  # rendue par le serveur, la liste dit son choix dans sa balise (même posé par `value={…}`) : un module chargé avant la page le relit à son montage et part du bon état de départ ; le build de production n'envoie ce code qu'à une application qui reprend des pages rendues par le serveur (repères `@@`)
  # un tableau ne s'écrit que s'il ne porte que des textes et des nombres : un objet cyclique ou un BigInt faisait échouer le rendu, et une liste d'objets gonflait le HTML
  reflect = ->
    return unless µserver
    text = if Array.isArray($value) then $value.every((v)-> typeof v is 'string' or Number.isFinite(v)) and JSON.stringify($value) else ($value or $value is 0) and typeof $value isnt 'object' and String($value)
    if not text
      @@removeAttribute('value')
    else if @@getAttribute('value') isnt text
      @@setAttribute('value', text)
  # @@

  # les champs cachés du formulaire : le module en garde la liste, un champ caché de la page n'est jamais touché ni retiré
  have = []

  # refaits seulement s'ils ont changé : les poser dans la balise change le contenu du slot, donc relit les options, donc relance l'effet qui les pose ; ceux qu'un serveur a déjà écrits dans la balise
  # (page reprise, ils portent `mjs-f`, que seul le serveur écrit) sont repris à la première pose, et le champ créé dans le navigateur ne porte pas la marque
  syncHidden = =>
    want = if $name and not offOf($disabled) then fieldsOf($name, $value, $multiple, $optionsData, $otherMax, $match) else [] # @@ other
    # want = if $name and not offOf($disabled) then fieldsOf($name, $value, $multiple, $optionsData, $match) else [] # @@ !other
    have = Array.from(@querySelectorAll(':scope > [mjs-f]')) unless have.length # @@ reprise
    return if have.length == want.length and have.every((n, i)-> n.name == want[i][0] and n.value == want[i][1])
    for node in have
      node.remove()
    have = want.map((pair)=> µ._mjs_formField(@appendChild(hiddenOf(pair[0], pair[1]))))

  # une valeur posée par la page, la remise à zéro du formulaire : les champs suivent ; un geste les a déjà mis à jour avant `change` ; désactivée (`disabled`), la liste n'envoie rien, comme un <select disabled>
  µeffect =>
    $disabled
    reflect() # @@ reprise
    syncHidden()

  # désactivée pendant qu'elle est ouverte, par elle-même ou par son fieldset, la liste se ferme
  µeffect ->
    closePanel() if $open and lockedOf($disabled, $formDisabled)

  # la validité suit le choix, les options, `required` et l'état désactivé
  µeffect ->
    $required
    $disabled
    $formDisabled
    $value
    $choices
    $multi
    $match
    syncValidity()

  µmount =>
    optionsObserver = new MutationObserver(refreshOptions)
    refreshOptions()
    queueMicrotask refreshOptions
    slotRef.addEventListener('slotchange', refreshOptions)
    wrapperRef.addEventListener('click', onWrapperClick)
    hostObserver = new MutationObserver(syncAria)
    hostObserver.observe(@, { attributes: true, attributeFilter: ['aria-label', 'aria-labelledby', 'aria-invalid'] })
    syncAria()
    # un formulaire remis à zéro rend la liste à son choix de départ, comme un <select> natif, sans rien annoncer (aucun `change`) ; ce choix
    # est celui du premier rendu, lu APRÈS le montage par l'aide du cœur : une prop `value={…}` n'est posée par la page qu'à la fin de son
    # premier rendu, un cran après le montage de la liste
    µ._mjs_formReset @, ->
      start = copyOf($value)
      ->
        $value = copyOf(start)
        return
    # une `<label for>` qui vise la liste met le focus sur son bouton, comme l'étiquette d'un <select> natif (la liste ne s'ouvre pas) ; la validité de départ, le bouton posé
    µ._mjs_formLabel @, buttonRef, true
    syncValidity()

  µdestroy ->
    optionsObserver?.disconnect()
    hostObserver?.disconnect()
    labelObserver?.disconnect()
    watched = []
</script>

<!-- @@ other -->
<div class="select" @class{$otherMax}="with-other" @class{stickyOf($sticky, $multiple)}="sticky" @this=!{wrapperRef} @keydown={onKeydown(e)}>
<!-- @@ -->
<!-- @@ !other -->
<!-- <div class="select" @class{stickyOf($sticky, $multiple)}="sticky" @this=!{wrapperRef} @keydown={onKeydown(e)}> -->
<!-- @@ -->
  <span class="select-sizer" aria-hidden="true"><span>{$placeholderText}</span>{for opt in widestOf($optionsData)}<span @class{opt.group}="select-sizer-group">{if $multi}<i class="select-check"></i>{end}{if opt.icon?.src}<i class="select-icon select-img"></i>{elsif opt.icon}<i class="select-icon">{opt.icon}</i>{end}{opt.label}</span>{end}<!-- @@ other -->{if $otherMax}<span>{if $multi}<i class="select-check"></i>{end}{$otherTexts.label}</span>{end}<!-- @@ --></span>
  <button type="button" part="button" class="select-btn" @this=!{buttonRef} role="combobox" aria-haspopup="listbox" aria-expanded={$open} aria-controls={panelId} aria-activedescendant={searchOnOf($search) ? undefined : $activeDescendant} aria-label={$comboLabel} aria-invalid={$comboInvalid} aria-required={offOf($required) ? 'true' : null} disabled={lockedOf($disabled, $formDisabled) ? true : null} @click={onButtonClick()}>
    {if $currentIcon?.src}<img class="select-icon select-img" src={$currentIcon.src} alt="">{elsif $currentIcon}<span class="select-icon">{$currentIcon}</span>{end}
    <span class="select-label" @class{waitingOf($value, $multiple, $choices, $match)}="placeholder">{$currentLabel}</span>
  </button>
  {if $open}
    <div class="select-panel" part="panel" @class{$panelUp}="up" --mjs-select-panel-max={$panelMax}>
      {if searchOnOf($search)}
        <input type="text" part="search" class="select-search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={panelId} aria-activedescendant={$activeDescendant} aria-label={$searchText} placeholder={$searchText} value={$query} @this=!{searchInputRef} @input={onSearchInput()} @compositionstart={composing = true} @compositionend={onCompositionEnd()}>
      {end}
      <div class="select-list" id={panelId} role="listbox" aria-multiselectable={$multi}>
        {if $filtered.length == 0}
          <div class="select-empty">{$emptyLabel ?? tr('selectEmpty', µlang)}</div>
        {else}
          {for sec in sectionsOf($filtered) by key}
            <div class="select-section" @class{sec.grouped}="select-group" role={sec.grouped ? 'group' : 'none'} aria-label={sec.label}>
              {if sec.grouped and sec.label}<div class="select-group-label" aria-hidden="true">{sec.label}</div>{end}
              {for it in sec.items by i}
                <div class="select-option" part="option" role="option" id={optionId(it.i)} @class{it.i == $activeIndex}="active" @class{isSelected(it.value, $value, $multiple)}="selected" aria-selected={isSelected(it.value, $value, $multiple)} @click={toggleValue(it.value)} @mouseenter={hover(e, it.i)} @mousemove={hover(e, it.i)}>
                  {if $multi}<span class="select-check">{if isSelected(it.value, $value, $multiple)}{$iconChecked}{else}{$iconUnchecked}{end}</span>{end}
                  {if it.o.icon?.src}<img class="select-icon select-img" src={it.o.icon.src} alt="">{elsif it.o.icon}<span class="select-icon">{it.o.icon}</span>{end}
                  <span class="select-option-label">{it.o.label}</span>
                </div>
              {end}
            </div>
          {end}
        {end}
        <!-- @@ other -->
        {if $otherMax and not $otherEditing}
          <div class="select-option select-other" part="option other" role="option" id={optionId($filtered.length)} @class{$filtered.length == $activeIndex}="active" @class{$given}="selected" aria-selected={$given != null} @click={openOther()} @mouseenter={hover(e, $filtered.length)} @mousemove={hover(e, $filtered.length)}>
            {if $multi}<span class="select-check"></span>{end}
            <span class="select-option-label">{otherRowOf($otherTexts, $given)}</span>
          </div>
        {end}
        <!-- @@ -->
      </div>
      <!-- @@ other -->
      {if $otherMax and $otherEditing}
        <div class="select-other-edit">
          <div class="select-other-line">
            <input type="text" part="other-input" class="select-other-input" maxlength={$otherMax} aria-label={$otherTexts.placeholder} aria-describedby={otherHintId} placeholder={$otherTexts.placeholder} value=!{$otherText} @this=!{otherInputRef}>
            <button type="button" class="select-other-ok" aria-label={$otherTexts.ok} @click={submitOther()}>✔</button>
          </div>
          <div class="select-other-meta">
            <span class="select-other-hint" id={otherHintId}>{$otherTexts.hint}</span>
            <span class="select-other-count">{$otherText.length} / {$otherMax}</span>
          </div>
        </div>
      {end}
      <!-- @@ -->
    </div>
  {end}
</div>

<@document @click={onDocumentClick(e)}>
<@window @resize={updatePlacement() if $open}>

<slot @this=!{slotRef}></slot>

<style @display="inline-block">
  :host
    position: relative
    min-width: 0
    font: inherit

  .select
    position: relative
    display: inline-block
    width: 100%

  .select-btn
    display: flex
    align-items: center
    gap: 8px
    width: 100%
    box-sizing: border-box
    padding: 8px 12px
    background: var(--mjs-select-bg, var(--mjs-surface, #fff))
    color: var(--mjs-select-fg, var(--mjs-fg, #222))
    border: 1px solid var(--mjs-select-border, var(--mjs-border, #d0d0d0))
    border-radius: var(--mjs-select-radius, 6px)
    font: inherit
    text-align: left
    cursor: pointer

    &:hover:not(:disabled)
      background: var(--mjs-select-hover, var(--mjs-hover, #f2f2f2))

    &:disabled
      opacity: .5
      cursor: default

  .select-label
    flex: 1
    overflow: hidden
    white-space: nowrap
    text-overflow: ellipsis

  .select-label.placeholder, .select-search::placeholder, .select-other-input::placeholder
    color: var(--mjs-select-placeholder, color-mix(in srgb, currentColor 62%, transparent))

  .select-sizer
    display: grid
    height: 0
    max-width: var(--mjs-select-max, 22rem)
    overflow: hidden
    visibility: hidden
    pointer-events: none
    padding: 0 12px
    border-inline: 1px solid transparent

    > span
      display: flex
      gap: 8px
      grid-area: 1 / 1
      white-space: nowrap

      &.select-sizer-group
        padding-left: 8px

  .select-icon
    flex: none

  .select-img
    display: block
    width: 1.2em
    height: 1.2em
    object-fit: contain

  .select-panel
    position: absolute
    top: calc(100% + 4px)
    left: 0
    z-index: 20
    width: 100%
    max-height: var(--mjs-select-panel-max, 280px)
    overflow-y: auto
    box-sizing: border-box
    background: var(--mjs-select-panel-bg, var(--mjs-surface, #fff))
    color: var(--mjs-select-fg, var(--mjs-fg, #222))
    border: 1px solid var(--mjs-select-border, var(--mjs-border, #d0d0d0))
    border-radius: var(--mjs-select-radius, 6px)
    box-shadow: var(--mjs-select-panel-shadow, 0 10px 30px var(--mjs-shadow, rgba(0, 0, 0, .18)))

    &.up
      top: auto
      bottom: calc(100% + 4px)

  .select-search
    position: sticky
    top: 0
    box-sizing: border-box
    width: 100%
    padding: 8px 10px
    border: 0
    border-bottom: 1px solid var(--mjs-select-border, var(--mjs-border, #d0d0d0))
    font: inherit
    background: var(--mjs-select-panel-bg, var(--mjs-surface, #fff))
    color: inherit

    &:focus
      outline: none

  .select-empty
    padding: 10px 12px
    color: var(--mjs-select-fg, var(--mjs-fg, #222))
    opacity: .6
    font-size: .9em

  .select-option
    display: flex
    align-items: center
    gap: 8px
    padding: 8px 12px
    cursor: pointer

    &:hover
      background: var(--mjs-select-hover, var(--mjs-hover, #f2f2f2))

    &.active
      background: var(--mjs-select-hover, var(--mjs-hover, #f2f2f2))

    &.selected
      background: var(--mjs-select-selected, var(--mjs-selected, #e6f0ff))
      font-weight: 600

  .select-group-label
    padding: 8px 12px 4px
    font-size: .85em
    font-weight: 600
    opacity: .65
    overflow: hidden
    white-space: nowrap
    text-overflow: ellipsis

  .select-group .select-option
    padding-left: 20px

  // `sticky` : les sections perdent leur boîte pour que l'option choisie colle dans tout le panneau, pas dans sa seule section (les rôles et noms de groupe restent sur leurs balises) ; son fond est plein, posé sur celui du panneau
  .sticky .select-section
    display: contents

  .sticky .select-option.selected
    position: sticky
    top: var(--mjs-select-search-h, 0px)
    bottom: 0
    z-index: 1
    background: linear-gradient(var(--mjs-select-selected, var(--mjs-selected, #e6f0ff)), var(--mjs-select-selected, var(--mjs-selected, #e6f0ff))), var(--mjs-select-panel-bg, var(--mjs-surface, #fff))

  .sticky .select-panel[data-free] .select-option.selected
    position: static

  .select-check
    flex: none
    width: 1em

  .select-option-label
    flex: 1
    overflow: hidden
    white-space: nowrap
    text-overflow: ellipsis

  // @@ other
  .with-other .select-label
    contain: inline-size

  .with-other .select-panel
    min-width: min(16rem, 90vw)
    left: var(--mjs-select-panel-left, auto)
    right: 0

  .select-other, .select-other-edit
    border-top: 1px solid var(--mjs-select-border, var(--mjs-border, #d0d0d0))

  .select-other-edit
    padding: 8px 12px

  .select-other-line
    display: flex
    align-items: center
    gap: 8px

  .select-other-input, .select-other-ok
    padding: 6px 8px
    font: inherit
    color: inherit
    background: var(--mjs-select-panel-bg, var(--mjs-surface, #fff))
    border: 1px solid var(--mjs-select-border, var(--mjs-border, #d0d0d0))
    border-radius: var(--mjs-select-radius, 6px)

  .select-other-input
    flex: 1
    min-width: 0
    box-sizing: border-box

  .select-other-ok
    flex: none
    cursor: pointer

    &:hover
      background: var(--mjs-select-hover, var(--mjs-hover, #f2f2f2))

  .select-other-meta
    display: flex
    justify-content: space-between
    gap: 8px
    margin-top: 4px
    font-size: .8em
    opacity: .65

  .select-other-count
    flex: none
  // @@
</style>
