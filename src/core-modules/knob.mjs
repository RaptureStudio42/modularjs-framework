@formAssociated

<script>
  $value        = 50
  $min          = 0
  $max          = 100
  $step         = 1
  $color        = '#66cc66'
  $track        = '#eeeeee'
  $size         = 200
  $arc          = 250
  $offset       = -125
  $thickness    = .3
  $name         = ''
  $label        = null
  $disabled     = false
  $formDisabled = false

  # libellé par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang)-> µ._mjs_label('core', key)
  $labelText = $label ?? tr('knobLabel', µlang)

  # un attribut booléen écrit vaut vrai quelle que soit sa valeur ; absent, posé à `null`, `undefined` ou `false` (`disabled={$x ? true : null}`) ou à
  # « false », quelle que soit sa casse (le rendu serveur la lit ici, sans le socle du cœur qui l'ôte dans le navigateur), il est faux
  boolAttr = (v)-> v? and v !== false and String(v).toLowerCase() !== 'false'
  num      = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d

  # désactivé par lui-même ou par un `<fieldset disabled>` autour de lui (`$formDisabled`, posé par le socle du cœur, qui ôte `disabled="false"`)
  $off = boolAttr($disabled) or $formDisabled

  # le cadran : un cercle de rayon 40, dont on ne trace que l'arc voulu
  R = 40
  C = 2 * Math.PI * R

  # un pas nul ou négatif (step="0") divisait par zéro : il retombe sur le pas par défaut
  stepOf = -> if num($step, 1) > 0 then num($step, 1) else 1

  borne = (v)->
    lo = num($min, 0)
    hi = num($max, 100)
    st = stepOf()
    v  = Math.round((v - lo) / st) * st + lo
    Math.min(hi, Math.max(lo, +v.toFixed(6)))

  part = (v, lo, hi)-> if hi > lo then (num(v, lo) - lo) / (hi - lo) else 0

  $arcLen   = C * Math.min(360, Math.max(10, num($arc, 250))) / 360
  $valueLen = $arcLen * Math.min(1, Math.max(0, part($value, num($min, 0), num($max, 100))))
  $turn     = num($offset, -125) - 90
  $stroke   = Math.max(1, Math.min(40, num($thickness, .3) * R))

  dialRef = null
  drag    = false

  # l'angle du pointeur, compté depuis midi dans le sens des aiguilles, ramené sur l'arc
  fromPointer = (e)->
    r   = dialRef.getBoundingClientRect()
    dx  = e.clientX - (r.left + r.width / 2)
    dy  = e.clientY - (r.top + r.height / 2)
    deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
    rel = (deg - num($offset, -125) + 720) % 360
    # borné comme le dessin : un arc de 0 divisait par zéro
    arc = Math.min(360, Math.max(10, num($arc, 250)))
    if rel > arc
      rel = if rel - arc < 360 - rel then arc else 0
    set(num($min, 0) + rel / arc * (num($max, 100) - num($min, 0)))

  # un geste (glissé, flèche tenue, série de crans) : la valeur suit chaque pas, « change » part à sa fin, si la valeur a bougé, comme
  # <@@number> et <@@gauge> — le premier pas ouvre le geste, le relâché, la touche relâchée, la molette arrêtée ou la sortie du focus le ferment
  WHEEL_REST = 200
  before     = undefined
  wheelTimer = null

  commit = ->
    return if before is undefined
    now    = num($value, 0)
    moved  = now isnt before
    before = undefined
    µemit('change', now) if moved

  set = (v)->
    v = borne(v)
    return if v is num($value, 0)
    before = num($value, 0) if before is undefined
    $value = v

  # le bouton principal seul : un clic droit ou du milieu ne tourne rien
  onDown = (e)->
    return if $off or e.button > 0
    drag = true
    dialRef.setPointerCapture?(e.pointerId)
    fromPointer(e)

  onMove = (e)->
    fromPointer(e) if drag

  onUp = ->
    drag = false
    commit()

  onKeyEnd = (e)-> commit() if e.key.startsWith('Arrow') or e.key is 'Home' or e.key is 'End'

  onKey = (e)->
    return if $off
    st = stepOf()
    if e.key is 'ArrowUp' or e.key is 'ArrowRight'
      e.preventDefault()
      set(num($value, 0) + st)
    else if e.key is 'ArrowDown' or e.key is 'ArrowLeft'
      e.preventDefault()
      set(num($value, 0) - st)
    else if e.key is 'Home'
      e.preventDefault()
      set(num($min, 0))
    else if e.key is 'End'
      e.preventDefault()
      set(num($max, 100))

  # un glissé horizontal du pavé tactile n'est pas un cran de molette : la page le garde
  onWheel = (e)->
    return if $off
    return unless Math.abs(e.deltaY) > Math.abs(e.deltaX)
    e.preventDefault()
    set(num($value, 0) + (if e.deltaY < 0 then 1 else -1) * stepOf())
    clearTimeout(wheelTimer) if wheelTimer
    wheelTimer = setTimeout(commit, WHEEL_REST)

  hiddenInput = null

  # @@ reprise
  # rendu par le serveur, le bouton dit sa valeur dans sa balise (même posée par `value={…}`) : un module chargé avant la page la relit à son montage et part de la bonne valeur de départ ;
  # le 50, sa valeur par défaut, ne s'écrit pas : écrit avant que la page ait posé la sienne, il serait relu par-dessus ; le build de production n'envoie ce code qu'à une application qui reprend des pages rendues par le serveur (repères `@@`)
  reflect = ->
    return unless µserver
    if ($value or $value is 0) and $value isnt 50 and typeof $value isnt 'object' then @@setAttribute('value', String($value)) else @@removeAttribute('value')
  # @@

  # désactivé, il ne part pas avec le formulaire, comme un champ natif désactivé (un `<fieldset disabled>` désactive ce champ lui-même) ; le champ que le module a déjà écrit dans
  # la balise (page rendue par le serveur, il porte `mjs-f`) est repris, jamais doublé ; un champ caché de la page, de même
  # nom, n'est jamais touché ; la marque n'est écrite que par le serveur (le champ créé dans le navigateur ne la porte pas, le module en garde la référence), et sa recherche
  # comme son écriture ne partent en production que vers une application qui reprend des pages rendues par le serveur (repères `@@`)
  µeffect =>
    reflect() # @@ reprise
    hiddenInput ||= @querySelector(':scope > [mjs-f]') # @@ reprise
    if $name and not boolAttr($disabled)
      unless hiddenInput
        hiddenInput = document.createElement('input')
        hiddenInput.type = 'hidden'
        hiddenInput.setAttribute('mjs-f', '') if µserver # @@ reprise
        @appendChild(hiddenInput)
      hiddenInput.name  = $name
      hiddenInput.value = String($value)
      µ._mjs_formField hiddenInput
    else if hiddenInput
      hiddenInput.remove()
      hiddenInput = null

  # l'écouteur de molette retient le défilement de la page (non passif) : il n'est posé que si la molette sert, bouton actif
  µeffect ->
    dial = dialRef
    return unless dial and not $off
    dial.addEventListener('wheel', onWheel, { passive: false })
    -> dial.removeEventListener('wheel', onWheel)

  # un min plus grand que le max bloque la valeur sur le max : un avertissement le dit au montage, puis à chaque changement de bornes qui les laisse inversées
  µeffect ->
    µ.warn(µ._mjs_msg('coreRangeInverted', { tag: 'knob', min: num($min, 0), max: num($max, 100) }, '<@@{tag}> : min « {min} » est plus grand que max « {max} », la valeur reste bloquée sur une borne. Écrivez un min plus petit que max.')) if num($min, 0) > num($max, 100)

  µmount ->
    # un formulaire remis à zéro rend le bouton à sa valeur de départ, comme un champ natif, sans rien annoncer (aucun `change`) ; cette valeur
    # est celle du premier rendu, lue APRÈS le montage par l'aide du cœur : une prop `value={…}` n'est posée par la page qu'à la fin de son
    # premier rendu, un cran après le montage du bouton
    # une `<label for>` qui vise le bouton met le focus sur son cadran, comme l'étiquette d'une glissière native
    µ._mjs_formReset @, ->
      start = num($value, 0)
      ->
        clearTimeout(wheelTimer)
        before = undefined
        $value = start
        return
    µ._mjs_formLabel @, dialRef, true

  µdestroy ->
    clearTimeout(wheelTimer) if wheelTimer
