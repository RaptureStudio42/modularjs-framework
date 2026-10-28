<script module>
  # les repères `@@` (script `# @@`, gabarit `<!-- @@ -->`, style `// @@`) cernent ce qui ne sert qu'à un outil (`tool-bold`, `tool-link`…), à un groupe d'outils (`tool-icons`, `tool-glyphs`,
  # `tool-heads`, `tool-keys` : l'inscription auprès de l'éditeur, pour son raccourci) ou au séparateur `|` (`tool-separator`) : la construction les ôte quand aucune barre de l'application ne peut afficher l'outil, en développement comme en production ; la copie dans un projet
  # garde tout (les repères y sont des commentaires), ils ne partent jamais dans le code envoyé. `!tool-separator` est l'autre forme des lignes qui existent avec et sans séparateur ;
  # `dev tool-script` l'avertissement du développement quand une barre reçoit d'un script un outil que la construction a ôté (écrit en commentaire, réveillé quand la construction tranche les outils)
  # chaque outil : le glyphe ou le dessin du bouton, son raccourci (Mod = Ctrl ou ⌘ ; Shift, que le titre écrit dans la langue de la page : Maj, Shift, ⇧ sur Mac), s'il est un interrupteur
  # (aria-pressed) et la clé du libellé ; l'ordre de ALL dit l'ordre par défaut, `|` pose un séparateur
  ICON = {
    ul:    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="2.6" cy="4" r="1.1"/><circle cx="2.6" cy="8" r="1.1"/><circle cx="2.6" cy="12" r="1.1"/><path d="M6.5 4h8M6.5 8h8M6.5 12h8"/></svg>' # @@ tool-ul
    ol:    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 4h8M6.5 8h8M6.5 12h8"/><text x="0.6" y="5.6" class="n">1</text><text x="0.6" y="9.6" class="n">2</text><text x="0.6" y="13.6" class="n">3</text></svg>' # @@ tool-ol
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="5" height="5" rx="1"/><path d="M2.7 4.6l1.2 1.2 2-2.4"/><path d="M9 4.5h5.5"/><rect x="1.5" y="9" width="5" height="5" rx="1"/><path d="M9 11.5h5.5"/></svg>' # @@ tool-check
    link:  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.8 9.2a3 3 0 004.2 0l2.4-2.4a3 3 0 00-4.2-4.2l-.9.9"/><path d="M9.2 6.8a3 3 0 00-4.2 0L2.6 9.2a3 3 0 004.2 4.2l.9-.9"/></svg>' # @@ tool-link
    undo:  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5h6.5a4 4 0 010 8H6"/></svg>' # @@ tool-undo
    redo:  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5H7a4 4 0 000 8h3"/></svg>' # @@ tool-redo
    clear: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h8M6.5 3.5v8"/><path d="M10 8.5l4 4M14 8.5l-4 4"/></svg>' # @@ tool-clear
  }


  TOOLS = {
    h2:        { glyph: 'H2', label: 'toolH2',        key: 'Mod+Alt+2',       toggle: true,  cls: 'g-head' } # @@ tool-h2
    h3:        { glyph: 'H3', label: 'toolH3',        key: 'Mod+Alt+3',       toggle: true,  cls: 'g-head' } # @@ tool-h3
    quote:     { glyph: '“',  label: 'toolQuote',     key: '',                toggle: true,  cls: 'g-quote' } # @@ tool-quote
    bold:      { glyph: 'B',  label: 'toolBold',      key: 'Mod+B',           toggle: true,  cls: 'g-bold' } # @@ tool-bold
    italic:    { glyph: 'I',  label: 'toolItalic',    key: 'Mod+I',           toggle: true,  cls: 'g-italic' } # @@ tool-italic
    underline: { glyph: 'U',  label: 'toolUnderline', key: 'Mod+U',           toggle: true,  cls: 'g-underline' } # @@ tool-underline
    strike:    { glyph: 'S',  label: 'toolStrike',    key: 'Mod+Shift+X',     toggle: true,  cls: 'g-strike' } # @@ tool-strike
    color:     { glyph: 'A',  label: 'toolColor',     key: '',                toggle: true,  cls: 'g-color' } # @@ tool-color
    ul:        { icon: ICON.ul,    label: 'toolUl',    key: 'Mod+Shift+8',   toggle: true } # @@ tool-ul
    ol:        { icon: ICON.ol,    label: 'toolOl',    key: 'Mod+Shift+7',   toggle: true } # @@ tool-ol
    check:     { icon: ICON.check, label: 'toolCheck', key: 'Mod+Shift+9',   toggle: true } # @@ tool-check
    link:      { icon: ICON.link,  label: 'toolLink',  key: 'Mod+K',         toggle: true } # @@ tool-link
    undo:      { icon: ICON.undo,  label: 'toolUndo',  key: 'Mod+Z',         toggle: false } # @@ tool-undo
    redo:      { icon: ICON.redo,  label: 'toolRedo',  key: 'Mod+Shift+Z',   toggle: false } # @@ tool-redo
    clear:     { icon: ICON.clear, label: 'toolClear', key: '',              toggle: false } # @@ tool-clear
  }


  ALL   = 'h2 h3 quote | bold italic underline strike color | ul ol check | link | undo redo | clear'
  NAMES = ALL.split(' ').filter((n)-> n != '|').join(' ')
  MAC   = /Mac|iPhone|iPad/
  isMac = typeof navigator != 'undefined' and MAC.test(navigator.platform ?? '')


  told = new Set()


  known = (n)-> Object.prototype.hasOwnProperty.call(TOOLS, n)

  # un nom d'outil inconnu (une faute de frappe, un mot qui n'est pas anglais) est ignoré ; l'avertissement part une fois par nom. Un nom de ALL qui manque à TOOLS n'est pas une
  # faute de frappe : la construction a ôté cet outil (aucune barre des pages de l'application ne le nomme) et une barre le reçoit d'un script. Il ne se dit pas inconnu :
  # le développement le signale, la production se tait, comme pour la réponse libre d'une liste (`other`)
  unknown = (n)->
    return if told.has(n)
    told.add(n)
    if NAMES.split(' ').includes(n)
      # @@ dev tool-script
      # écrit en commentaire, réveillé seulement quand la construction tranche les outils : une copie du module posée dans un projet les garde tous, et ne le dit jamais
      # @@ !tool-script
      # µ.warn(µ._mjs_msg('dev.toolbarToolScript', { n: n }, '<@@toolbar> : une barre reçoit l\'outil « {n} » d\'un script, mais aucune page de l\'application n\'écrit cet outil — il n\'est pas envoyé, ni en développement ni en production. Écrivez « {n} » dans la liste d\'outils d\'une barre de votre page (l\'attribut toolbar d\'un éditeur, ou tools d\'une barre) plutôt que de le poser par un script.'))
      # @@
      # @@
      return
    µ.warn(µ._mjs_msg('coreToolbarUnknown', { n: n, list: NAMES }, '<@@toolbar> : l\'outil « {n} » n\'existe pas, il est ignoré — outils connus : {list}.'))

  # la liste d'outils écrite par l'auteur (un texte de noms séparés par des blancs, ou un tableau de noms : ['bold', 'italic']) → les noms connus et les séparateurs, sans doublon ni séparateur en bordure ; sans liste écrite (une barre sans tools, ou la barre de la photo d'un éditeur, définie avant lui : elle rend une première fois avant que l'éditeur lui donne la sienne) c'est la liste par défaut, et un outil que la production a retiré n'y est pas une faute de frappe : rien n'est signalé
  # @@ tool-separator
  listOf = (text)->
    text  = text.join(' ') if Array.isArray(text)
    words = (text or ALL).split(/\s+/).filter(Boolean)
    out   = []
    for w in words
      if w == '|' or known(w)
        out.push(w) if w == '|' or not out.includes(w)
      else
        unknown(w) if text
    out.shift() while out[0] == '|'
    out.pop() while out[out.length - 1] == '|'
    out.filter (n, i)-> not (n == '|' and out[i - 1] == '|')
  # @@
  # @@ !tool-separator
  # listOf = (text)->
  #   text  = text.join(' ') if Array.isArray(text)
  #   words = (text or ALL).split(/\s+/).filter(Boolean)
  #   out   = []
  #   for w in words
  #     if known(w)
  #       out.push(w) unless out.includes(w)
  #     else
  #       unknown(w) if text
  #   out
  # @@

  # le raccourci tel que le titre l'écrit : `shift`, le nom de la touche dans la langue de la page (Maj, Shift) ; ⌘, ⌥ et ⇧ sur Mac
  shortcutOf = (key, shift)->
    return '' unless key
    k = key.replace('Mod', (if isMac then '⌘' else 'Ctrl')).replace('Alt', (if isMac then '⌥' else 'Alt')).replace('Shift', (if isMac then '⇧' else shift))
    if isMac then k.replace(/\+/g, '') else k
