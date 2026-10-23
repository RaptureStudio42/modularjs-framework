<script>
  $value      = null
  $color      = '#fff'
  $accent     = '#4187f6'
  $background = '#2b343b'
  $gap        = 60

  num = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d

  slotRef = null
  boxRef  = null
  items   = []

  $barLeft   = 0
  $barWidth  = 0
  $pillTop   = 0
  $pillH     = 0
  $ready     = false

  # la valeur d'un onglet : son attribut value, sinon son rang
  valueOf = (el, i)-> el.getAttribute('value') ?? String(i)

  activeIndex = ->
    i = items.findIndex (el, k)-> valueOf(el, k) == String($value)
    if i >= 0 then i else 0

  # l'onglet actif porte l'attribut `active` (stylable), l'indicateur se cale sur lui ; tabindex
  # itinérant : un onglet est souvent un <span> ou un <a> sans href, jamais focalisable — seul l'actif
  # entre dans l'ordre de tabulation, les flèches mènent aux autres
  sync = ->
    return unless items.length
    a = activeIndex()
    for el, i in items
      if i is a
        el.setAttribute('active', '')
        el.setAttribute('aria-selected', 'true')
      else
        el.removeAttribute('active')
        el.setAttribute('aria-selected', 'false')
      el.setAttribute('role', 'tab')
      el.tabIndex = if i is a then 0 else -1
    # la place de l'onglet dans la barre : un onglet projeté n'a pas la barre pour offsetParent
    box = boxRef.getBoundingClientRect()
    r   = items[a].getBoundingClientRect()
    # dans un bloc rapetissé (zoom, transform: scale), les mesures à l'écran sont déjà réduites :
    # ramenées à l'échelle de la barre avant d'y être reportées
    kx = if boxRef.offsetWidth and box.width then box.width / boxRef.offsetWidth else 1
    ky = if boxRef.offsetHeight and box.height then box.height / boxRef.offsetHeight else 1
    $barLeft  = (r.left - box.left) / kx
    $barWidth = r.width / kx
    $pillTop  = (r.top - box.top) / ky
    $pillH    = r.height / ky
    $ready    = true

  refresh = ->
    return unless slotRef
    items = slotRef.assignedElements()
    $value = valueOf(items[0], 0) if not $value? and items.length
    sync()

  pick = (e)->
    path = e.composedPath()
    i = items.findIndex (el)-> path.includes(el)
    return if i < 0
    # l'onglet déjà actif : rien ne change, rien à annoncer, comme au clavier
    return if valueOf(items[i], i) == String($value)
    $value = valueOf(items[i], i)
    µemit 'change', $value

  onKey = (e)->
    return unless items.length
    # Alt, Ctrl et Méta gardent leurs raccourcis au navigateur (Alt+← est le « retour », Ctrl+Fin le bas de la page)
    return if e.altKey or e.ctrlKey or e.metaKey
    a = activeIndex()
    n = if e.key is 'ArrowRight' or e.key is 'ArrowDown' then a + 1 else if e.key is 'ArrowLeft' or e.key is 'ArrowUp' then a - 1 else if e.key is 'Home' then 0 else if e.key is 'End' then items.length - 1 else -1
    return if n < 0 or n >= items.length
    e.preventDefault()
    if n isnt a
      $value = valueOf(items[n], n)
      µemit 'change', $value
    items[n].focus?()

  # tout ce que le module écoute ou observe tient à sa présence dans la page : l'attache joue à chaque arrivée (le retour d'une page
  # en cache compris), son nettoyage à chaque départ ; un observateur resté sur une barre sortie de la page livrerait sa taille nulle
  # à `sync`, qui mesurerait une barre que `boxRef` ne désigne plus — sur l'hôte, un clic sur un onglet (contenu projeté) y remonte toujours
  watch = (bar)=>
    slot = bar.querySelector('slot')
    slot.addEventListener('slotchange', refresh)
    @addEventListener('click', pick)
    @addEventListener('keydown', onKey)
    ro = null
    ro = new ResizeObserver(sync) if typeof ResizeObserver is 'function'
    ro?.observe(bar)
    =>
      slot.removeEventListener('slotchange', refresh)
      @removeEventListener('click', pick)
      @removeEventListener('keydown', onKey)
      ro?.disconnect()

  µeffect ->
    $value
    queueMicrotask sync

  µmount => refresh()

  µdestroy =>
    for el in items
      el.removeAttribute('role')
      el.removeAttribute('tabindex')
      el.removeAttribute('aria-selected')
</script>

