<script>
  $value     = 0
  $max       = 100
  $scroll    = false
  $follow    = false
  $size      = 100
  $color     = '#3498db'
  $track     = 'rgba(255, 255, 255, .1)'
  $thickness = 4
  $text      = true
  $label     = null

  # libellé par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang)-> µ._mjs_label('core', key)
  $labelText = $label ?? tr('progressLabel', µlang)

  boolAttr = (v)-> v !== undefined and v !== false and v !== 'false'
  num      = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d

  # le cercle de rayon 25 dans une boîte de 100 : l'offset recule le trait
  R = 25
  C = 2 * Math.PI * R

  $pct    = 0
  $x      = 0
  $y      = 0
  $shown  = false

  µeffect ->
    unless boolAttr($scroll)
      m    = num($max, 100)
      $pct = if m > 0 then Math.min(100, Math.max(0, num($value, 0) / m * 100)) else 0

  $offset = C * (1 - $pct / 100)

  onScroll = ->
    return unless boolAttr($scroll)
    top  = window.pageYOffset or document.documentElement.scrollTop
    high = document.documentElement.scrollHeight - document.documentElement.clientHeight
    $pct = if high > 0 then Math.min(100, Math.max(0, top / high * 100)) else 0

  # la souris suivie s'écrit une fois par image, à sa dernière position : plusieurs mouvements entre deux images ne redessinent qu'une fois
  frame = 0
  px    = 0
  py    = 0

  draw = ->
    frame  = 0
    $x     = px
    $y     = py
    $shown = true

  onMove = (e)->
    return unless boolAttr($follow)
    px = e.clientX
    py = e.clientY
    frame ||= requestAnimationFrame(draw)

  # la souris sort de la fenêtre : plus rien à suivre, l'image en attente non plus
  onLeave = (e)->
    return if e.relatedTarget
    cancelAnimationFrame(frame) if frame
    frame  = 0
    $shown = false

  # la fenêtre n'est écoutée que pour ce qui sert : défilement et taille en `scroll`, souris en `follow`
  µeffect ->
    return unless boolAttr($scroll)
    window.addEventListener('scroll', onScroll)
    window.addEventListener('resize', onScroll)
    ->
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)

  µeffect ->
    return unless boolAttr($follow)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseout', onLeave)
    ->
      cancelAnimationFrame(frame) if frame
      frame = 0
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)

  # page rechargée au milieu, ancre, contenu qui grandit : juste dès le montage, pas au premier défilement
  µmount -> onScroll()
</script>

<div class="progress" part="progress" role="progressbar" aria-label={$labelText} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round($pct)} @class{boolAttr($follow)}="follow" @class{$shown}="shown" --mjs-progress-size={num($size, 100) + 'px'} --mjs-progress-x={$x + 'px'} --mjs-progress-y={$y + 'px'}>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="track" cx="50" cy="50" r="25" stroke={$track} stroke-width={num($thickness, 4)}></circle>
    <circle class="bar" cx="50" cy="50" r="25" stroke={$color} stroke-width={num($thickness, 4)} stroke-dasharray={C} stroke-dashoffset={$offset}></circle>
    {if boolAttr($text)}
      <text x="50" y="50" text-anchor="middle" dominant-baseline="middle">{Math.round($pct) + '%'}</text>
    {end}
  </svg>
</div>

<style @display="inline-block">
  .progress
    width: var(--mjs-progress-size)
    height: var(--mjs-progress-size)

  .follow
    position: fixed
    top: 0
    left: 0
    z-index: 1000
    pointer-events: none
    opacity: 0
    transform: translate(calc(var(--mjs-progress-x) - 50%), calc(var(--mjs-progress-y) - 50%))

    &.shown
      opacity: 1

  svg
    width: 100%
    height: 100%

  circle
    fill: none

  .bar
    transform: rotate(-90deg)
    transform-origin: 50% 50%
    transition: stroke-dashoffset .15s

  text
    fill: currentColor
    font-size: 16px

  @media (prefers-reduced-motion: reduce)
    .bar
      transition: none
</style>