</script>

<script>
  $for      = ''
  $tools    = null
  $label    = null
  $disabled = false


  $state = {}
  $rove  = ''
  $down  = ''


  barRef = null
  bound  = null
  watch  = null
  aimed  = null


  tr = (key, lang)-> µ._mjs_label('core', key) ?? ''

  on = (v)-> v !== undefined and v !== null and v !== false and v !== 'false'


  $labelText = $label ?? tr('toolbarLabel', µlang)

  $off = on($disabled)


  # les boutons : libellé et titre suivent la langue de la page, le nom des touches du raccourci aussi (lire µlang rend le dérivé réactif à la bascule)
  itemsOf = (tools, lang)->
    shift = tr('toolbarShift', lang)
    listOf(tools).map (n, i)->
      return { key: "sep#{i}", sep: true } if n == '|' # @@ tool-separator
      t = TOOLS[n]
      s = shortcutOf(t.key, shift)
      l = tr(t.label, lang)
      { key: n, name: n, sep: false, glyph: t.glyph, icon: t.icon, cls: t.cls, toggle: t.toggle, label: l, title: (if s and l then "#{l} (#{s})" else l) }

  $all = itemsOf($tools, µlang)

  # la couleur du texte n'a de bouton que pour un éditeur qui a une palette (son attribut `colors`) : sans elle, la barre est celle d'avant
  $items = $all.filter((it)-> it.name != 'color' or $state.colors) # @@ tool-color
  # @@ !tool-color
  # $items = $all
  # @@

  # un seul bouton entre dans l'ordre de tabulation, les flèches mènent aux autres ; celui qu'elles ont pris n'est plus dans la barre (`tools` a changé) :
  # le premier bouton reprend la tabulation
  $tab = (if $items.some((it)-> it.name == $rove) then $rove) or $items.find((it)-> not it.sep)?.name


  pressed = (name, st)-> if st[name] then true else false

  # titres et citation n'ont pas de sens dans une liste ; défaire n'a pas de sens sans éditeur ni dans un éditeur figé (lecture seule,
  # désactivé, mode « répondre »), ni quand la pile de CET éditeur n'a rien à défaire (ou à refaire)
  blocked = (name, st, off)->
    return true if off or not bound or st.frozen
    return true if name == 'bold' and (st.h2 or st.h3)
    return true if name == 'undo' and not st.undo # @@ tool-undo
    return true if name == 'redo' and not st.redo # @@ tool-redo
    (name == 'h2' or name == 'h3' or name == 'quote') and !!st.inList


  # @@ tool-keys
  # l'éditeur demande à ses barres si elles montrent un outil (le raccourci du lien et des cases n'agit que si l'une d'elles le montre)
  shown = (name)-> $items.some((it)-> it.name == name)
  # @@


  # l'éditeur visé : celui que `for` désigne, sinon celui qui enveloppe la barre ; ce qui n'est pas un éditeur n'est jamais pris (la page qui porte une barre
  # dont le `for` calculé n'est pas encore posé, un `id` qui désigne autre chose) : la barre reste débranchée, ses boutons grisés
  isEditor = (el)-> !!el and (!!el._mjsExec or el.localName == 'mjs-core-editor')

  editor = ->
    return bound if bound?.isConnected
    root  = @@getRootNode()
    found = if $for then (root.getElementById?($for) ?? document.getElementById($for)) else root.host
    if isEditor(found) then found else null

  onState = (e)-> $state = e.detail

  bind = ->
    ed = editor()
    return unless ed
    return if ed == bound
    bound?.removeEventListener('mjs-editor-state', onState)
    bound = ed
    ed.addEventListener('mjs-editor-state', onState)
    (ed._mjsBars ?= new Set()).add(shown) # @@ tool-keys
    $state = ed._mjsState?() ?? $state

  unbind = ->
    bound?.removeEventListener('mjs-editor-state', onState)
    bound?._mjsBars?.delete(shown) # @@ tool-keys
    bound = null
    $state = {}

  # l'éditeur visé peut paraître après la barre (un {if}, un chargement) ou partir : le gabarit qui les porte est guetté, la barre se branche
  # dès qu'il est là et se débranche (boutons grisés) quand il n'y est plus
  follow = ->
    unbind() if bound and not bound.isConnected
    bind() unless bound

  look = ->
    aimed = $for
    watch?.disconnect()
    watch = null
    return unless $for
    root  = @@getRootNode()
    watch = new MutationObserver(follow)
    watch.observe(root, { childList: true, subtree: true })
    watch.observe(document, { childList: true, subtree: true }) if root != document

  # un `for` calculé par la page n'est posé qu'après le réveil de la barre, et il peut changer : la barre quitte l'éditeur d'avant et se branche sur
  # celui qu'il désigne ; rien ne bouge tant que `for` reste celui que la barre guette déjà
  µeffect ->
    return if $for == aimed or not @@isConnected
    unbind()
    bind()
    look()

  fire = (name)->
    bind()
    return unless bound
    return if blocked(name, $state, $off)
    bound._mjsExec?(name)


  # l'appui d'un bouton (souris, doigt, stylet) : la barre annule le `mousedown` pour garder la sélection du texte, et Firefox n'allume alors jamais `:active` ;
  # le bouton enfoncé porte aussi la part `down` jusqu'au relâchement, où qu'il ait lieu : le même retour d'appui dans les trois moteurs. Un bouton grisé ne s'enfonce pas
  press = (e)->
    name  = e.target.closest('button')?.dataset.tool
    $down = name if name and e.button == 0 and not blocked(name, $state, $off)

  release = -> $down = '' if $down


  # flèches, début, fin : le bouton voisin prend la tabulation
  onKey = (e)->
    return unless ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)
    list = Array.from(barRef.querySelectorAll('button'))
    here = list.indexOf(e.target.closest('button'))
    return if here < 0
    to = if e.key == 'Home' then 0 else if e.key == 'End' then list.length - 1 else (here + (if e.key == 'ArrowRight' then 1 else -1) + list.length) % list.length
    e.preventDefault()
    $rove = list[to].dataset.tool
    list[to].focus()


  µawake ->
    bind()
    setTimeout(bind, 0)
    setTimeout(bind, 150)
    look()

  µsleep ->
    watch?.disconnect()
    watch = null
    bound?.removeEventListener('mjs-editor-state', onState)
    bound?._mjsBars?.delete(shown) # @@ tool-keys
    bound = null
