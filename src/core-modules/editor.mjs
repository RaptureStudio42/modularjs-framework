@formAssociated

<script module>
  # les repères `@@` (script `# @@`, gabarit `<!-- @@ -->`, style `// @@`) cernent ce qui ne sert qu'à l'attribut `answer` (le mode « répondre ») ou à un outil de la barre (`tool-link`,
  # `tool-check`) : le build de production les ôte quand aucune page n'écrit `answer`, ou quand aucune barre de l'application ne peut afficher l'outil ; le développement et la copie dans un
  # projet gardent tout (les repères y sont des commentaires), ils ne partent jamais dans le code envoyé. `!answer` est l'autre forme des lignes qui existent avec et sans `answer`, écrite en
  # commentaire et remise en code quand `answer` part. `tool-keys` cerne ce qui interroge les barres pour le raccourci du lien et des cases, `dev answer` l'avertissement du développement quand un script pose `answer`
  # alors qu'aucune page ne l'écrit. Ce qui affiche et coche une liste à cocher déjà dans la valeur (readBlocks, boxHit, toggleCheck, fixup) n'est jamais repéré : il ne dépend d'aucun outil
  # le nettoyeur : tout HTML qui entre (collage, dépôt, valeur liée) et tout ce que la surface contient devient d'abord un MODÈLE
  # de blocs, puis un HTML canonique reconstruit depuis lui ; le résultat est le même quel que soit le navigateur qui a
  # fabriqué le DOM (<b> ou <strong>, <div> ou <p>, <p><ul> mal imbriqué…), et rien d'autre que la liste permise n'en sort
  # un bloc : { k: 'p'|'h2'|'h3'|'q', r: passages } ou une liste { k: 'ul'|'ol'|'cl', i: [{ r, c, k: listes }] }
  # un passage : { t: texte ('\n' = retour à la ligne), m: marques (s gras, e italique, u souligné, d barré), h: adresse }
  DROP      = /^(script|style|noscript|template|iframe|object|embed|svg|math|head|title|textarea|select|button|input|canvas|audio|video|form|link|meta)$/
  BLOCK     = /^(p|div|pre|section|article|header|footer|main|aside|nav|figure|figcaption|address|hr|dl|dt|dd|details|summary|fieldset|center|table|thead|tbody|tfoot|tr|td|th|caption|li)$/
  MARKS     = { s: 'strong', e: 'em', u: 'u', d: 's' }
  BIG       = 20000
  PAUSE     = 150
  HEAD      = /^h[1-6]$/
  WEIGHT    = /(?:^|;)\s*font-weight\s*:\s*([a-z0-9]+)/i
  ITALIC    = /(?:^|;)\s*font-style\s*:\s*(italic|oblique)/i
  UNDERLINE = /text-decoration[^;]*underline/i
  STRIKE    = /text-decoration[^;]*line-through/i
  SCHEME    = /^([a-z][a-z0-9+.-]*:|\/|[#]|\.\.?\/|\?)/i # @@ tool-link
  MAIL      = /^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/ # @@ tool-link
  TYPING    = /^(insert(Composition)?Text|delete(Content|Word))/
  DEPTH     = 100
  UNSTICK   = 'mjs-editor-unstick'
  NOTEXT    = /^(button|submit|reset|checkbox|radio|file|image|color|range|hidden)$/

  # @@ dev answer
  answerTold = false
  # @@

  # le geste de défaire ou de refaire rendu au champ du focus (plus bas), commun à tous les éditeurs de la page : un rejeu qui retombe sur l'étape d'un autre
  # éditeur relance la même boucle, sans retirer ni remettre les éditeurs une seconde fois
  relay = null
  # le dernier geste de défaire ou de refaire que le navigateur annonce, où qu'il aille, et la sélection d'alors ; écouté une fois pour toute la page
  asked = null
  heard = false
  # les éditeurs qui ont pris par leur pile les gestes du navigateur, le focus hors de leur zone (plus bas), dans l'ordre : ces gestes refusés, le navigateur
  # n'a rien à refaire, le geste de refaire revient au dernier d'entre eux, puis à celui d'avant ; toute saisie de la page les oublie, comme elle vide la pile à
  # refaire du navigateur
  undone = []
  # l'ordre des étapes des éditeurs de la page : chacune porte l'heure d'un compteur commun, la dernière saisie hors des éditeurs aussi (`nativeAt`) ; le geste
  # de défaire pris hors de toute zone où l'on écrit va à l'étape la plus récente, comme le faisait la pile du navigateur : une saisie hors des éditeurs plus
  # récente revient au navigateur
  clock    = 0
  nativeAt = 0
  editors  = new Set()
  # les composants tiers à ombre fermée qui ont reçu une frappe (plus bas)
  typed    = new WeakSet()


  # un geste de défaire qu'aucun éditeur n'a pris (le navigateur l'a fait lui-même) : il a défait la saisie hors des éditeurs
  noteAsked = (e)->
    return noteTyped() unless /^history(Undo|Redo)$/.test(e.inputType ?? '')
    sel   = document.getSelection()
    r     = if sel?.rangeCount then sel.getRangeAt(0) else null
    asked = { t: e.inputType, r: r and { startContainer: r.startContainer, startOffset: r.startOffset, endContainer: r.endContainer, endOffset: r.endOffset } }
    setTimeout((->
      asked    = null
      nativeAt = 0 if e.inputType == 'historyUndo' and not e.defaultPrevented
    ), 0)

  # une saisie de la page oublie ce qui restait à refaire hors des zones ; hors des éditeurs, elle prend l'heure du compteur commun, et la balise opaque
  # d'un composant tiers qui la reçoit devient un champ où l'on écrit
  noteTyped = ->
    undone = []
    at     = focusAt()
    return if not at or editorOf(at)
    nativeAt = ++clock
    typed.add(at) if opaque(at)

  # Ctrl+Maj+Z, Cmd+Maj+Z ou Ctrl+Y qu'aucune zone d'édition n'a pris : le dernier éditeur qui a pris un geste du navigateur refait par sa pile, puis celui
  # d'avant ; un éditeur qui n'a plus rien à refaire est passé
  onRedoKey = (e)->
    return if e.defaultPrevented or e.isComposing or e.altKey or not (e.ctrlKey or e.metaKey)
    k = e.key?.toLowerCase()
    return unless (if e.shiftKey then k == 'z' else k == 'y' and e.ctrlKey)
    undone.pop() while undone.length and not undone[undone.length - 1].left()
    ed = undone[undone.length - 1]
    if ed?.redo()
      undone.pop()
      e.preventDefault()

  # l'éditeur qui prend le geste de défaire, le focus hors de toute zone où l'on écrit : celui qui a le focus (sa barre, un lien de sa zone), sinon celui
  # dont l'étape est la plus récente ; aucun quand plus aucun éditeur n'a d'étape, ou qu'une saisie hors des éditeurs est plus récente (le geste revient au navigateur)
  pick = ->
    best = null
    for ed in Array.from(editors)
      return ed if ed.has()
      best = ed if ed.at() > (best?.at() ?? 0)
    if best?.at() > nativeAt then best else null

  # l'`input` natif d'un geste de défaire ou de refaire que le navigateur a fait lui-même dans un éditeur, sans le lui annoncer (Firefox, la sélection dans
  # une autre zone ; un `execCommand` de la page) : l'éditeur remet son texte (plus bas), rien n'a changé, et l'événement ne part vers aucun écouteur de la
  # page — arrêté à la capture de la fenêtre, avant ceux du document
  holdUndo = (e)->
    return unless /^history(Undo|Redo)$/.test(e.inputType ?? '')
    for ed in Array.from(editors)
      continue unless ed.hit()
      e.stopImmediatePropagation()
      ed.keep()
      return

  # l'élément qui a le focus, cherché à travers les ombres (celle d'un composant est fermée : `_shadow`)
  focusAt = ->
    a = document.activeElement
    a = (a._shadow ?? a.shadowRoot).activeElement while (a?._shadow ?? a?.shadowRoot)?.activeElement
    a

  # la balise de l'éditeur où est un nœud (sa zone, sa barre, un lien de sa zone), avec ou sans ombre (`@lightDom`) ; aucune hors des éditeurs
  editorOf = (n)->
    n = n.parentNode ?? n.host while n and n.localName != 'mjs-core-editor'
    n

  # la balise d'un composant tiers qui garde le focus dans son ombre fermée (elle n'est pas focalisable elle-même) : rien ne dit ce qu'elle cache
  opaque = (el)-> el.localName.includes('-') and not (el._shadow ?? el.shadowRoot) and not el.hasAttribute('tabindex')

  # un champ où l'on écrit : le geste de défaire lui revient ; la balise opaque d'un composant tiers aussi, quand elle a reçu une frappe (un bouton ou une
  # case de son ombre n'en reçoivent pas)
  writable = (el)->
    return false unless el
    return true if el.isContentEditable
    return typed.has(el) if opaque(el)
    (el.localName == 'textarea' or (el.localName == 'input' and not NOTEXT.test(el.type))) and not el.readOnly


  # une adresse sans schéma est relative, donc permise ; avec un schéma, seuls http, https, mailto et tel passent
  # (les contrôles sont retirés d'abord : « java\tscript: » est lu « javascript: » par le navigateur)
  safeUrl = (v)->
    return null unless v
    u = String(v).replace(/[\u0000-\u001f\u007f-\u009f\u200b\ufeff]/g, '').trim().replace(/ /g, '%20')
    return null unless u
    m = /^([a-z][a-z0-9+.-]*):/i.exec(u)
    return null if m and not /^(https?|mailto|tel)$/i.test(m[1])
    u

  # @@ tool-link
  # ce que l'auteur tape dans le champ d'adresse : « exemple.fr » devient https://exemple.fr, « a@b.fr » un mailto
  urlOf = (raw)->
    v = (raw ?? '').trim()
    return '' unless v
    return v if SCHEME.test(v)
    return 'mailto:' + v if MAIL.test(v)
    'https://' + v
  # @@


  # les marques d'une balise : son nom, et son style quand il parle (Word, Docs et les pages web écrivent du gras en
  # <span style="font-weight:700"> ; le <b style="font-weight:normal"> que Docs pose autour d'un collage n'est PAS du gras)
  marksOf = (el, m)->
    tag  = el.localName
    st   = el.getAttribute('style') ?? ''
    w    = (WEIGHT.exec(st) ?? [])[1]?.toLowerCase()
    bold = tag == 'b' or tag == 'strong'
    if w
      bold = w == 'bold' or w == 'bolder' or Number(w) >= 600
      m = m.replace('s', '') unless bold
    m += 's' if bold and not m.includes('s')
    m += 'e' if (tag == 'i' or tag == 'em' or tag == 'cite' or ITALIC.test(st)) and not m.includes('e')
    m += 'u' if (tag == 'u' or tag == 'ins' or UNDERLINE.test(st)) and not m.includes('u')
    m += 'd' if (tag == 's' or tag == 'strike' or tag == 'del' or STRIKE.test(st)) and not m.includes('d')
    m

  # un bloc fait de ses passages en ligne, les retours à la ligne des blocs imbriqués mis bout à bout
  inlineOf = (node)->
    out = []
    for b in readBlocks(node)
      continue unless b.r
      out.push({ t: '\n', m: '', h: null }) if out.length
      for r in b.r
        out.push(r)
    out

  # @@ answer
  # le nom caché d'une ligne à cocher est l'attribut `data-key` de sa ligne, lu dans le modèle (`key` de chaque ligne d'une liste à cocher) : une lettre minuscule puis trois caractères [a-z0-9], jamais que des chiffres
  # (une position, elle, n'est que des chiffres). Le mode « répondre » retient les cases cochées par ce nom ; l'éditeur de l'auteur (outil des cases) en donne un neuf à toute ligne qui n'en a pas et renomme tout doublon.
  # Sa lecture et son écriture servent aux deux : leurs lignes sont écrites deux fois, sous `answer` puis en commentaire sous `tool-check` et `!answer` (remises en code quand `answer` part et que l'outil reste)
  isKey = (s)-> typeof s == 'string' and /^[a-z][a-z0-9]{3}$/.test(s)

  keyOf = (li)->
    k = li.getAttribute('data-key')
    if isKey(k) then k else null
  # @@
  # @@ tool-check
  # @@ !answer
  # isKey = (s)-> typeof s == 'string' and /^[a-z][a-z0-9]{3}$/.test(s)
  #
  # keyOf = (li)->
  #   k = li.getAttribute('data-key')
  #   if isKey(k) then k else null
  # @@
  # @@

  readItem = (li)->
    box  = li.querySelector(':scope > input[type=checkbox]')
    c    = (li.hasAttribute('data-checked') and li.getAttribute('data-checked') != 'false') or !!box?.hasAttribute('checked')
    runs = []
    subs = []
    for b in readBlocks(li)
      if b.r
        runs.push({ t: '\n', m: '', h: null }) if runs.length
        for r in b.r
          runs.push(r)
      else if b.i
        subs.push(b)
    { r: runs, c: c, box: !!box, k: subs }

  readList = (el)->
    check = el.localName == 'ul' and el.hasAttribute('data-checklist') and el.getAttribute('data-checklist') != 'false'
    items = []
    for li in el.children
      if li.localName == 'ul' or li.localName == 'ol'
        items.push({ r: [], c: false, box: false, k: [] }) unless items.length
        items[items.length - 1].k.push(readList(li))
        continue
      continue unless li.localName == 'li'
      item = readItem(li)
      item.key = keyOf(li) # @@ answer
      # @@ tool-check
      # @@ !answer
      # item.key = keyOf(li)
      # @@
      # @@
      check = true if item.box
      items.push(item)
    { k: (if check then 'cl' else el.localName), i: items }

  # dans un <pre> chaque retour à la ligne du texte est un retour à la ligne du modèle (ailleurs, c'est un blanc qui se replie)
  readBlocks = (parent)->
    out   = []
    runs  = null
    pre   = 0
    flush = ->
      out.push({ k: 'p', r: runs }) if runs
      runs = null
    walk  = (node, m, h)->
      if node.nodeType == 3
        t = node.nodeValue.replace(/[\u200b\ufeff]/g, '')
        if pre and t.includes('\n')
          lines = t.split(/\r?\n/)
          for i in [0...lines.length]
            (runs ?= []).push({ t: '\n', m: m, h: h }) if i
            (runs ?= []).push({ t: lines[i], m: m, h: h }) if lines[i]
        else
          (runs ?= []).push({ t: t, m: m, h: h }) if t
        return
      return unless node.nodeType == 1
      tag = node.localName
      return if DROP.test(tag)
      if tag == 'br'
        (runs ?= []).push({ t: '\n', m: m, h: h })
      else if tag == 'ul' or tag == 'ol'
        flush()
        out.push(readList(node))
      else if HEAD.test(tag)
        flush()
        out.push({ k: (if tag == 'h1' or tag == 'h2' then 'h2' else 'h3'), r: inlineOf(node) })
      else if tag == 'blockquote'
        flush()
        for b in readBlocks(node)
          out.push(if b.k == 'p' then { k: 'q', r: b.r } else b)
      else if BLOCK.test(tag)
        flush()
        pre++ if tag == 'pre'
        for c in node.childNodes
          walk(c, m, h)
        pre-- if tag == 'pre'
        flush()
      else
        h2 = if tag == 'a' then (safeUrl(node.getAttribute('href')) ?? h) else h
        for c in node.childNodes
          walk(c, marksOf(node, m), h2)
    for c in parent.childNodes
      walk(c, '', null)
    flush()
    out


  esc  = (s)-> s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  escA = (s)-> esc(s).replace(/"/g, '&quot;')

  # le dernier passage perd son blanc de queue ; s'il n'était que ce blanc il tombe, et le précédent est rogné à son tour (jamais de
  # passage vide : runsHtml l'envelopperait d'une balise vide)
  trimEnd = (out)->
    while out.length
      last = out[out.length - 1]
      return if last.t == '\n'
      last.t = last.t.replace(/ $/, '')
      return if last.t
      out.pop()

  # les blancs se replient en un seul, tombent en début et en fin de ligne ; les retours à la ligne de tête et de queue aussi
  tidy = (runs)->
    out   = []
    start = true
    for r in runs
      last = out[out.length - 1]
      if r.t == '\n'
        trimEnd(out)
        out.push(r) if out.length
        start = true
      else
        t = r.t.replace(/\s+/g, ' ')
        t = t.replace(/^ /, '') if start or (last and last.t.endsWith(' '))
        if t
          out.push({ t: t, m: r.m, h: r.h })
          start = false
    out.pop() while out.length and out[out.length - 1].t == '\n'
    trimEnd(out)
    out

  openTag  = (w)-> if w.startsWith('a:') then '<a href="' + escA(w.slice(2)) + '">' else '<' + MARKS[w] + '>'
  closeTag = (w)-> if w.startsWith('a:') then '</a>' else '</' + MARKS[w] + '>'

  # les passages en HTML : une pile de balises ouvertes, comparée à celle que veut chaque passage (lien dehors, puis
  # gras, italique, souligné, barré), ne ferme et n'ouvre que la différence — pas de <strong></strong><strong> en miettes
  runsHtml = (runs)->
    html = ''
    open = []
    for r in tidy(runs)
      if r.t == '\n'
        html += '<br>'
        continue
      want = []
      want.push('a:' + r.h) if r.h
      for k in ['s', 'e', 'u', 'd']
        want.push(k) if r.m.includes(k)
      i = 0
      i++ while i < open.length and i < want.length and open[i] == want[i]
      html += closeTag(open.pop()) while open.length > i
      for w in want.slice(i)
        html += openTag(w)
        open.push(w)
      html += esc(r.t)
    html += closeTag(open.pop()) while open.length
    html

  # @@ answer
  # en mode « répondre » (`ctx`), la case d'une ligne est un élément focalisable qui porte le rôle et l'état, en tête de sa ligne de liste : un rôle
  # `checkbox` sur la ligne elle-même cacherait ses sous-listes aux lecteurs d'écran. Le texte de la ligne est posé à côté de la case et lui donne son
  # nom (`aria-labelledby`, par la position `n` de la case) : dans la case, un lien du texte serait un contrôle dans un contrôle
  lineTag = (id, n, ctx)->
    '<span class="line" role="checkbox" aria-checked="' + ctx.set.includes(id) + '" aria-labelledby="mjs-line-' + n + '"' + (if ctx.off then ' aria-disabled="true"' else ' tabindex="0"') + (if ctx.ro then ' aria-readonly="true"' else '') + '></span>'
  # @@

  # `ctx` est absent pour la valeur de l'éditeur ; en mode « répondre » il numérote les cases dans l'ordre du document (la ligne d'abord, puis
  # ses sous-listes) et dit lesquelles sont cochées : l'état du modèle (`data-checked`) n'y est jamais lu
  listHtml = (b, ctx)->
    tag   = if b.k == 'ol' then 'ol' else 'ul'
    items = ''
    for it in b.i
      own = runsHtml(it.r)
      # @@ answer
      # en mode « répondre » chaque case est désignée (`ctx.ids`) par son nom, ou par sa position quand elle n'en a pas ou que son nom est déjà celui d'une ligne plus haute ; sans `ctx`, le nom d'une ligne à cocher est réécrit avec elle
      if ctx and b.k == 'cl'
        n     = if own then ctx.n++ else -1
        id    = if n < 0 or not it.key or ctx.ids.includes(it.key) then n else it.key
        ctx.ids.push(id) if n >= 0
        head  = if own then lineTag(id, n, ctx) + '<span class="line-text" id="mjs-line-' + n + '">' + own + '</span>' else ''
        attrs = if n < 0 then ' class="bare"' else (if ctx.set.includes(id) then ' data-checked' else '')
      else
        head  = own
        attrs = if b.k == 'cl' and it.c then ' data-checked' else ''
        attrs = ' data-key="' + it.key + '"' + attrs if b.k == 'cl' and it.key
      # @@
      # @@ !answer
      # head  = own
      # attrs = if b.k == 'cl' and it.c then ' data-checked' else ''
      # @@
      # @@ tool-check
      # @@ !answer
      # attrs = ' data-key="' + it.key + '"' + attrs if b.k == 'cl' and it.key
      # @@
      # @@
      inner = head + it.k.map((s)-> listHtml(s, ctx)).join('')
      continue unless inner
      items += '<li' + attrs + '>' + inner + '</li>'
    if items then '<' + tag + (if b.k == 'cl' then ' data-checklist' else '') + '>' + items + '</' + tag + '>' else ''

  blocksHtml = (blocks, ctx)->
    html = ''
    i    = 0
    while i < blocks.length
      b = blocks[i]
      if b.k == 'q'
        inner = ''
        while i < blocks.length and blocks[i].k == 'q'
          t = runsHtml(blocks[i].r)
          inner += '<p>' + t + '</p>' if t
          i++
        html += '<blockquote>' + inner + '</blockquote>' if inner
        continue
      i++
      if b.i
        html += listHtml(b, ctx)
      else
        t = runsHtml(b.r)
        html += '<' + b.k + '>' + t + '</' + b.k + '>' if t
    html

  htmlOf = (parent)-> blocksHtml(readBlocks(parent))


  # le HTML d'entrée est lu dans un <template> : inerte, rien ne s'y exécute ni ne s'y charge
  parse = (html)->
    t = document.createElement('template')
    t.innerHTML = html
    readBlocks(t.content)

  clean = (html)-> blocksHtml(parse(html))

  answerHtml = (html, ctx)-> blocksHtml(parse(html), ctx) # @@ answer

  textHtml = (text)->
    text.split(/\r?\n\s*\r?\n/).map((p)-> p.trim()).filter(Boolean).map((p)-> '<p>' + esc(p).replace(/\r?\n/g, '<br>') + '</p>').join('')


  # @@ answer
  # les cases cochées que la page donne par `checked` : le nom de chaque ligne (un texte), ou la position d'une ligne sans nom (un entier 0, 1, 2… ou son texte), sans doublon ; tout le reste est ignoré
  keysOf = (list)->
    return [] unless Array.isArray(list)
    out = []
    for v in list
      n = if typeof v == 'string' and /^\d+$/.test(v) then Number(v) else v
      out.push(n) if ((Number.isInteger(n) and n >= 0) or isKey(n)) and not out.includes(n)
    out
  # @@

  # @@ tool-check
  # la ligne a-t-elle du texte à elle (hors de ses sous-listes) ?
  hasText = (li)->
    for n in li.childNodes
      continue if n.nodeType == 1 and (n.localName == 'ul' or n.localName == 'ol')
      return true if /[^\s\u200b\ufeff]/.test(n.textContent)
    false

  # un nom neuf : une lettre minuscule puis trois caractères [a-z0-9]
  newKey = -> String.fromCharCode(97 + Math.floor(Math.random() * 26)) + Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')
  # @@


  # la plage de la sélection, lue à travers l'ombre du module (Chromium, Firefox, Safari récents) ; sinon l'ancienne forme
  rangeIn = (sel, root)->
    if sel.getComposedRanges
      try
        return sel.getComposedRanges({ shadowRoots: [root] })[0]
      catch err
        return sel.getComposedRanges(root)[0]
    if root.getSelection
      s = root.getSelection()
      return if s?.rangeCount then s.getRangeAt(0) else null
    if sel.rangeCount then sel.getRangeAt(0) else null

  # le nœud où le curseur se tient vraiment : une plage posée entre deux nœuds (Chromium après avoir fabriqué une liste,
  # un « tout sélectionner »…) se lit dans le premier texte qui la suit, sinon dans le dernier qui la précède
  caretNode = (r)->
    n = r.startContainer
    if n.nodeType == 3
      return n if r.collapsed or r.startOffset < n.nodeValue.length
      w = n.ownerDocument.createTreeWalker(n.getRootNode(), 4)
      w.currentNode = n
      return w.nextNode() ?? n
    c = n.childNodes[r.startOffset]
    if c
      c = c.firstChild while c.firstChild
      return c
    c = n.childNodes[r.startOffset - 1]
    return n unless c
    c = c.lastChild while c.lastChild
    c

  upTo = (node, tag, stop)->
    n = node
    n = n.parentNode if n and n.nodeType == 3
    while n and n != stop
      return n if n.localName == tag
      n = n.parentNode
    null

  cssStr = (s)-> '"' + String(s).replace(/["\\]/g, '\\$&') + '"'
</script>

<script>
  $name        = ''
  $value       = ''
  $placeholder = null
  $label       = null
  $toolbar     = null
  $paste       = null
  $readonly    = false
  $disabled    = false
  $required    = false
  $answer      = false # @@ answer
  $checked     = null # @@ answer


  $raw      = ''
  $empty    = true
  $focused  = false
  $announce = ''
  $linkOpen = false # @@ tool-link
  $linkUrl  = '' # @@ tool-link
  $linkHas  = false # @@ tool-link


  $hostLabel    = null
  $hostInvalid  = null
  $formDisabled = false


  surface    = null
  linkRef    = null # @@ tool-link
  resetForm  = null
  textField  = null
  inSync     = null
  inMode     = '' # @@ answer
  canon      = ''
  atFocus    = ''
  savedRange = null
  linkRange  = null # @@ tool-link
  dragging   = false
  waiting    = 0
  running    = false
  tickSet    = [] # @@ answer
  lineIds    = [] # @@ answer


  # la pile d'annulation de CET éditeur (plus bas) : les états d'avant (`past`), les états défaits (`ahead`), l'état d'avant du changement qui
  # s'annonce (`pending`, de genre `opened`), le genre de la dernière étape (`streak`), le curseur que la dernière frappe a laissé (`caretAt`) et l'heure
  # de la dernière étape que le navigateur a vue naître (`sealed`, défaite ou non)
  past    = []
  ahead   = []
  pending = null
  opened  = ''
  streak  = ''
  caretAt = ''
  acting  = false
  lineSeq = 0
  sealed  = 0

  # la pile oubliée : une valeur posée par la page, la remise à zéro du formulaire (comme un champ de texte natif dont la page change la valeur)
  forget = ->
    past    = []
    ahead   = []
    pending = null
    streak  = ''


  tr = (key, lang)-> µ._mjs_label('core', key) ?? ''

  on = (v)-> v !== undefined and v !== null and v !== false and v !== 'false'
  # `required` : « false », quelle que soit sa casse, le laisse faux (le rendu serveur la lit ici, sans le socle du cœur qui l'ôte dans le navigateur)
  must = (v)-> on(v) and String(v).toLowerCase() !== 'false'


  $off    = on($disabled) or $formDisabled
  $ro     = on($readonly)
  $ans    = on($answer) # @@ answer
  $edit   = not $off and not $ro and not $ans # @@ answer
  $tick   = $ans and not $off and not $ro # @@ answer
  $textRo = $ro and not $ans # @@ answer
  # @@ !answer
  # $edit = not $off and not $ro
  # @@


  $labelText       = $label ?? tr('editorLabel', µlang)
  $placeholderText = $placeholder ?? (if $ans then '' else tr('editorPlaceholder', µlang)) # @@ answer
  # @@ !answer
  # $placeholderText = $placeholder ?? tr('editorPlaceholder', µlang)
  # @@

  # le nom de la zone : celui que la balise porte (`aria-label` posé par <@@field> ou à la main), sinon `label`, sinon le texte par défaut
  $nameText = $hostLabel or (if $ans then $label else $labelText) # @@ answer
  # @@ !answer
  # $nameText = $hostLabel or $labelText
  # @@

  # la barre intégrée : tous les outils par défaut, `toolbar="none"` n'en met aucune (une barre séparée la remplace) ; la liste, texte ou tableau de noms, va telle quelle à la barre
  $barTools = if $toolbar == 'none' then null else ($toolbar or '')

  textsOf = (lang)->
    {
      link:   tr('linkLabel', lang) # @@ tool-link
      apply:  tr('linkApply', lang) # @@ tool-link
      remove: tr('linkRemove', lang) # @@ tool-link
      cancel: tr('linkCancel', lang) # @@ tool-link
      on:     cssStr(tr('boxChecked', lang))
      off:    cssStr(tr('boxUnchecked', lang))
    }

  $t = textsOf(µlang)


  # le champ du formulaire : le HTML propre, dans un champ caché que le module écrit lui-même et dont il garde la liste ; en mode « répondre » un champ par
  # case cochée (sa désignation : le nom de sa ligne, ou sa position), jamais le texte. Les champs déjà écrits dans la balise (page rendue par le serveur, ils portent `mjs-f`, que seul le serveur écrit)
  # sont repris, jamais doublés : leur recherche comme l'écriture de la marque ne partent en production que vers une application qui reprend des pages rendues
  # par le serveur (repères `@@`) ; un champ caché de la page n'est jamais touché. Chaque champ suit le `form="id"` de la balise (l'aide du cœur le lui recopie) :
  # il part avec le formulaire visé, où qu'il soit dans la page, comme une zone de texte native
  fieldValues = ->
    return [] unless $name and not $off
    # @@ answer
    return [canon] unless $ans
    lineIds.filter((id)-> tickSet.includes(id)).map(String)
    # @@
    # @@ !answer
    # [canon]
    # @@

  fields = []

  syncHidden = ->
    want = fieldValues()
    fields = Array.from(@@querySelectorAll(':scope > [mjs-f]')) unless fields.length # @@ reprise
    fields.pop().remove() while fields.length > want.length
    for i in [0...want.length]
      field = fields[i]
      unless field
        field = document.createElement('input')
        field.type = 'hidden'
        field.setAttribute('mjs-f', '') if µserver # @@ reprise
        @@appendChild(field)
        fields.push(field)
      field.name  = $name
      field.value = want[i]
      µ._mjs_formField field

  µeffect ->
    $name
    $off
    $ans # @@ answer
    syncHidden()

  # obligatoire (`required`) : une zone vide (rien qu'un blanc ou des balises vides, une fois nettoyée) manque, comme une zone de texte native vide — sauf
  # quand on ne peut pas y écrire (désactivée, par elle-même ou par un `<fieldset disabled>`, en lecture seule, en mode « répondre ») : le formulaire le sait, avec
  # le message que le navigateur donne à une zone de texte native. Le socle du cœur le lit sur la `<textarea>` invisible de l'ombre, qui porte aussi la bulle :
  # une zone `contenteditable` qui la porterait ne prend plus la frappe sous WebKit tant que la bulle est là ; le focus que la bulle lui donne va à la zone d'édition
  @syncValidity = ->
    µ._mjs_formValid @, textField, must($required) and $empty and $edit

  µeffect ->
    $required
    $empty
    $edit
    @@syncValidity()


  # @@ answer
  # les cases cochées : la page les pose par `checked` et le module ne les réécrit qu'au premier geste (la valeur est alors nettoyée) ;
  # le texte de la surface n'en dépend pas, seul son dessin est mis à jour
  syncTicks = ->
    return unless surface and $ans
    lines = surface.querySelectorAll('.line')
    for i in [0...lines.length]
      ticked = tickSet.includes(lineIds[i])
      lines[i].setAttribute('aria-checked', String(ticked))
      lines[i].parentNode.toggleAttribute('data-checked', ticked)

  µeffect ->
    tickSet = keysOf($checked)
    syncTicks()
    syncHidden()
  # @@


  # la valeur liée : ce qui vient du dehors est nettoyé puis posé dans la surface ; ce que le module vient d'envoyer lui-même ne la
  # réécrit pas (le curseur ne bouge jamais sous la frappe). En mode « répondre » le texte est le modèle de l'auteur, jamais modifié
  # @@ answer
  µeffect ->
    v    = if $value? then String($value) else ''
    mode = if $ans then ['a', $off, $ro].join() else 'e'
    return if v == inSync and mode == inMode
    inSync = v
    inMode = mode
    if $ans
      ctx     = { n: 0, ids: [], set: tickSet, off: $off, ro: $ro }
      built   = answerHtml(v, ctx)
      $raw    = built
      $empty  = not built
      lineIds = ctx.ids
      canon   = ''
    else
      html    = clean(v)
      canon   = html
      $raw    = html or '<p><br></p>'
      $empty  = not html
      lineIds = []
    forget()
    syncHidden()
    setTimeout(emitState, 0)
    setTimeout(decorate, 0)
    setTimeout(syncTicks, 0)
  # @@
  # @@ !answer
  # µeffect ->
  #   v = if $value? then String($value) else ''
  #   return if v == inSync
  #   inSync = v
  #   html   = clean(v)
  #   canon  = html
  #   $raw   = html or '<p><br></p>'
  #   $empty = not html
  #   forget()
  #   syncHidden()
  #   setTimeout(emitState, 0)
  #   setTimeout(decorate, 0)
  # @@

  µeffect ->
    $edit
    setTimeout(emitState, 0)

  # @@ dev answer
  # la production retire le mode « répondre » quand aucune page n'écrit `answer` : un éditeur qui le reçoit d'un script, ici, ne l'aurait plus là-bas
  µeffect ->
    if $ans and not answerTold
      answerTold = true
      µ.warn(µ._mjs_msg('dev.editorAnswerScript', {}, '<@@editor> : un éditeur reçoit « answer » d\'un script, mais aucune page de l\'application n\'écrit cet attribut — en production, le mode « répondre » ne serait pas envoyé. Écrivez « answer » sur l\'éditeur dans votre page plutôt que de le poser par un script.'))
  # @@


  # la sélection et l'état des boutons
  rangeNow = ->
    return null unless surface
    sel = document.getSelection()
    return null unless sel
    r = rangeIn(sel, surface.getRootNode())
    if r and surface.contains(r.startContainer) then r else null

  restoreRange = (r)->
    document.getSelection().setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset)

  caretOf = ->
    r = rangeNow()
    if r then caretNode(r) else null

  liAt = ->
    upTo(caretOf(), 'li', surface)

  stateNow = ->
    st = { bold: false, italic: false, underline: false, strike: false, h2: false, h3: false, quote: false, ul: false, ol: false, check: false, link: false, inList: false, frozen: not $edit, undo: past.length > 0, redo: ahead.length > 0 }
    r = rangeNow()
    return st unless r
    n = caretNode(r)
    n = n.parentNode if n.nodeType == 3
    listed = false
    while n and n != surface
      tag = n.localName
      st.bold      = true if tag == 'b' or tag == 'strong'
      st.italic    = true if tag == 'i' or tag == 'em'
      st.underline = true if tag == 'u'
      st.strike    = true if tag == 's' or tag == 'strike' or tag == 'del'
      st.link      = true if tag == 'a'
      st.h2        = true if tag == 'h2'
      st.h3        = true if tag == 'h3'
      st.quote     = true if tag == 'blockquote'
      if (tag == 'ul' or tag == 'ol') and not listed
        listed = true
        if tag == 'ol' then st.ol = true
        else if n.hasAttribute('data-checklist') then st.check = true
        else st.ul = true
      st.inList = true if tag == 'li'
      n = n.parentNode
    st

  emitState = ->
    @@dispatchEvent(new CustomEvent('mjs-editor-state', { detail: stateNow() }))

  onSelection = ->
    r = rangeNow()
    return unless r
    savedRange = r
    emitState()

  # l'état d'une case n'est qu'un dessin pour un lecteur d'écran : chaque ligne d'une liste à cocher en reçoit la description
  # (attribut de la surface seulement, la valeur envoyée ne le porte jamais) ; en mode « répondre » le rôle `checkbox` le dit déjà
  decorate = ->
    return unless surface
    return if $ans # @@ answer
    yes = tr('boxChecked', µlang)
    no  = tr('boxUnchecked', µlang)
    for li in surface.querySelectorAll('ul[data-checklist] > li')
      li.setAttribute('aria-description', if li.hasAttribute('data-checked') then yes else no)

  # la description des cases dit « cochée » dans la langue de la page : une bascule de langue la réécrit
  µeffect ->
    $t
    setTimeout(decorate, 0)


  # ce que la surface devient à chaque modification
  touch = ->
    surface.dispatchEvent(new Event('input', { bubbles: true }))

  setAnnounce = (msg)->
    $announce = msg

  say = (msg)->
    $announce = ''
    setTimeout((-> setAnnounce(msg)), 30)

  # entrée dans une case cochée : la nouvelle ligne naît décochée (le navigateur recopie les attributs de la ligne coupée)
  fixup = (e)->
    return unless e.inputType == 'insertParagraph'
    cur = liAt()
    return unless cur?.parentNode?.hasAttribute?('data-checklist')
    prev = cur.previousElementSibling
    if prev?.localName == 'li' and prev.hasAttribute('data-checked') and not prev.textContent.trim()
      prev.removeAttribute('data-checked')
    else
      cur.removeAttribute('data-checked')

  # @@ tool-check
  # le nom caché de chaque ligne à cocher de la surface (`data-key`), posé avant que son HTML soit relu, par un éditeur dont la barre montre l'outil des cases (la sienne, ou la <@@toolbar for> qui le vise : la même règle que le raccourci
  # des cases, en développement comme en production) : une ligne qui a du texte et pas de nom, ou dont le nom est aussi celui d'une autre ligne
  # (Entrée au milieu d'une ligne, ligne copiée, texte collé), en reçoit un neuf. Entre deux lignes de même nom, celle qui le portait déjà au passage précédent (`owned`, par nœud, relevé après chaque passage et juste avant un collage ou un dépôt) le garde, où qu'elle soit : une copie collée
  # au-dessus de l'originale reçoit le neuf, et annuler le collage laisse l'original sous son nom ; si aucune des deux n'est connue (texte venu du serveur), la plus haute le garde. Une ligne sans texte (la copie vide que le navigateur
  # laisse au-dessus d'une ligne coupée au début) ne porte le nom de personne : elle perd celui qu'une ligne qui a du texte porte, et garde le sien sinon (le texte effacé puis retapé retrouve sa ligne) ; un nom neuf n'est jamais celui d'une autre ligne
  # le nom qu'une ligne sans texte a dû rendre (`lost`, par nœud) lui revient si du texte y atterrit sans nom et que nulle ligne avec texte ne le porte : Firefox, en annulant Entrée au début d'une ligne, remet le texte dans la copie vide, pas dans l'originale
  owned = new WeakMap()
  lost  = new WeakMap()
  own = ->
    for li in surface.querySelectorAll('ul[data-checklist] > li')
      k = keyOf(li)
      if k then owned.set(li, k)
      else owned.delete(li)

  nameLines = ->
    used  = new Set()
    held  = new Map()
    text  = []
    todo  = []
    blank = []
    lines = surface.querySelectorAll('ul[data-checklist] > li')
    for li in lines
      if hasText(li) then text.push(li)
      else blank.push(li)
    for li in text
      k = keyOf(li)
      continue unless k
      lost.delete(li)
      h = held.get(k)
      held.set(k, li) if not h or (owned.get(li) == k and owned.get(h) != k)
    for li in text
      k = keyOf(li)
      g = lost.get(li)
      unless k or not g or held.has(g)
        li.setAttribute('data-key', g)
        held.set(g, li)
        lost.delete(li)
        k = g
      if k and held.get(k) == li then used.add(k)
      else todo.push(li)
    for li in blank
      k = keyOf(li)
      if k and not used.has(k) then used.add(k)
      else
        lost.set(li, k) if k
        li.removeAttribute('data-key')
    for li in todo
      k = newKey()
      k = newKey() while used.has(k)
      used.add(k)
      li.setAttribute('data-key', k)
    own()
  # @@

  # au-delà de BIG caractères de HTML propre, la frappe (texte tapé ou effacé) attend PAUSE ms de calme avant de reconstruire tout le document : le navigateur seul
  # en prend déjà 15 ms par touche à 278 Ko, la reconstruction 29 de plus. Tout autre geste (mise en forme, collage, annulation, Entrée), `blur`, l'envoi du
  # formulaire (`submit`, et la lecture de ses champs, `formdata`) et la destruction reconstruisent tout de suite
  rebuild = ->
    clearTimeout(waiting)
    waiting = 0
    decorate()
    nameLines() if barShows('check') # @@ tool-check
    html   = htmlOf(surface)
    $empty = not html
    if html != canon
      canon  = html
      inSync = html
      $value = html
      syncHidden()
      µemit 'input', html
    emitState()

  onInput = (e)->
    e.stopPropagation()
    return keepText() if /^history/.test(e.inputType ?? '')
    fresh   = seal()
    caretAt = spotKey()
    fixup(e)
    if canon.length > BIG and not running and TYPING.test(e.inputType ?? '')
      clearTimeout(waiting)
      waiting = setTimeout(rebuild, PAUSE)
      emitState() if fresh
      return
    rebuild()

  # le séparateur de paragraphes et le style en CSS sont des réglages d'édition du DOCUMENT entier, pas de la seule surface : posés au focus, ils
  # sont rendus à la sortie (et quand l'éditeur quitte la page sans `blur`), et les autres zones éditables de la page gardent les leurs
  given = null

  giveBack = ->
    return unless given
    document.execCommand('defaultParagraphSeparator', false, given[0]) if given[0]
    document.execCommand('styleWithCSS', false, given[1])
    given = null

  onFocus = ->
    $focused = true
    atFocus  = canon
    streak   = ''
    given   ?= [document.queryCommandValue('defaultParagraphSeparator'), document.queryCommandState('styleWithCSS')]
    document.execCommand('defaultParagraphSeparator', false, 'p')
    document.execCommand('styleWithCSS', false, false)

  onBlur = ->
    $focused = false
    streak   = ''
    giveBack()
    rebuild() if waiting
    µemit 'change', canon if canon != atFocus


  # la pile d'annulation, propre à CET éditeur : celle du navigateur est commune à toute la page (défaire dans un éditeur y défaisait la frappe d'un autre), elle ne
  # sert plus. Une étape garde l'état d'avant un changement — une copie de la surface, et sa sélection — : une frappe continue (texte tapé, ou texte effacé, au curseur
  # que la touche d'avant a laissé) n'en fait qu'une, un déplacement par glisser aussi ; une mise en forme (même faite de plusieurs commandes), un collage, un dépôt,
  # Entrée, une indentation en font chacun une. Défaire rend l'état gardé tel qu'il était (sa sélection comprise) et garde l'état quitté pour refaire ; une étape
  # neuve vide ce qui était à refaire ; la pile garde DEPTH étapes, le cinquième pour un grand texte. Défaire ne décoche pas une case : une ligne à cocher qui revient
  # prend l'état de la ligne vivante dont elle est la copie (son numéro, `_mjsLine`, posé à la première copie)
  boxesOf = (root)-> root.querySelectorAll('ul[data-checklist] > li')

  # un point de la sélection : le rang de son nœud à chaque étage depuis la surface, et son décalage (la copie a les mêmes nœuds, aux mêmes rangs)
  pathOf = (n)->
    p = []
    while n != surface
      p.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n))
      n = n.parentNode
    p

  nodeAt = (p)->
    n = surface
    for i in p
      n = n?.childNodes[i]
    n

  spotNow = ->
    r = rangeNow()
    if r and surface.contains(r.endContainer) then [pathOf(r.startContainer), r.startOffset, pathOf(r.endContainer), r.endOffset] else null

  spotKey = -> JSON.stringify(spotNow())

  # le point gardé, sans le poser : la sélection posée dans la zone y mettrait le focus
  spotRange = (s)->
    a = s and nodeAt(s[0])
    b = s and nodeAt(s[2])
    a and b and { startContainer: a, startOffset: s[1], endContainer: b, endOffset: s[3] }

  restoreSpot = (s)->
    r = spotRange(s)
    restoreRange(r) if r

  snap = ->
    r = document.createRange()
    r.selectNodeContents(surface)
    f    = r.cloneContents()
    live = boxesOf(surface)
    copy = boxesOf(f)
    for i in [0...live.length]
      live[i]._mjsLine ?= ++lineSeq
      copy[i]._mjsLine = live[i]._mjsLine
    { f: f, s: spotNow() }

  restoreSnap = (s, aside)->
    kept = new Map()
    for li in boxesOf(surface)
      kept.set(li._mjsLine, li.hasAttribute('data-checked')) if li._mjsLine
    for li in boxesOf(s.f)
      li.toggleAttribute('data-checked', kept.get(li._mjsLine)) if kept.has(li._mjsLine)
    surface.replaceChildren(s.f)
    if aside then savedRange = spotRange(s.s) else restoreSpot(s.s)

  # l'état d'avant un changement qui s'annonce : il entre dans la pile quand le changement a lieu (son `input`) ; la frappe qui reprend au curseur que la touche
  # d'avant a laissé rejoint son étape (une composition qui y commence aussi), la pose d'un glisser aussi. Le geste de l'éditeur en cours (une commande, une
  # indentation) n'en garde qu'un
  keepBefore = (kind)->
    return if acting or running
    if kind and kind == streak and (kind == 'drag' or spotKey() == caretAt)
      pending = null
      return
    pending = snap()
    opened  = kind

  seal = ->
    return false unless pending
    sealed = pending.n = ++clock
    past.push(pending)
    past.shift() while past.length > (if canon.length > BIG then DEPTH / 5 else DEPTH)
    ahead   = []
    streak  = opened
    pending = null
    true

  gesture = (fn)->
    keepBefore('')
    acting = true
    try
      fn()
    finally
      acting  = false
      pending = null

  # défaire (`back`) ou refaire : la surface reprend l'état gardé et le texte est relu comme après un geste (la valeur liée, le champ, `input`) ; avec `aside`
  # le focus est hors de la zone et y reste, la sélection gardée attend que la barre ou un clic l'y ramène
  travel = (back, aside)->
    pile = if back then past else ahead
    return unless pile.length
    rebuild() if waiting
    other  = if back then ahead else past
    kept   = snap()
    kept.n = ++clock
    other.push(kept)
    restoreSnap(pile.pop(), aside)
    streak  = ''
    pending = null
    rebuild()

  # le genre d'un geste natif : la frappe, l'effacement, le glisser (enlevé puis posé) ; tout autre geste ouvre une étape
  kindOf = (t)->
    return 'drag' if t == 'deleteByDrag' or t == 'insertFromDrop'
    return '' unless TYPING.test(t ?? '')
    if t.startsWith('delete') then 'delete' else 'type'

  # défaire et refaire du navigateur (son menu, un raccourci que l'éditeur n'a pas pris) : jamais sa pile. Le navigateur adresse ce geste à l'éditeur dont une étape
  # est en tête de sa pile commune (Chromium, WebKit), ou à celui de la sélection (Firefox), même quand le focus est ailleurs. L'éditeur prend sa pile quand le
  # focus est en lui (sa zone, sa barre, un lien de sa zone), ou sur rien où l'on écrit (un bouton, un lien, la page : l'éditeur qui a la dernière étape la
  # défait, comme le faisait la pile du navigateur, quel que soit l'éditeur visé) ; hors de sa zone, le focus ne bouge pas. Le geste est rendu au champ où l'on
  # écrit qui a le focus (plus bas), et au navigateur quand le focus n'est sur aucun champ et qu'aucun éditeur n'a plus rien à défaire. Une composition a son étape, ouverte à son début :
  # ses mises à jour n'en ouvrent aucune autre
  onBeforeInput = (e)->
    t = e.inputType
    if t == 'historyUndo' or t == 'historyRedo'
      e.preventDefault()
      back = t == 'historyUndo'
      at   = focusAt()
      if at == surface
        run(if back then 'undo' else 'redo')
      else if focusIn() or (not back and not writable(at) and ahead.length)
        if $edit
          travel(back, true)
          undone.push(mine) if back
      else if back and not writable(at)
        ed = pick()
        if ed then ed.undo() else passOn(t, at)
      else
        passOn(t)
      return
    return if e.isComposing or /Composition/.test(t ?? '')
    keepBefore(kindOf(t))

  # le geste de refaire de la page après un geste du navigateur pris hors de la zone (plus haut) : refait par la pile, le focus en place, sauf quand le focus
  # est dans un champ où l'on écrit hors de l'éditeur (le geste lui reste) ou dans la zone (son clavier l'a pris)
  redoAside = ->
    at = focusAt()
    return false unless $edit and ahead.length and surface?.isConnected and at != surface and (focusIn() or not writable(at))
    travel(false, true)
    true

  # le focus est dans cet éditeur (sa zone, sa barre, un lien de sa zone), avec ou sans ombre
  focusIn = -> !!surface and editorOf(focusAt()) == editorOf(surface)

  # cet éditeur au registre de la page (plus haut) : l'heure de sa dernière étape, le focus en lui, défaire et refaire hors de sa zone, ce qui reste à
  # refaire, le texte que le navigateur a touché sans le lui annoncer (la sélection dans sa zone) et sa remise
  mine = { at: (-> if $edit and surface?.isConnected then (past[past.length - 1]?.n ?? 0) else 0), has: (-> $edit and focusIn()), undo: (-> undoAside()), redo: (-> redoAside()), left: (-> ahead.length > 0), hit: (-> !!surface?.isConnected and !!rangeNow() and htmlOf(surface) != canon), keep: (-> keepText()) }

  undoAside = ->
    return unless $edit
    travel(true, true)
    undone.push(mine)

  # une composition (méthode de saisie : japonais, chinois, clavier de téléphone…) se défait comme une frappe : l'état d'avant est gardé quand elle commence,
  # et elle rejoint la frappe qu'elle continue au même curseur ; son texte provisoire, remplacé à chaque touche, n'est jamais une étape
  onCompose = ->
    keepBefore('type')

  # rendre au champ du focus le geste que le navigateur a adressé à l'éditeur : Chromium garde en tête de sa pile l'étape dont le geste a été refusé, mais il
  # oublie les étapes d'une zone éditable qui quitte la page — la surface de chaque éditeur de la page qui ne contient pas le focus (ni dans sa zone, ni dans
  # sa barre, ni sur un lien de sa zone) en sort et y revient aussitôt, une fois par geste (son défilement et la sélection gardée la suivent ; un geste
  # rejoué qui tomberait sur l'étape d'un autre éditeur y défait son texte et y met le focus) ; WebKit a déjà jeté l'étape refusée. Le geste est ensuite
  # rejoué pour le champ du focus, dans une boucle commune aux éditeurs : un rejeu qui retombe sur l'étape d'un éditeur (WebKit les jette une à une) est
  # rejoué aussitôt, DEPTH fois au plus
  still = (r)-> r and { startContainer: r.startContainer, startOffset: r.startOffset, endContainer: r.endContainer, endOffset: r.endOffset }

  unstick = (e)->
    return unless surface?.isConnected and not focusIn() and (not e.detail or sealed > e.detail)
    top        = surface.scrollTop
    left       = surface.scrollLeft
    savedRange = still(savedRange)
    linkRange  = still(linkRange) # @@ tool-link
    surface.parentNode.insertBefore(surface, surface.nextSibling)
    surface.scrollTop  = top
    surface.scrollLeft = left

  # le geste de défaire qu'aucun éditeur ne prend, le focus sur rien où l'on écrit (`from`) : seuls les éditeurs dont une étape est plus récente que la
  # saisie hors des éditeurs sortent de la page (le navigateur garde les étapes d'avant, pour les gestes suivants), cette saisie est défaite, et le focus
  # revient où il était quand le navigateur l'a mis dans le champ qu'il a défait. Firefox adresse le geste à la zone de la sélection (sa sélection se lit
  # dans la zone) : depuis un bouton, il ne défait pas un champ de texte, et la sélection que le rejeu lui ferait perdre arrêterait les gestes suivants ;
  # rien ne bouge, la saisie hors des éditeurs a eu son tour
  passOn = (t, from)->
    if relay
      relay.again = true
      return
    if from and surface.contains(document.getSelection()?.anchorNode ?? null)
      nativeAt = 0
      return
    relay = { again: true }
    since = if from then nativeAt else 0
    setTimeout((->
      try
        return unless surface?.isConnected and not focusIn()
        document.dispatchEvent(new CustomEvent(UNSTICK, { detail: since }))
        n = 0
        while relay.again and n++ < DEPTH
          relay.again = false
          document.execCommand(if t == 'historyUndo' then 'undo' else 'redo')
        return unless from
        nativeAt = 0
        if from.isConnected and focusAt() != from
          if from == document.body then focusAt()?.blur() else from.focus({ preventScroll: true })
      finally
        relay = null
    ), 0)

  # la pile du navigateur a tout de même touché la surface : le texte de l'éditeur revient. Un `execCommand('undo')` de la page n'annonce rien avant (Chromium) ;
  # Firefox annonce le geste à la zone de la sélection, un autre champ, puis défait l'étape de l'éditeur en tête de sa pile commune : la sélection d'alors y
  # revient et le geste est rejoué pour ce champ, sauf quand le focus est dans l'éditeur
  keepText = ->
    surface.innerHTML = canon or '<p><br></p>'
    rebuild()
    g = asked
    r = g?.r
    return unless r?.startContainer.isConnected and r.endContainer.isConnected and not surface.contains(r.startContainer) and not focusIn()
    try
      document.getSelection().setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset)
    catch err
      return
    passOn(g.t)


  # les commandes ; l'`input` qu'une commande de l'éditeur provoque (collage, dépôt, mise en forme) ne passe jamais par la pause, quel que soit le `inputType`
  # que le navigateur annonce (WebKit dit `insertText` pour `insertHTML`)
  exec = (name, arg)->
    keepBefore('')
    running = true
    try
      document.execCommand(name, false, arg)
    finally
      running = false
      pending = null unless acting

  # @@ tool-keys
  # le raccourci du lien et celui des cases n'agissent que si une barre de CET éditeur montre l'outil (la sienne, ou la <@@toolbar for> qui le vise) : chaque barre s'inscrit auprès de son éditeur
  # (`_mjsBars`, des fonctions « cet outil est-il dans mes boutons ? ») quand elle s'y branche et s'en retire quand elle part ; développement et production font de même
  barShows = (tool)-> Array.from(@@_mjsBars ?? []).some((f)-> f(tool))
  # @@

  ensureFocus = ->
    return if surface.getRootNode().activeElement == surface
    surface.focus()
    restoreRange(savedRange) if savedRange

  setCheck = (li, on)->
    if on then li.setAttribute('data-checked', '') else li.removeAttribute('data-checked')
    say(if on then tr('checked', µlang) else tr('unchecked', µlang))
    touch()

  toggleCheck = (li)->
    setCheck(li, not li.hasAttribute('data-checked'))

  # @@ tool-check
  # la liste que la commande vient de fabriquer : celle qui porte le nœud où se tenait le curseur ; sinon, le curseur étant
  # resté juste avant elle (Chromium le pose sur le <p> qui l'enveloppe), la première liste en dessous
  listAfter = (anchor)->
    found = if anchor?.isConnected then upTo(anchor, 'ul', surface) else null
    return found if found
    at = caretOf()
    found = upTo(at, 'ul', surface)
    found ?? (if at?.nodeType == 1 then at.querySelector('ul') else null)
  # @@

  list = (kind)->
    li      = liAt()
    ul      = li?.parentNode
    inCheck = !!ul?.hasAttribute?('data-checklist')
    # @@ tool-check
    if kind == 'check'
      if inCheck then exec('insertUnorderedList')
      else if ul?.localName == 'ul' then ul.setAttribute('data-checklist', '')
      else
        anchor = caretOf()
        exec('insertUnorderedList')
        listAfter(anchor)?.setAttribute('data-checklist', '')
      return touch()
    # @@
    if kind == 'ul'
      if inCheck
        ul.removeAttribute('data-checklist')
        for x in ul.children
          x.removeAttribute('data-checked')
      else exec('insertUnorderedList')
    else
      exec('insertOrderedList')
    touch()

  block = (tag)->
    return if stateNow().inList
    exec('formatBlock', if stateNow()[tag] then '<p>' else (if tag == 'quote' then '<blockquote>' else '<' + tag + '>'))

  MARK = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough' }

  run = (cmd)->
    return unless $edit
    return openLink() if cmd == 'link' # @@ tool-link
    ensureFocus()
    return travel(cmd == 'undo') if cmd == 'undo' or cmd == 'redo'
    return if cmd == 'bold' and (stateNow().h2 or stateNow().h3)
    gesture ->
      if MARK[cmd] then exec(MARK[cmd])
      else if cmd == 'h2' or cmd == 'h3' or cmd == 'quote' then block(cmd)
      else if cmd == 'ul' or cmd == 'ol' or cmd == 'check' then list(cmd)
      else if cmd == 'clear'
        exec('removeFormat')
        exec('unlink')
        exec('formatBlock', '<p>') unless stateNow().inList
    emitState()


  # @@ tool-link
  # le lien : une ligne sous la barre ; la sélection de la surface est gardée pendant la saisie de l'adresse
  openLink = ->
    ensureFocus()
    r = rangeNow() ?? savedRange
    linkRange = r
    a = upTo(caretOf(), 'a', surface)
    $linkUrl  = a?.getAttribute('href') ?? ''
    $linkHas  = !!a
    $linkOpen = true
    setTimeout((-> linkRef?.focus(); linkRef?.select()), 0)

  closeLink = ->
    $linkOpen = false
    surface.focus()
    restoreRange(linkRange) if linkRange

  applyLink = ->
    url = safeUrl(urlOf($linkUrl))
    return closeLink() unless url
    closeLink()
    r = rangeNow()
    a = upTo(caretOf(), 'a', surface)
    if a
      document.getSelection().setBaseAndExtent(a, 0, a, a.childNodes.length)
      exec('createLink', url)
    else if r and r.collapsed
      exec('insertHTML', '<a href="' + escA(url) + '">' + esc(url) + '</a>')
    else
      exec('createLink', url)
    say(tr('linkDone', µlang))

  removeLink = ->
    closeLink()
    a = upTo(caretOf(), 'a', surface)
    document.getSelection().setBaseAndExtent(a, 0, a, a.childNodes.length) if a
    exec('unlink')

  onLinkKey = (e)->
    return if e.isComposing or e.keyCode == 229
    if e.key == 'Enter'
      e.preventDefault()
      applyLink()
    else if e.key == 'Escape'
      e.preventDefault()
      e.stopPropagation()
      closeLink()
  # @@


  # @@ answer
  # la ligne à cocher qui porte cet élément, par sa position dans le texte (0, 1, 2… dans l'ordre du document, sous-listes comprises)
  lineIndex = (el)->
    Array.from(surface.querySelectorAll('.line')).indexOf(el)

  # mode « répondre » : un geste coche ou décoche la case ; la variable liée et les champs sont à jour avant que `change` ne parte, avec
  # la copie des cases cochées dans l'ordre du texte (un nom ou une position qui n'est plus dans le texte tombe ici)
  tickAt = (i)->
    return unless $tick and i >= 0 and i < lineIds.length
    id       = lineIds[i]
    ticked   = not tickSet.includes(id)
    set      = lineIds.filter((x)-> if x == id then ticked else tickSet.includes(x))
    tickSet  = set
    $checked = set.slice()
    syncTicks()
    syncHidden()
    µemit 'change', set.slice()

  # Espace bascule la case qui a le focus ; une touche tenue ne bascule qu'une fois, Entrée ne fait rien (comme une case native)
  answerKey = (e)->
    return unless e.key == ' ' and $tick and not e.repeat and not e.ctrlKey and not e.metaKey and not e.altKey
    return unless e.target.classList?.contains('line')
    e.preventDefault()
    tickAt(lineIndex(e.target))
  # @@


  # le clavier
  onKeydown = (e)->
    return answerKey(e) if $ans # @@ answer
    return if e.isComposing or not $edit
    mod = e.ctrlKey or e.metaKey
    if mod and not e.altKey
      k = e.key.toLowerCase()
      cmd = null
      if e.shiftKey
        cmd = 'strike' if k == 'x'
        cmd = 'redo'   if k == 'z'
        cmd = 'ol'     if e.code == 'Digit7'
        cmd = 'ul'     if e.code == 'Digit8'
        cmd = 'check'  if e.code == 'Digit9' and barShows('check') # @@ tool-check
      else
        cmd = 'bold'      if k == 'b'
        cmd = 'italic'    if k == 'i'
        cmd = 'underline' if k == 'u'
        cmd = 'undo'      if k == 'z'
        cmd = 'redo'      if k == 'y' and e.ctrlKey
        cmd = 'link'      if k == 'k' and barShows('link') # @@ tool-link
      if cmd
        e.preventDefault()
        return run(cmd)
      if k == 'enter' and not e.shiftKey
        li = liAt()
        if li?.parentNode?.hasAttribute('data-checklist')
          e.preventDefault()
          toggleCheck(li)
    else if mod and e.altKey
      # AltGr, que Windows transmet comme Ctrl+Alt, tape un caractère (« @ », « # », « ~ » d'un clavier français, belge, suisse, espagnol, allemand) : jamais un raccourci ;
      # ⌘⌥ reste celui du Mac, même quand Firefox y dit AltGraph pour ⌥
      return if e.getModifierState?('AltGraph') and not e.metaKey
      # sous Windows, Ctrl et Alt de gauche valent AltGr, et le navigateur peut ne pas y dire AltGraph : la touche qui y donne un caractère l'écrit (« @ » de
      # Ctrl+Alt+0 d'un clavier français), une touche morte aussi (« ~ » de Ctrl+Alt+2, que le navigateur dit Dead) ; un chiffre (clavier anglais, sans
      # caractère AltGr) reste le raccourci. Ailleurs (Linux, macOS), Ctrl+Alt n'écrit rien et le caractère que dit la touche est le sien (« é » du 2
      # d'un clavier français) : le raccourci la prend
      return if /^Win/.test(navigator.platform ?? '') and (e.key == 'Dead' or (e.key.length == 1 and not /^[0-9]$/.test(e.key)))
      cmd = null
      cmd = 'h2' if e.code == 'Digit2'
      cmd = 'h3' if e.code == 'Digit3'
      if e.code == 'Digit0'
        e.preventDefault()
        return exec('formatBlock', '<p>')
      if cmd
        e.preventDefault()
        run(cmd)
    else if e.key == 'Tab' and not e.altKey
      li = liAt()
      return unless li
      if e.shiftKey
        return unless li.parentNode.parentNode?.closest?('ul, ol') and surface.contains(li.parentNode.parentNode)
      else
        return unless li.previousElementSibling
      e.preventDefault()
      gesture ->
        exec(if e.shiftKey then 'outdent' else 'indent')
        for ul in surface.querySelectorAll('ul:not([data-checklist])')
          up = ul.parentNode.closest?('ul, ol')
          ul.setAttribute('data-checklist', '') if up?.hasAttribute('data-checklist')
        touch()


  # la case d'une liste à cocher : cliquer dans la marge gauche d'une ligne la coche, sans déplacer le curseur ; en mode « répondre » le focus
  # va à la case, pour que le lecteur d'écran annonce son nouvel état
  boxHit = (e)->
    li = upTo(e.target, 'li', surface)
    return null unless li?.parentNode?.hasAttribute('data-checklist')
    box = li.getBoundingClientRect()
    cs  = getComputedStyle(li)
    x   = e.clientX - box.left
    y   = e.clientY - box.top
    if x >= 0 and x <= parseFloat(cs.paddingLeft) and y >= 0 and y <= parseFloat(cs.fontSize) * 1.8 then li else null

  # @@ answer
  onMouseDown = (e)->
    e.preventDefault() if ($edit or $tick) and boxHit(e)

  onClick = (e)->
    li = ($edit or $tick) and boxHit(e)
    return unless li
    return toggleCheck(li) unless $ans
    line = li.firstElementChild
    return unless line?.classList?.contains('line')
    line.focus()
    tickAt(lineIndex(line))
  # @@
  # @@ !answer
  # onMouseDown = (e)->
  #   e.preventDefault() if $edit and boxHit(e)
  #
  # onClick = (e)->
  #   li = $edit and boxHit(e)
  #   toggleCheck(li) if li
  # @@


  # le collage et le dépôt : seul le HTML permis entre ; un seul paragraphe s'insère dans la ligne en cours ; avec `paste="text"` seul le texte
  # brut entre, en paragraphes
  insertClean = (html, text)->
    out = if html and $paste != 'text' then clean(html) else textHtml(text ?? '')
    return unless out
    own() if barShows('check') # @@ tool-check
    one = /^<p>((?:(?!<\/?p>).)*)<\/p>$/s.exec(out)
    exec('insertHTML', if one then one[1] else out)

  onPaste = (e)->
    return unless $edit and e.clipboardData
    e.preventDefault()
    insertClean(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'))

  onDragStart = ->
    dragging = true
    streak   = ''

  onDragEnd = ->
    dragging = false

  # le dépôt d'un contenu venu d'AILLEURS : le navigateur l'insère tel quel (balises, images) sans même annoncer de `beforeinput`,
  # on prend donc la main sur `drop`, on pose le curseur au point de dépôt puis on insère le HTML nettoyé ; ce que l'éditeur
  # déplace de lui-même reste au navigateur (il ne manipule que du contenu déjà propre)
  onDrop = (e)->
    return unless $edit
    if dragging
      dragging = false
      return
    e.preventDefault()
    dt = e.dataTransfer
    return unless dt and not dt.files?.length
    pos = document.caretPositionFromPoint?(e.clientX, e.clientY, { shadowRoots: [surface.getRootNode()] })
    if pos and surface.contains(pos.offsetNode)
      surface.focus()
      document.getSelection().setBaseAndExtent(pos.offsetNode, pos.offset, pos.offsetNode, pos.offset)
    else
      ensureFocus()
    insertClean(dt.getData('text/html'), dt.getData('text/plain'))



  flush = ->
    rebuild() if waiting

  # `form.submit()` et `new FormData(form)` ne passent pas par `submit` : le champ caché est lu tel qu'il est. L'événement `formdata` part à chaque construction de la liste des champs,
  # avec cette liste dans `e.formData` : l'éditeur qui attend sa pause reconstruit, puis remplace SON entrée par le texte complet. Il la reconnaît à son nom, à son ancien texte et
  # à son rang parmi les champs de même nom et de même texte (deux éditeurs du même nom, ou un champ caché qui porte le même texte) ; les autres entrées gardent leur valeur et leur ordre
  onFormData = (e)->
    return unless waiting
    field = fields[0]
    return rebuild() unless field
    old   = field.value
    same  = Array.from(resetForm.elements).filter((x)-> x.name == field.name and x.value == old and not x.matches(':disabled') and (x.checked or not /^(checkbox|radio)$/.test(x.type)))
    rank  = same.indexOf(field)
    rebuild()
    return if rank < 0 or field.value == old
    entries = Array.from(e.formData)
    n       = -1
    at      = -1
    for i in [0...entries.length]
      continue unless entries[i][0] == field.name and entries[i][1] == old
      n++
      if n == rank
        at = i
        break
    return if at < 0
    new Set(entries.map((p)-> p[0])).forEach((k)-> e.formData.delete(k))
    for i in [0...entries.length]
      e.formData.append(entries[i][0], if i == at then field.value else entries[i][1])

  µawake ->
    resetForm = @@closest('form')
    resetForm?.addEventListener('submit', flush, true)
    resetForm?.addEventListener('formdata', onFormData)

  µsleep ->
    giveBack()
    resetForm?.removeEventListener('submit', flush, true)
    resetForm?.removeEventListener('formdata', onFormData)
    resetForm = null

  # ce que la balise porte de l'extérieur : le nom (`aria-label`) et l'erreur (`aria-invalid`) que <@@field> ou la page y posent passent à
  # la surface, qui est le vrai champ pour un lecteur d'écran
  watchAria = null

  syncAria = ->
    $hostLabel   = @@getAttribute('aria-label')
    $hostInvalid = @@getAttribute('aria-invalid')

  # le routeur d'événements de la page lit ce crochet sur la balise AVANT ses gestionnaires : l'`input` natif de la surface (et celui du
  # champ d'adresse du lien), composé et retargeté sur la balise, ne leur arrive pas ; seul l'`input` que l'éditeur émet lui-même (un
  # CustomEvent, `e.data` = le HTML) passe. Les autres événements natifs (click, keydown, focus…) ne sont pas touchés
  holdNative = (e)-> e.type == 'input' and not (e instanceof CustomEvent)

  µmount ->
    @@_mjsExec  = run
    @@_mjsState = stateNow
    @@_mjs_hold = holdNative
    @@focus     = (o)-> surface?.focus(o)
    watchAria   = new MutationObserver(syncAria)
    watchAria.observe(@@closest('mjs-core-editor'), { attributes: true, attributeFilter: ['aria-label', 'aria-invalid'] })
    syncAria()
    # la remise à zéro du formulaire : l'aide du cœur lit l'état de départ UN cran après le montage (sa valeur, et en mode « répondre » ses
    # cases cochées), suit le formulaire où l'éditeur EST, et le rend une fois l'événement passé (une remise annulée par la page ne touche à rien) ;
    # le formulaire remis à zéro rend la valeur de départ sans annoncer de `change`, et vide la pile d'annulation ; en mode « répondre », les cases de départ
    µ._mjs_formReset @, ->
      start         = { value: if $value? then String($value) else '' }
      start.checked = keysOf($checked) # @@ answer
      ->
        # @@ answer
        if $ans
          $checked = start.checked.slice()
          return
        # @@
        forget()
        $value = start.value
        emitState()
        return
    # une `<label for>` qui vise l'éditeur met le focus dans sa zone d'édition, comme l'étiquette d'une zone de texte native (l'aide du cœur appelle
    # `click()` de ce qu'elle reçoit), et nomme la zone, le vrai champ pour un lecteur d'écran : les étiquettes que l'aide fait citer au champ
    # (`ariaLabelledByElements`, même règle que pour les autres modules : rien quand la balise porte son nom) vont à la zone ; la validité de départ, la zone posée
    µ._mjs_formLabel @, Object.defineProperty({ click: ensureFocus }, 'ariaLabelledByElements', { set: ((v)-> surface.ariaLabelledByElements = v) })
    @syncValidity()
    document.addEventListener(UNSTICK, unstick)
    editors.add(mine)
    unless heard
      heard = true
      document.addEventListener('beforeinput', noteAsked, true)
      document.addEventListener('keydown', onRedoKey)
      window.addEventListener('input', holdUndo, true)

  # retiré de la page pendant la pause d'un grand texte : le texte tapé est reconstruit avant de partir (Chromium envoie un `blur` au retrait, pas les autres navigateurs)
  µdestroy ->
    document.removeEventListener(UNSTICK, unstick)
    editors.delete(mine)
    undone = undone.filter((ed)-> ed != mine)
    watchAria?.disconnect()
    rebuild() if waiting and surface
</script>

<div class="box" part="box" @class{$off}="off" @class{$ro}="readonly" @class{$focused}="focused" --mjs-editor-on={$t.on} --mjs-editor-off={$t.off}>
  {if $barTools != null and $edit}
    <@@toolbar class="bar" part="toolbar" tools={$barTools} disabled={$off}></@@toolbar>
  {end}
  <!-- @@ tool-link -->
  {if $linkOpen}
    <div class="link" part="link" role="group" aria-label={$t.link} @keydown={onLinkKey(e)}>
      <input class="link-url" part="link-input" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" aria-label={$t.link} value=!{$linkUrl} @this=!{linkRef} @input={e.stopPropagation()}>
      <button type="button" class="link-ok" @click={applyLink()}>{$t.apply}</button>
      {if $linkHas}
        <button type="button" class="link-no" @click={removeLink()}>{$t.remove}</button>
      {end}
      <button type="button" class="link-x" @click={closeLink()}>{$t.cancel}</button>
    </div>
  {end}
  <!-- @@ -->
  <!-- @@ answer -->
  <div class="surface" part="surface" role={$ans ? 'group' : 'textbox'} aria-multiline={$ans ? null : 'true'} aria-label={$nameText} aria-invalid={$hostInvalid} aria-required={(must($required) and $edit) ? true : null} aria-readonly={$textRo ? true : null} aria-disabled={$off ? true : null} aria-placeholder={($empty and not $ans and $placeholderText) ? $placeholderText : null} contenteditable={$edit ? 'true' : 'false'} tabindex={($textRo and not $off) ? 0 : null} spellcheck="true" data-placeholder={$placeholderText} @class{$empty}="empty" @this=!{surface} @html=!{$raw} @input={onInput(e)} @beforeinput={onBeforeInput(e)} @compositionstart={onCompose()} @keydown={onKeydown(e)} @paste={onPaste(e)} @drop={onDrop(e)} @mousedown={onMouseDown(e)} @click={onClick(e)} @focus={onFocus()} @blur={onBlur()} @dragstart={onDragStart()} @dragend={onDragEnd()}></div>
  <!-- @@ -->
  <!-- @@ !answer -->
  <!-- <div class="surface" part="surface" role="textbox" aria-multiline="true" aria-label={$nameText} aria-invalid={$hostInvalid} aria-required={(on($required) and $edit) ? true : null} aria-readonly={$ro ? true : null} aria-disabled={$off ? true : null} aria-placeholder={($empty and $placeholderText) ? $placeholderText : null} contenteditable={$edit ? 'true' : 'false'} tabindex={($ro and not $off) ? 0 : null} spellcheck="true" data-placeholder={$placeholderText} @class{$empty}="empty" @this=!{surface} @html=!{$raw} @input={onInput(e)} @beforeinput={onBeforeInput(e)} @compositionstart={onCompose()} @keydown={onKeydown(e)} @paste={onPaste(e)} @drop={onDrop(e)} @mousedown={onMouseDown(e)} @click={onClick(e)} @focus={onFocus()} @blur={onBlur()} @dragstart={onDragStart()} @dragend={onDragEnd()}></div> -->
  <!-- @@ -->
  <textarea class="anchor" tabindex="-1" aria-hidden="true" @this=!{textField} @focus={ensureFocus()}></textarea>
  <div class="live" role="status" aria-live="polite">{$announce}</div>
</div>

<@document @selectionchange={onSelection()}>

<style @display="block">
  :host
    font: inherit

  .box
    position: relative
    border: 1px solid var(--mjs-editor-border, var(--mjs-border, rgba(#7f7f7f, .45)))
    border-radius: var(--mjs-editor-radius, 10px)
    background: var(--mjs-editor-bg, var(--mjs-surface, transparent))
    color: var(--mjs-editor-fg, var(--mjs-fg, inherit))
    overflow: hidden

    &.focused
      border-color: var(--mjs-editor-accent, var(--mjs-accent, #3b82f6))
      box-shadow: 0 0 0 3px var(--mjs-editor-focus, rgba(#3b82f6, .3))

    &.off
      opacity: .55

  .bar
    border-bottom: 1px solid var(--mjs-editor-border, var(--mjs-border, rgba(#7f7f7f, .45)))

  // @@ tool-link
  .link
    display: flex
    flex-wrap: wrap
    gap: 6px
    padding: 8px
    border-bottom: 1px solid var(--mjs-editor-border, var(--mjs-border, rgba(#7f7f7f, .45)))
    background: var(--mjs-editor-bar-bg, var(--mjs-hover, rgba(#7f7f7f, .1)))

    button
      height: 32px
      padding: 0 12px
      border: 1px solid var(--mjs-editor-border, var(--mjs-border, rgba(#7f7f7f, .45)))
      border-radius: 7px
      background: var(--mjs-editor-bg, var(--mjs-surface, transparent))
      color: inherit
      font: inherit
      cursor: pointer

      &:focus-visible
        outline: 3px solid var(--mjs-editor-focus, rgba(#3b82f6, .45))

    .link-ok
      background: var(--mjs-editor-accent, var(--mjs-accent, #3b82f6))
      border-color: var(--mjs-editor-accent, var(--mjs-accent, #3b82f6))
      color: var(--mjs-editor-accent-fg, #fff)

  .link-url
    flex: 1 1 14rem
    min-width: 0
    height: 32px
    padding: 0 10px
    border: 1px solid var(--mjs-editor-border, var(--mjs-border, rgba(#7f7f7f, .45)))
    border-radius: 7px
    background: var(--mjs-editor-bg, var(--mjs-surface, transparent))
    color: inherit
    font: inherit

    &:focus-visible
      outline: 3px solid var(--mjs-editor-focus, rgba(#3b82f6, .45))
  // @@

  .surface
    position: relative
    min-height: var(--mjs-editor-min-height, 11rem)
    max-height: var(--mjs-editor-max-height, 34rem)
    overflow: auto
    padding: 14px 16px
    line-height: 1.55
    outline: none
    overflow-wrap: anywhere

    &.empty::before
      content: attr(data-placeholder)
      position: absolute
      top: 14px
      left: 16px
      right: 16px
      color: var(--mjs-fg-muted, rgba(#7f7f7f, .85))
      pointer-events: none

    p
      margin: 0 0 .7em

    h2
      margin: 1.1em 0 .4em
      font-size: 1.35em
      line-height: 1.25

    h3
      margin: 1em 0 .35em
      font-size: 1.12em
      line-height: 1.3

    h2:first-child, h3:first-child
      margin-top: 0

    blockquote
      margin: 0 0 .7em
      padding: .1em 0 .1em 1em
      border-left: 3px solid var(--mjs-editor-quote, var(--mjs-border, rgba(#7f7f7f, .55)))
      color: var(--mjs-fg-muted, inherit)

    ul, ol
      margin: 0 0 .7em
      padding-left: 1.6em

    li > ul, li > ol
      margin: .15em 0 0

    a
      color: var(--mjs-editor-link, var(--mjs-accent, #2563eb))
      text-decoration: underline

    // @@ answer
    // la case est posée sur le carré dessiné dans la marge de sa ligne : le contour du focus l'entoure, et le clic passe à la ligne (la marge coche)
    .line
      position: absolute
      left: .1em
      top: .3em
      width: 1.1em
      height: 1.1em
      border-radius: 4px
      pointer-events: none

      &:focus-visible
        outline: 3px solid var(--mjs-editor-focus, rgba(#3b82f6, .45))
        outline-offset: 1px
    // @@

    ul[data-checklist]
      list-style: none
      padding-left: 0

      li
        position: relative
        padding-left: 1.9em
        margin: .15em 0

        &::before
          content: "" / var(--mjs-editor-off)
          position: absolute
          left: .1em
          top: .3em
          box-sizing: border-box
          width: 1.1em
          height: 1.1em
          border: 2px solid var(--mjs-editor-check-border, currentColor)
          border-radius: 4px
          cursor: pointer

        &[data-checked]::before
          content: "" / var(--mjs-editor-on)
          background: var(--mjs-editor-check, var(--mjs-editor-accent, var(--mjs-accent, #3b82f6)))
          border-color: var(--mjs-editor-check, var(--mjs-editor-accent, var(--mjs-accent, #3b82f6)))

        &[data-checked]::after
          content: ""
          position: absolute
          left: .5em
          top: .47em
          box-sizing: border-box
          width: .32em
          height: .62em
          border: solid var(--mjs-editor-check-fg, #fff)
          border-width: 0 2px 2px 0
          transform: rotate(45deg)
          pointer-events: none

        // @@ answer
        &.bare::before, &.bare::after
          display: none
        // @@

  .readonly .surface ul[data-checklist] li::before, .off .surface ul[data-checklist] li::before
    cursor: default

  .readonly .surface
    cursor: default

  // la pièce qui porte la bulle du formulaire, invisible au bas de la boîte : son focus passe à la zone d'édition
  .anchor
    position: absolute
    left: 0
    bottom: 0
    width: 100%
    height: 1px
    margin: 0
    padding: 0
    border: 0
    opacity: 0
    resize: none
    pointer-events: none

  .live
    position: absolute
    width: 1px
    height: 1px
    overflow: hidden
    clip-path: inset(50%)
    white-space: nowrap

  @media (forced-colors: active)
    .box.focused
      outline: 2px solid Highlight
</style>
