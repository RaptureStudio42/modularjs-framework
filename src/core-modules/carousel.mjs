<script>
  $index   = 0
  $width   = 200
  $height  = 300
  $wheel   = false
  $buttons = true
  $reflect = true
  $loop    = true
  $prevLabel = null
  $nextLabel = null

  # libellés par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang)-> µ._mjs_label('core', key)

  $prevText = $prevLabel ?? tr('carouselPrev', µlang)
  $nextText = $nextLabel ?? tr('carouselNext', µlang)

  boolAttr = (v)-> v !== undefined and v !== false and v !== 'false'
  num      = (v, d)-> if isFinite(Number(v)) and v !== '' and v? then Number(v) else d

  # place de chaque vignette selon son écart au centre : décalage, échelle, rotation, profondeur
  PLACES = {
    '-3': [-250, .8, 25, 1]
    '-2': [-250, .8, 25, 2]
    '-1': [-150, .9, 15, 3]
    '0':  [0, 1, 0, 4]
    '1':  [150, .9, -15, 3]
    '2':  [250, .8, -25, 2]
    '3':  [250, .8, -25, 1]
  }

  slotRef  = null
  items    = []
  lastWheel = 0

  $count = 0

  refresh = ->
    return unless slotRef
    items  = slotRef.assignedElements()
    $count = items.length
    place()

  # écart au centre : au plus court autour de l'anneau quand la boucle est permise
  gap = (i, cur, n)->
    d = i - cur
    if boolAttr($loop) and n > 0
      d = ((d % n) + n) % n
      d -= n if d > n / 2
    d

  # l'index lu, arrondi : lié à un curseur ou calculé, il peut arriver non entier ; sans boucle, il est ramené entre la première et la
  # dernière vignette (un index trop grand, ou une liste qui rétrécit sous un index lié, rendait toutes les vignettes invisibles)
  indexOf = ->
    i = Math.round(num($index, 0))
    if boolAttr($loop) then i else Math.max(0, Math.min(items.length - 1, i))

  # les écarts de la démo valent pour des vignettes de 200 px : ils suivent la largeur
  place = ->
    n   = items.length
    cur = indexOf()
    flat = µlayout is 'flat'
    for el, i in items
      d = gap(i, cur, n)
      p = PLACES[String(Math.max(-3, Math.min(3, d)))]
      el.setAttribute('mjs-carousel-pos', String(d))
      el.style.setProperty('--mjs-carousel-x', (p[0] * num($width, 200) / 200) + 'px')
      el.style.setProperty('--mjs-carousel-s', String(if flat and d is 3 then 1 else p[1]))
      el.style.setProperty('--mjs-carousel-r', (if flat then 0 else p[2]) + 'deg')
      el.style.setProperty('--mjs-carousel-z', String(if Math.abs(d) > 3 then 0 else (if not flat and d is 3 then -1 else p[3])))
      el.style.setProperty('--mjs-carousel-o', String(if Math.abs(d) > 3 then 0 else 1))

  go = (step)->
    n = items.length
    return if n is 0
    next = indexOf() + step
    if boolAttr($loop)
      next = ((next % n) + n) % n
    else
      next = Math.max(0, Math.min(n - 1, next))
    # une seule vignette, ou le bout atteint sans boucle : rien ne bouge, rien à émettre
    return if next is indexOf()
    $index = next
    µemit 'change', next

  # un glissé horizontal du pavé tactile n'est pas un cran de molette : la page le garde
  onWheel = (e)->
    return unless boolAttr($wheel)
    return unless Math.abs(e.deltaY) > Math.abs(e.deltaX)
    e.preventDefault()
    return if e.timeStamp - lastWheel < 180
    lastWheel = e.timeStamp
    go(if e.deltaY > 0 then 1 else -1)

  # une touche tapée dans ce qu'on a glissé (le champ d'une vignette) reste à ce contenu
  onKey = (e)->
    return unless e.target.getRootNode() is slotRef.getRootNode()
    if e.key is 'ArrowRight'
      e.preventDefault()
      go(1)
    else if e.key is 'ArrowLeft'
      e.preventDefault()
      go(-1)

  µeffect ->
    $index
    µlayout
    $loop
    $width
    place()

  # l'écouteur de molette retient le défilement de la page (non passif) : il n'est posé que si `wheel` est écrit
  µeffect =>
    return unless boolAttr($wheel)
    @addEventListener('wheel', onWheel, { passive: false })
    => @removeEventListener('wheel', onWheel)

  µmount =>
    refresh()
    slotRef.addEventListener('slotchange', refresh)

  µdestroy =>
    for el in items
      el.removeAttribute('mjs-carousel-pos')
      for p in ['--mjs-carousel-x', '--mjs-carousel-s', '--mjs-carousel-r', '--mjs-carousel-z', '--mjs-carousel-o']
        el.style.removeProperty(p)