</script>

<div class="bar" part="bar" role="toolbar" aria-orientation="horizontal" aria-label={$labelText} @this=!{barRef} @keydown={onKey(e)} @mousedown={e.preventDefault()} @pointerdown={press(e)}>
  {for it in $items by key}
    <!-- @@ tool-separator -->
    {if it.sep}
      <span class="sep" role="separator" aria-orientation="vertical"></span>
    {else}
    <!-- @@ -->
      <button type="button" part={it.name == $down ? 'button down' : 'button'} class="btn" data-tool={it.name} tabindex={it.name == $tab ? 0 : -1} title={it.title} aria-label={it.label} aria-pressed={it.toggle ? pressed(it.name, $state) : null} aria-disabled={blocked(it.name, $state, $off)} @class{blocked(it.name, $state, $off)}="blocked" @click={fire(it.name)}>
        <!-- @@ tool-icons -->
        {if it.icon}
          <span class="ico" aria-hidden="true">{{ it.icon }}</span>
        {else}
        <!-- @@ -->
          <span class={"glyph " + it.cls} aria-hidden="true">{it.glyph}</span>
        <!-- @@ tool-icons -->
        {end}
        <!-- @@ -->
      </button>
    <!-- @@ tool-separator -->
    {end}
    <!-- @@ -->
  {end}
