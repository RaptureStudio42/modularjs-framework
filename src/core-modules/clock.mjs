<script>
  $seconds = 60
  $running = true
  $colors  = ''
  $color   = '#00ff43'
  $labels  = null
  $ampm    = true

  boolAttr = (v)-> v !== undefined and v !== false and v !== 'false'
  num      = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d
  zero     = (n)-> if n < 10 then '0' + n else String(n)
  liste    = (v, d)-> if Array.isArray(v) then v else if v then String(v).split(',').map((x)-> x.trim()) else d

  TICKS = [1..60]

  $h   = 0
  $m   = 0
  $s   = 0
  $pm  = false
  $t   = 0

  timer = null

  # l'heure : trois cadrans de 60 traits, le trait courant s'allume, ceux d'après s'éteignent
  tick = ->
    d   = new Date()
    h   = d.getHours() % 12
    $h  = if h is 0 then 12 else h
    $m  = d.getMinutes()
    $s  = d.getSeconds()
    $pm = d.getHours() >= 12

  # le minuteur compte sur l'horloge monotone, pas sur les passages de l'intervalle : un passage en retard (page
  # chargée, onglet ralenti) rattrape les secondes écoulées au lieu de les perdre, et chacune annonce son `tick`.
  # Son compte tient dans des variables simples, jamais dans `$t` ni `$seconds` : l'effet qui pose l'intervalle
  # hérite de tout ce que `step` lit, et couperait puis reposerait l'intervalle à chaque seconde
  origin = 0
  seen   = 0
  base   = 0
  last   = 0
  total  = 60

  µeffect -> total = Math.max(1, num($seconds, 60))

  # un quart de seconde d'avance permis : un intervalle ne tombe jamais pile sur la seconde
  step = ->
    gone = Math.floor((performance.now() - origin) / 1000 + .25)
    return if gone <= seen
    k = Math.max(seen, gone - total)
    while k < gone
      k++
      last = (base + k) % total
      $t   = last
      µemit 'tick', last
    seen = gone

  # un minuteur relancé repart du chiffre où il s'était arrêté, l'attente ne compte pas
  start = ->
    clearInterval(timer)
    if µlayout is 'timer'
      if boolAttr($running)
        origin = performance.now()
        seen   = 0
        base   = last
        timer  = setInterval(step, 1000)
    else
      tick()
      timer = setInterval(tick, 1000)

  µeffect ->
    µlayout
    $running
    start()

  µdestroy ->
    clearInterval(timer)

  # noms des cadrans par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang)-> µ._mjs_label('core', key)

  $names = liste($labels, [tr('clockHours', µlang), tr('clockMinutes', µlang), tr('clockSeconds', µlang)])

  # les cadrans : un état posé par un effet, pas un dérivé — un {for} sur un dérivé dont le corps lit
  # $h, $m ou $s était reconstruit en entier à chaque seconde (les 180 traits recréés)
  $dials = []

  µeffect ->
    c      = liste($colors, [])
    $dials = if µlayout isnt 'timer' then [['h', c[0] or '#ff2972'], ['m', c[1] or '#fee800'], ['s', c[2] or '#04fc43']] else []

  # les valeurs passent en argument : le gabarit suit ainsi $h, $m et $s
  valeur  = (k, h, m, s)-> if k is 'h' then h else if k is 'm' then m else s
  # 0 minute, 0 seconde : le trait du haut, le 60
  actif   = (k, i, h, m, s)-> if k is 'h' then i is h * 5 else i is (valeur(k, h, m, s) or 60)
  ampmOf  = (pm)-> if pm then 'PM' else 'AM'

  # la part du compte écoulée, de 0 à 1 : l'aiguille et le point la lisent sur le chiffre lui-même —
  # des animations CSS repartaient de zéro à chaque reprise quand le chiffre, lui, continuait
  progress = (t, total)-> Math.min(1, t / Math.max(1, num(total, 60)))
</script>