</script>

<div class="carousel" part="carousel" role="region" aria-roledescription="carrousel" tabindex="0" @class{µlayout is 'flat'}="flat" @class{boolAttr($reflect) and µlayout isnt 'flat'}="reflect" --mjs-carousel-w={num($width, 200) + 'px'} --mjs-carousel-h={num($height, 300) + 'px'} @keydown={onKey(e)}>
  <div class="stage" part="stage">
    <slot @this=!{slotRef}></slot>
  </div>
  {if boolAttr($buttons)}
    <div class="buttons" part="buttons">
      <button type="button" class="prev" part="button" aria-label={$prevText} @click={go(-1)}></button>
      <button type="button" class="next" part="button" aria-label={$nextText} @click={go(1)}></button>
    </div>
  {end}
</div>

<style @display="block">
  .carousel
    position: relative
    display: flex
    flex-direction: column
    align-items: center
    gap: 40px
    padding: 20px 0 30px
    outline: none

    // sans boutons, le clavier est la seule commande : la zone focalisée doit se voir
    &:focus-visible
      border-radius: 12px
      box-shadow: 0 0 0 3px rgba(59, 130, 246, .35)

  .stage
    position: relative
    width: 100%
    height: var(--mjs-carousel-h)
    transform-style: preserve-3d
    perspective: 500px

  ::slotted(*)
    position: absolute
    top: 0
    left: calc(50% - var(--mjs-carousel-w) / 2)
    box-sizing: border-box
    width: var(--mjs-carousel-w)
    height: var(--mjs-carousel-h)
    box-shadow: var(--mjs-carousel-shadow, 0 0 50px rgba(0, 0, 0, .5))
    transform-origin: bottom
    transform-style: preserve-3d
    transform: translate3d(var(--mjs-carousel-x, 0px), 0, 0) scale(var(--mjs-carousel-s, 1)) rotateY(var(--mjs-carousel-r, 0deg))
    z-index: var(--mjs-carousel-z, 0)
    opacity: var(--mjs-carousel-o, 1)
    transition: transform .5s, opacity .5s
    user-select: none

  .carousel.reflect ::slotted(*)
    -webkit-box-reflect: below 1px linear-gradient(transparent, transparent, #0002)

  .carousel.flat ::slotted(*)
    transition: transform .25s, opacity .25s

  .buttons
    display: flex
    gap: 20px

  button
    position: relative
    width: 50px
    height: 50px
    padding: 0
    border: 2px solid var(--mjs-carousel-button, #fff)
    border-radius: 50%
    background: none
    cursor: pointer
    opacity: .5
    transition: opacity .2s

    &:hover, &:focus-visible
      opacity: 1

    &::before
      content: ''
      position: absolute
      top: calc(50% - 6px)
      width: 10px
      height: 10px
      border-top: 2px solid var(--mjs-carousel-button, #fff)
      border-left: 2px solid var(--mjs-carousel-button, #fff)

  .prev::before
    left: 19px
    rotate: -45deg

  .next::before
    right: 19px
    rotate: 135deg

  @media (prefers-reduced-motion: reduce)
    ::slotted(*)
      transition: none
</style>