</div>

<@document @pointerup={release()} @pointercancel={release()}>

<style @display="block">
  :host
    font: inherit

  .bar
    display: flex
    flex-wrap: wrap
    align-items: center
    gap: 2px
    padding: 6px 8px
    background: var(--mjs-editor-bar-bg, var(--mjs-hover, rgba(#7f7f7f, .1)))
    color: var(--mjs-editor-fg, var(--mjs-fg, inherit))

  // @@ tool-separator
  .sep
    width: 1px
    height: 18px
    margin: 0 5px
    background: var(--mjs-editor-border, var(--mjs-border, rgba(#7f7f7f, .45)))
  // @@

  .btn
    display: inline-flex
    align-items: center
    justify-content: center
    min-width: 32px
    height: 32px
    padding: 0 6px
    border: 1px solid transparent
    border-radius: var(--mjs-editor-btn-radius, 7px)
    background: none
    color: inherit
    font: inherit
    font-size: .9rem
    line-height: 1
    cursor: pointer
    transition: background-color .12s ease, border-color .12s ease

    &:hover
      border-color: var(--mjs-editor-border, var(--mjs-border, rgba(#7f7f7f, .45)))

    &:focus-visible
      outline: 3px solid var(--mjs-editor-focus, rgba(#3b82f6, .45))
      outline-offset: 0

    &[aria-pressed="true"]
      background: var(--mjs-editor-accent, var(--mjs-accent, #3b82f6))
      border-color: var(--mjs-editor-accent, var(--mjs-accent, #3b82f6))
      color: var(--mjs-editor-accent-fg, #fff)

    &.blocked
      opacity: .38
      cursor: not-allowed

  // @@ tool-icons
  .ico
    display: inline-flex

    svg
      width: 16px
      height: 16px
      fill: none
      stroke: currentColor
      stroke-width: 1.6
      stroke-linecap: round
      stroke-linejoin: round

      // @@ tool-ul
      circle
        fill: currentColor
        stroke: none
      // @@

      // @@ tool-ol
      .n
        fill: currentColor
        stroke: none
        font-size: 5.4px
        font-weight: 700
      // @@
  // @@

  // @@ tool-glyphs
  .glyph
    min-width: 1em
    text-align: center
  // @@

  // @@ tool-bold
  .g-bold
    font-weight: 800
  // @@

  // @@ tool-italic
  .g-italic
    font-style: italic
    font-family: Georgia, "Times New Roman", serif
  // @@

  // @@ tool-underline
  .g-underline
    text-decoration: underline
  // @@

  // @@ tool-strike
  .g-strike
    text-decoration: line-through
  // @@

  // @@ tool-color
  .g-color
    font-weight: 700
    text-decoration: underline 3px var(--mjs-editor-color-red, #dc2626)
    text-underline-offset: 2px
  // @@

  // @@ tool-heads
  .g-head
    font-size: .8rem
    font-weight: 700
    letter-spacing: -.02em
  // @@

  // @@ tool-quote
  .g-quote
    font-family: Georgia, "Times New Roman", serif
    font-size: 1.5rem
    font-weight: 700
    line-height: .8
    padding-top: .25em
  // @@

  @media (prefers-reduced-motion: reduce)
    .btn
      transition: none

  @media (forced-colors: active)
    .btn[aria-pressed="true"]
      outline: 2px solid Highlight
</style>