{if µlayout is 'timer'}
  <div class="timer" part="timer" @class{boolAttr($running)}="running" --mjs-clock-color={$color} --mjs-clock-total={num($seconds, 60) + 's'} --mjs-clock-p={progress($t, $seconds)}>
    <div class="dial">
      <svg viewBox="0 0 150 150" aria-hidden="true">
        <circle cx="75" cy="75" r="70"></circle>
        <circle class="hand" cx="75" cy="75" r="70"></circle>
      </svg>
      <div class="dot"></div>
      <div class="number" role="timer">
        <b>{zero($t)}</b>
        <p>{$names[2] or tr('clockSeconds', µlang)}</p>
      </div>
    </div>
  </div>
{else}
  <div class="clock" part="clock">
    {for i, dial in $dials}
      <div class="dots" --mjs-clock-color={dial[1]}>
        {if dial[0] is 's' and boolAttr($ampm)}
          <b class="ampm">{ampmOf($pm)}</b>
        {end}
        <h2>{zero(valeur(dial[0], $h, $m, $s))}<span>{$names[i]}</span></h2>
        {for n in TICKS}
          <i class="tick" @class{actif(dial[0], n, $h, $m, $s)}="active" @class{dial[0] is 'h'}="hour" @class{n % 5 is 0}="five" --mjs-clock-a={n * 6 + 'deg'}></i>
        {end}
      </div>
    {end}
  </div>
{end}

<style @display="inline-block">
  .clock
    display: flex
    flex-wrap: wrap
    justify-content: center
    align-items: center
    gap: 80px
    padding: 30px

  .dots
    position: relative
    width: 200px
    height: 200px
    border-radius: 50%

    &::before
      content: ''
      position: absolute
      inset: -20px
      border-radius: 50%
      box-shadow: 25px 25px 75px rgba(0, 0, 0, .25), 10px 10px 70px rgba(0, 0, 0, .25), inset 5px 5px 10px rgba(0, 0, 0, .5), inset 5px 5px 20px rgba(255, 255, 255, .2), inset -5px -5px 15px rgba(0, 0, 0, .75)

    h2
      position: absolute
      inset: 0
      display: flex
      flex-direction: column
      justify-content: center
      align-items: center
      margin: 0
      color: var(--mjs-clock-color)
      font-size: 4em
      font-weight: 500

      span
        position: absolute
        bottom: 50px
        font-size: .25em
        letter-spacing: .1em
        text-transform: uppercase

  .ampm
    position: absolute
    color: #fff
    transform: rotate(-90deg) translate(-30px, 90px)

  .tick
    position: absolute
    top: 50%
    left: 0
    width: 10px
    height: 3px
    background: var(--mjs-clock-color)
    transform-origin: 100px
    transform: rotate(var(--mjs-clock-a))

    &.five
      width: 20px

    &.hour
      width: 20px

      &::before
        content: ''
        position: absolute
        top: 10px
        left: 0
        width: 4px
        height: 4px
        border-radius: 4px
        background: var(--mjs-clock-color)
        box-shadow: 1.5px 9px var(--mjs-clock-color), 4px 18px var(--mjs-clock-color), 7px 27px var(--mjs-clock-color)

    &.active
      box-shadow: 0 0 10px var(--mjs-clock-color), 0 0 20px var(--mjs-clock-color), 0 0 30px var(--mjs-clock-color)

  .tick.active ~ .tick
    background: #555

    &.hour::before
      background: #555
      box-shadow: 1.5px 9px #555, 4px 18px #555, 7px 27px #555

  .timer
    display: flex
    justify-content: center
    align-items: center
    width: 250px
    height: 250px

    &.running
      animation: mjs-clock-hue calc(var(--mjs-clock-total) * 1) linear infinite

  .dial
    position: relative
    width: 150px
    height: 150px
    border-radius: 50%
    background: #333

    svg
      position: relative
      width: 150px
      height: 150px
      transform: rotate(270deg)

    circle
      fill: none
      stroke: #191919
      stroke-width: 2

    .hand
      stroke: var(--mjs-clock-color)
      stroke-dasharray: 440
      stroke-dashoffset: calc(440px - 440px * var(--mjs-clock-p, 0))

  .dot
    position: absolute
    inset: 5px
    z-index: 10
    border-radius: 50%
    transform: rotate(calc(360deg * var(--mjs-clock-p, 0)))

    &::before
      content: ''
      position: absolute
      top: -5px
      left: 50%
      width: 10px
      height: 10px
      border-radius: 50%
      background: var(--mjs-clock-color)
      transform: translateX(-50%)
      box-shadow: 0 0 10px var(--mjs-clock-color), 0 0 30px var(--mjs-clock-color)

  .number
    position: absolute
    inset: 0
    display: flex
    flex-direction: column
    justify-content: center
    align-items: center

    b
      color: #fff
      font-size: 2.5em
      font-weight: 700
      line-height: 1

    p
      margin: 4px 0 0
      color: rgba(255, 255, 255, .5)
      font-size: .75em
      font-weight: 300

  @keyframes mjs-clock-hue
    0%
      filter: hue-rotate(0deg)
    100%
      filter: hue-rotate(720deg)

  @media (prefers-reduced-motion: reduce)
    .timer.running
      animation: none
</style>