</script>

<div class="knob" part="knob" role="slider" tabindex="0" aria-label={$labelText} aria-valuemin={num($min, 0)} aria-valuemax={num($max, 100)} aria-valuenow={num($value, 0)} aria-disabled={$off} @this=!{dialRef} --mjs-knob-size={num($size, 200) + 'px'} --mjs-knob-color={$color} --mjs-knob-track={$track} @pointerdown={onDown(e)} @pointermove={onMove(e)} @pointerup={onUp()} @pointercancel={onUp()} @keydown={onKey(e)} @keyup={onKeyEnd(e)} @blur={commit()}>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="track" cx="50" cy="50" r="40" stroke-width={$stroke} stroke-dasharray={$arcLen + ' ' + C} transform={'rotate(' + $turn + ' 50 50)'}></circle>
    <circle class="bar" cx="50" cy="50" r="40" stroke-width={$stroke} stroke-dasharray={$valueLen + ' ' + C} transform={'rotate(' + $turn + ' 50 50)'}></circle>
  </svg>
  <output part="value">{num($value, 0)}</output>
</div>

<style @display="inline-block">
  .knob
    position: relative
    width: var(--mjs-knob-size)
    height: var(--mjs-knob-size)
    outline: none
    cursor: pointer
    touch-action: none
    user-select: none

    &:focus-visible
      border-radius: 50%
      box-shadow: 0 0 0 3px rgba(59, 130, 246, .35)

    &[aria-disabled="true"]
      cursor: not-allowed
      opacity: .5

  svg
    width: 100%
    height: 100%

  circle
    fill: none

  .track
    stroke: var(--mjs-knob-track)

  .bar
    stroke: var(--mjs-knob-color)
    transition: stroke-dasharray .1s

  output
    position: absolute
    inset: 0
    display: grid
    place-items: center
    color: var(--mjs-knob-color)
    font: 700 calc(var(--mjs-knob-size) / 5) Arial, sans-serif
    pointer-events: none

  @media (prefers-reduced-motion: reduce)
    .bar
      transition: none
</style>
