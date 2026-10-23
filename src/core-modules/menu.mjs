<script>
  $open       = false
  $color      = ''
  $background = ''
  $radius     = 115
  $label      = null

  # libellé par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang)-> µ._mjs_label('core', key)
  $labelText = $label ?? tr('menuLabel', µlang)

  boolAttr = (v)-> v !== undefined and v !== false and v !== 'false'
  num      = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d

  slotRef   = null
  toggleRef = null
  items     = []

  # radial : chaque entrée prend son angle autour du bouton central, la première à gauche
  refresh = ->
    return unless slotRef
    items = slotRef.assignedElements()
    for el, i in items
      el.style.setProperty('--mjs-menu-i', String(i))
      el.style.setProperty('--mjs-menu-n', String(items.length))

  toggle = ->
    $open = not boolAttr($open)
    µemit 'change', $open

  # Échap referme le menu ouvert et rend le focus à son bouton ; un Échap déjà pris par un élément du menu (liste ouverte, champ) le laisse ouvert
  onKey = (e)->
    return unless e.key is 'Escape' and boolAttr($open) and not e.defaultPrevented
    e.preventDefault()
    toggle()
    toggleRef?.focus()

  # sur l'hôte : une touche venue d'une entrée (contenu projeté) y remonte, comme celle du bouton
  µmount =>
    refresh()
    @addEventListener('keydown', onKey)

  µdestroy =>
    @removeEventListener('keydown', onKey)
    for el in items
      el.style.removeProperty('--mjs-menu-i')
      el.style.removeProperty('--mjs-menu-n')
</script>

{if µlayout is 'drawer'}
  <div class="drawer" part="menu" @class{boolAttr($open)}="open" --mjs-menu-color={$color or '#379fff'} --mjs-menu-bg={$background or '#fff'}>
    <button type="button" class="tab" part="toggle" aria-label={$labelText} aria-expanded={boolAttr($open)} @this=!{toggleRef} @click={toggle()}><span></span></button>
    <nav class="panel" part="panel">
      <slot @this=!{slotRef} @slotchange={refresh()}></slot>
    </nav>
  </div>
{else}
  <div class="radial" part="menu" @class{boolAttr($open)}="open" --mjs-menu-color={$color or '#fff'} --mjs-menu-bg={$background or '#222327'} --mjs-menu-radius={num($radius, 115) + 'px'}>
    <button type="button" class="toggle" part="toggle" aria-label={$labelText} aria-expanded={boolAttr($open)} @this=!{toggleRef} @click={toggle()}></button>
    <nav class="ring" part="panel">
      <slot @this=!{slotRef} @slotchange={refresh()}></slot>
    </nav>
  </div>
{end}

<style @display="inline-block">
  .radial
    position: relative
    display: grid
    place-items: center
    width: calc(var(--mjs-menu-radius) * 2 + 80px)
    height: calc(var(--mjs-menu-radius) * 2 + 80px)

  // le bouton vient d'abord dans l'ordre de tabulation, les entrées ensuite : l'anneau, peint par-dessus
  // lui, laisse passer les clics — seules ses entrées les prennent
  .ring
    position: absolute
    inset: 0
    display: grid
    place-items: center
    pointer-events: none

  // chaque entrée à sa place sur le cercle (`radius` : la distance de son centre au centre du bouton),
  // ouverte ou fermée : elle apparaît et disparaît sur place
  .radial ::slotted(*)
    position: absolute
    display: flex
    justify-content: center
    align-items: center
    box-sizing: border-box
    width: 50px
    height: 50px
    border-radius: 50%
    font-size: 1.75em
    color: var(--mjs-menu-bg)
    text-decoration: none
    opacity: 0
    visibility: hidden
    transform: rotate(calc(180deg + 360deg / var(--mjs-menu-n) * var(--mjs-menu-i))) translate(var(--mjs-menu-radius)) rotate(calc(-180deg - 360deg / var(--mjs-menu-n) * var(--mjs-menu-i)))
    transition: .5s, background 1s
    z-index: 1
    pointer-events: auto

  .radial.open ::slotted(*)
    opacity: 1
    visibility: visible

  .radial ::slotted(*:hover)
    border: 2px solid var(--mjs-menu-bg)
    background: var(--mjs-menu-hover, #29fd53)
    transition: .5s, background 0s

  .toggle
    position: relative
    width: 75px
    height: 75px
    padding: 0
    border: 0
    border-radius: 50%
    background: var(--mjs-menu-color)
    cursor: pointer
    transition: .5s
    transition-delay: .25s

    &::before, &::after
      content: ''
      position: absolute
      top: calc(50% - 1.5px)
      left: 25%
      width: 50%
      height: 3px
      border-radius: 2px
      background: var(--mjs-menu-bg)

    &::after
      rotate: 90deg

  // ouvert : deux anneaux autour du bouton, un sombre puis un clair large de 65 px — les entrées (50 px)
  // tombent en son milieu, à `radius` du centre
  .radial.open .toggle
    transform: rotate(315deg)
    box-shadow: 0 0 0 max(0px, calc(var(--mjs-menu-radius) - 70px)) var(--mjs-menu-bg), 0 0 0 calc(var(--mjs-menu-radius) - 5px) var(--mjs-menu-color)
    transition-delay: 0s

  .drawer
    position: relative

  .panel
    display: flex
    flex-direction: column
    width: 80px
    padding: 30px 10px
    box-sizing: border-box
    border-radius: 10px
    background: var(--mjs-menu-bg)
    box-shadow: 20px 20px 50px rgba(0, 0, 0, .05)
    overflow: hidden
    transition: width .5s

  .drawer.open .panel
    width: 300px

  // l'icône dans sa colonne de 60 px, le libellé au-delà : fermé (80 px), le tiroir ne montre que les
  // icônes. L'icône : l'attribut icon de l'entrée (icon="☺"), ou son premier élément (un svg, une image)
  .drawer ::slotted(*)
    display: grid
    grid-template-columns: 60px max-content
    column-gap: 10px
    justify-items: safe center
    align-items: center
    min-height: 60px
    border-radius: 30px
    color: #111
    font-size: 1.25em
    white-space: nowrap
    text-decoration: none

  .drawer ::slotted([icon])::before
    content: attr(icon)
    font-size: 1.2em

  .drawer ::slotted(*:hover)
    background: var(--mjs-menu-color)
    color: #fff

  .tab
    position: absolute
    top: 50%
    right: -25px
    z-index: 2
    width: 25px
    height: 50px
    padding: 0
    border: 0
    border-radius: 0 25px 25px 0
    background: var(--mjs-menu-bg)
    cursor: pointer
    transform: translateY(-50%)

    &::before, &::after
      content: ''
      position: absolute
      left: 0
      width: 15px
      height: 15px
      background: transparent

    &::before
      top: -12px
      border-bottom-left-radius: 15px
      box-shadow: -5px 2px var(--mjs-menu-bg)

    &::after
      bottom: -12px
      border-top-left-radius: 15px
      box-shadow: -5px -2px var(--mjs-menu-bg)

    span
      position: absolute
      top: calc(50% - 5px)
      left: 4px
      width: 8px
      height: 8px
      border-top: 2px solid var(--mjs-menu-color)
      border-right: 2px solid var(--mjs-menu-color)
      transform: rotate(45deg)
      transition: .5s

  .drawer.open .tab span
    transform: rotate(225deg)

  @media (prefers-reduced-motion: reduce)
    .radial ::slotted(*), .toggle, .panel, .tab span
      transition: none
</style>
