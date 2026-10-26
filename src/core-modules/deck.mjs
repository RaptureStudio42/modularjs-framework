<script>
  $width  = 240
  $height = 320
  $gap    = ''
  $angle  = 5
  $color  = '#ff003b'

  num = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d

  $gapPx = num($gap, if µlayout is 'spread' then 320 else 120) + 'px'

  slotRef = null
  items   = []

  # rang de chaque carte, centré sur le milieu du paquet : -1, 0, 1 pour trois cartes
  refresh = ->
    return unless slotRef
    items = slotRef.assignedElements()
    mid   = (items.length - 1) / 2
    for el, i in items
      el.style.setProperty('--mjs-deck-i', String(i - mid))

  µmount ->
    refresh()
    slotRef.addEventListener('slotchange', refresh)

  µdestroy ->
    for el in items
      el.style.removeProperty('--mjs-deck-i')
</script>

<div class="deck" part="deck" @class{µlayout is 'spread'}="spread" @class{µlayout isnt 'spread'}="fan" --mjs-deck-w={num($width, 240) + 'px'} --mjs-deck-h={num($height, 320) + 'px'} --mjs-deck-gap={$gapPx} --mjs-deck-angle={num($angle, 5) + 'deg'} --mjs-deck-color={$color}>
  <slot @this=!{slotRef}></slot>
</div>

<style @display="block">
  // contexte d'empilement propre : les cartes du fond (z-index négatif, layout spread) passaient sous le
  // fond d'une section ou d'une carte qui contient le paquet
  .deck
    position: relative
    isolation: isolate
    display: flex
    justify-content: center
    align-items: center
    width: 100%
    min-height: calc(var(--mjs-deck-h) + 120px)

  ::slotted(*)
    position: absolute
    box-sizing: border-box
    width: var(--mjs-deck-w)
    height: var(--mjs-deck-h)
    transition: transform .5s, translate .5s, opacity .5s, filter .5s, top .5s
    cursor: pointer

  .fan ::slotted(*)
    border-radius: 10px
    filter: grayscale(1) contrast(2)

  // le clavier comme la souris : le focus dans le paquet ouvre l'éventail, la carte qui le tient (ou dont un élément le tient) se soulève ;
  // `:host` hausse la carte survolée au poids de l'éventail ouvert au clavier : la carte soulevée passe toujours devant
  .fan:hover ::slotted(*), :host(:focus-within) .fan ::slotted(*)
    transform: rotate(calc(var(--mjs-deck-i) * var(--mjs-deck-angle))) translate(calc(var(--mjs-deck-i) * var(--mjs-deck-gap)), -50px)
    opacity: .5

  :host .fan ::slotted(*:hover), :host(:focus-within) .fan ::slotted(*:focus-within)
    translate: calc(var(--mjs-deck-i) * 20px) -50px
    z-index: 100
    opacity: 1
    filter: none

  .fan ::slotted(*)::before
    content: attr(title)
    position: absolute
    top: 0
    left: 0
    right: 0
    z-index: 1000
    color: #fff
    font-size: 1.25em
    font-weight: 500
    letter-spacing: .15em
    text-align: center
    text-transform: uppercase
    white-space: nowrap
    opacity: 0
    transform: translateY(100px)
    transition: .5s

  .fan ::slotted(*:hover)::before, .fan ::slotted(*:focus-within)::before
    top: -40px
    opacity: 1
    transform: translateY(0)

  // la barre de couleur, peinte au milieu d'une zone sans fond qui couvre aussi la place que la carte soulevée quitte (60 px au moins sous
  // elle, et de côté autant qu'elle glisse) : le pointeur posé près d'un bord garde le survol, la carte ne retombe plus sous lui pour se
  // soulever encore. La zone ne capte le pointeur que pendant le survol (`pointer-events`, qui ne transite pas : il change d'un coup) ;
  // seule la barre se déplie et se replie (`background-size`) ; au-dessus de la carte, seule la barre compte (la découpe). Une zone
  // encore touchable pendant le repli resterait 0,5 s sous la carte qui retombe : la carte balaierait le pointeur posé dessous, se
  // relèverait, le lâcherait, et ainsi de suite
  .fan ::slotted(*)::after
    content: ''
    position: absolute
    top: -100px
    left: calc(max(var(--mjs-deck-i, 0), -1 * var(--mjs-deck-i, 0)) * -20px - 10px)
    right: calc(max(var(--mjs-deck-i, 0), -1 * var(--mjs-deck-i, 0)) * -20px - 10px)
    height: max(500px, calc(100% + 160px))
    z-index: -1
    background-image: linear-gradient(var(--mjs-deck-color), var(--mjs-deck-color))
    background-position: 50% 0
    background-size: 50px 0
    background-repeat: no-repeat
    clip-path: polygon(calc(50% - 25px) 0, calc(50% + 25px) 0, calc(50% + 25px) 100px, 100% 100px, 100% 100%, 0 100%, 0 100px, calc(50% - 25px) 100px)
    pointer-events: none
    transition: .5s

  .fan ::slotted(*:hover)::after, .fan ::slotted(*:focus-within)::after
    background-size: 50px 500px
    pointer-events: auto

  .spread
    min-height: calc(var(--mjs-deck-h) + 60px)

  .spread ::slotted(*)
    top: calc(50% - var(--mjs-deck-h) / 2)
    left: 50%
    box-shadow: 25px 25px 100px rgba(0, 0, 0, .2)
    transform: translateX(-50%) translateY(calc(50px * var(--mjs-deck-i))) rotate(40deg) skew(-20deg, -10deg) scale(.6)
    z-index: calc(-1 * var(--mjs-deck-i))

  .spread:hover ::slotted(*), :host(:focus-within) .spread ::slotted(*)
    top: 50%
    z-index: 1
    opacity: 1
    transform: translateX(calc(-50% + var(--mjs-deck-gap) * var(--mjs-deck-i))) translateY(-50%) rotate(0deg) skew(0deg, 0deg) scale(1)

  // le titre et la barre aussi : une transition ne passe pas de la carte à ses pseudo-éléments, et leur règle porte `.fan`
  @media (prefers-reduced-motion: reduce)
    ::slotted(*), .fan ::slotted(*)::before, .fan ::slotted(*)::after
      transition: none
</style>