<div class="tabs" part="tabs" role="tablist" @this=!{boxRef} @attach={watch} @class{µlayout is 'curve'}="curve" @class{µlayout isnt 'curve'}="slide" --mjs-tabs-color={$color} --mjs-tabs-accent={$accent} --mjs-tabs-bg={$background} --mjs-tabs-gap={num($gap, 60) + 'px'}>
  {if µlayout is 'curve'}
    <span class="pill" part="indicator" @class{$ready}="ready" --mjs-tabs-top={$pillTop + 'px'} --mjs-tabs-h={$pillH + 'px'}></span>
  {end}
  <slot @this=!{slotRef}></slot>
  {if µlayout isnt 'curve'}
    <span class="bar" part="indicator" @class{$ready}="ready" --mjs-tabs-left={$barLeft + 'px'} --mjs-tabs-width={$barWidth + 'px'}></span>
  {end}
</div>

<style @display="inline-block">
  .tabs
    position: relative
    display: flex

  .slide
    gap: var(--mjs-tabs-gap)
    padding: 30px 40px
    border-bottom: 1px solid rgba(255, 255, 255, .2)
    border-radius: 20px
    background: var(--mjs-tabs-panel, #182d3c)
    overflow: hidden

  .slide ::slotted(*)
    color: transparent
    -webkit-text-stroke: 1px var(--mjs-tabs-color)
    font-size: 1.75em
    opacity: .3
    cursor: pointer
    transition: .5s

  .slide ::slotted(*:hover)
    opacity: 1
    filter: drop-shadow(0 0 10px var(--mjs-tabs-color)) drop-shadow(0 0 20px var(--mjs-tabs-color))

  .slide ::slotted([active])
    color: var(--mjs-tabs-color)
    opacity: 1
    filter: drop-shadow(0 0 10px var(--mjs-tabs-color)) drop-shadow(0 0 20px var(--mjs-tabs-color))

  .bar
    position: absolute
    bottom: 0
    left: var(--mjs-tabs-left)
    width: var(--mjs-tabs-width)
    height: 5px
    opacity: 0

    &.ready
      opacity: 1
      transition: left .5s, width .5s

    &::before, &::after
      content: ''
      position: absolute
      left: 50%
      width: 40px
      height: 100%
      border-radius: 4px
      background: var(--mjs-tabs-color)
      transform: translateX(-50%)
      filter: drop-shadow(0 0 10px var(--mjs-tabs-color)) drop-shadow(0 0 20px var(--mjs-tabs-color)) drop-shadow(0 0 30px var(--mjs-tabs-color))

    &::after
      filter: drop-shadow(0 0 10px var(--mjs-tabs-color)) drop-shadow(0 0 30px var(--mjs-tabs-color)) blur(5px)

  .curve
    flex-direction: column
    box-sizing: border-box
    width: 70px
    padding: 40px 0 40px 5px
    border-left: 10px solid var(--mjs-tabs-bg)
    background: var(--mjs-tabs-bg)
    box-shadow: 10px 0 0 var(--mjs-tabs-accent)
    overflow-x: hidden
    transition: width .5s

    &:hover
      width: 300px

  // l'icône dans sa colonne de 60 px, le libellé au-delà : au repos (70 px), le menu ne montre que les
  // icônes. L'icône : l'attribut icon de l'onglet (icon="⌂"), ou son premier élément (un svg, une image)
  .curve ::slotted(*)
    position: relative
    z-index: 1
    display: grid
    grid-template-columns: 60px max-content
    column-gap: 10px
    justify-items: safe center
    align-items: center
    box-sizing: border-box
    min-height: 60px
    color: #fff
    white-space: nowrap
    cursor: pointer

  .curve ::slotted([icon])::before
    content: attr(icon)
    font-size: 1.5em

  .pill
    position: absolute
    top: var(--mjs-tabs-top)
    left: 5px
    right: 0
    height: var(--mjs-tabs-h)
    border-radius: 20px 0 0 20px
    background: var(--mjs-tabs-accent)
    opacity: 0

    &.ready
      opacity: 1
      transition: top .5s

    &::before, &::after
      content: ''
      position: absolute
      right: 0
      width: 30px
      height: 30px
      border-radius: 50%
      background: var(--mjs-tabs-bg)

    &::before
      top: -30px
      box-shadow: 15px 15px 0 var(--mjs-tabs-accent)

    &::after
      bottom: -30px
      box-shadow: 15px -15px 0 var(--mjs-tabs-accent)

  @media (prefers-reduced-motion: reduce)
    .bar.ready, .pill.ready, .curve
      transition: none
</style>
