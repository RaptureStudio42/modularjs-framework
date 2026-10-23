@formAssociated

<script>
  $value        = 0
  $min          = 0
  $max          = 10
  $step         = 1
  $warn         = 8
  $color        = '#0f0'
  $warnColor    = '#f00'
  $wheel        = false
  $name         = ''
  $label        = null
  $disabled     = false
  $formDisabled = false

  # libellé par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang)-> µ._mjs_label('core', key)
  $labelText = $label ?? tr('gaugeLabel', µlang)

  # un attribut booléen écrit vaut vrai quelle que soit sa valeur ; absent, posé à `null`, `undefined` ou `false` (`disabled={$x ? true : null}`) ou à
  # « false », quelle que soit sa casse (le rendu serveur la lit ici, sans le socle du cœur qui l'ôte dans le navigateur), il est faux
  boolAttr = (v)-> v? and v !== false and String(v).toLowerCase() !== 'false'
  num      = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d

  # désactivée par elle-même ou par un `<fieldset disabled>` autour d'elle (`$formDisabled`, posé par le socle du cœur, qui ôte `disabled="false"`)
  $off    = boolAttr($disabled) or $formDisabled
  $n      = num($value, 0)
  $ratio  = Math.min(1, Math.max(0, if num($max, 10) > num($min, 0) then (num($value, 0) - num($min, 0)) / (num($max, 10) - num($min, 0)) else 0))
  $hot    = num($value, 0) >= num($warn, 8)
  $pushed = ''

  set = (v)->
    v = Math.min(num($max, 10), Math.max(num($min, 0), +v.toFixed(6)))
    return if v is num($value, 0)
    $value = v

  # un pas nul ou négatif (step="-1" inversait les commandes, step="0" les rendait muettes) retombe sur le pas par défaut, et le dit
  stepOf = -> if num($step, 1) > 0 then num($step, 1) else 1

  µeffect ->
    µ.warn(µ._mjs_msg('coreGaugeStep', { n: $step }, '<@@gauge> : le pas « {n} » n\'est pas un nombre positif, la jauge avance de 1. Écrivez un pas plus grand que 0.')) unless num($step, 1) > 0

  # un min plus grand que le max bloque la valeur sur le max : un avertissement le dit au montage, puis à chaque changement de bornes qui les laisse inversées
  µeffect ->
    µ.warn(µ._mjs_msg('coreRangeInverted', { tag: 'gauge', min: num($min, 0), max: num($max, 10) }, '<@@{tag}> : min « {min} » est plus grand que max « {max} », la valeur reste bloquée sur une borne. Écrivez un min plus petit que max.')) if num($min, 0) > num($max, 10)

  plus  = -> set(num($value, 0) + stepOf())
  minus = -> set(num($value, 0) - stepOf())

  # un geste (clic, flèche tenue, série de crans) : « change » part à sa fin, si la valeur a bougé
  before = undefined
  touch  = -> before = num($value, 0) if before is undefined

  commit = ->
    return if before is undefined
    now    = num($value, 0)
    moved  = now isnt before
    before = undefined
    µemit('change', now) if moved

  # un clic sur « + » ou « − » : un geste à lui seul
  bump = (dir)->
    return if $off
    touch()
    if dir > 0 then plus() else minus()
    commit()

  # la molette : un cran = un pas ; sur un pavé tactile, un pas tous les 50 px cumulés
  WHEEL_REST = 200
  acc        = 0
  last       = 0
  wheelTimer = null
  push = (k)->
    $pushed = k
    setTimeout((-> $pushed = ''), 150)

  onWheel = (e)->
    return if $off or not boolAttr($wheel)
    e.preventDefault()
    delta = if e.deltaMode is 1 then e.deltaY * 33 else e.deltaY
    acc = 0 if e.timeStamp - last > 200
    last = e.timeStamp
    acc += delta
    return if Math.abs(acc) < 50
    touch()
    clearTimeout(wheelTimer) if wheelTimer
    wheelTimer = setTimeout(commit, WHEEL_REST)
    if acc < 0
      plus()
      push('plus')
    else
      minus()
      push('minus')
    acc = 0

  onKey = (e)->
    return if $off
    if e.key is 'ArrowUp' or e.key is 'ArrowRight'
      e.preventDefault()
      touch()
      plus()
    else if e.key is 'ArrowDown' or e.key is 'ArrowLeft'
      e.preventDefault()
      touch()
      minus()
    else if e.key is 'Home' or e.key is 'End'
      # Début et Fin : les bornes, un geste à lui seul (motif ARIA du spinbutton)
      e.preventDefault()
      touch()
      set(if e.key is 'Home' then num($min, 0) else num($max, 10))
      commit()

  onKeyEnd = (e)-> commit() if e.key.startsWith('Arrow')

  hiddenInput = null
  boxRef      = null
  spinRef     = null

  # @@ reprise
  # rendu par le serveur, la jauge dit sa valeur dans sa balise (même posée par `value={…}`) : un module chargé avant la page la relit à son montage et part de la bonne valeur de départ ;
  # le zéro, sa valeur par défaut, ne s'écrit pas : écrit avant que la page ait posé la sienne, il serait relu par-dessus ; le build de production n'envoie ce code qu'à une application qui reprend des pages rendues par le serveur (repères `@@`)
  reflect = ->
    return unless µserver
    if $value and typeof $value isnt 'object' then @@setAttribute('value', String($value)) else @@removeAttribute('value')
  # @@

  # le champ du formulaire suit la valeur ; désactivée, la jauge ne part pas avec le formulaire, comme un champ natif désactivé (un `<fieldset disabled>` désactive ce champ lui-même) ; le champ que le module a déjà écrit dans la balise (page rendue par le serveur,
  # il porte `mjs-f`) est repris, jamais doublé ; un champ caché de la page, de même nom, n'est jamais touché ; la marque n'est écrite que par le serveur (le champ créé dans
  # le navigateur ne la porte pas, le module en garde la référence), et sa recherche comme son écriture ne partent en production que vers une application qui reprend
  # des pages rendues par le serveur (repères `@@`)
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
      hiddenInput.value = String(num($value, 0))
      µ._mjs_formField hiddenInput
    else if hiddenInput
      hiddenInput.remove()
      hiddenInput = null

  # l'écouteur de molette retient le défilement de la page (non passif) : il n'est posé que si la molette sert, `wheel` écrit et la jauge active
  µeffect ->
    box = boxRef
    return unless box and boolAttr($wheel) and not $off
    box.addEventListener('wheel', onWheel, { passive: false })
    -> box.removeEventListener('wheel', onWheel)

  µmount ->
    # la valeur de départ est celle du premier rendu, lue APRÈS le montage par l'aide du cœur : une prop `value={…}` n'est posée
    # par la page qu'à la fin de son premier rendu, un cran après le montage de la jauge
    # un formulaire remis à zéro rend la jauge à sa valeur de départ, comme un champ natif : le geste en cours (flèche tenue, molette)
    # s'arrête sans rien annoncer (aucun `change`, le formulaire dit lui-même son `reset`)
    # une `<label for>` qui vise la jauge met le focus sur son compteur, comme l'étiquette d'une glissière native
    µ._mjs_formReset @, ->
      start = num($value, 0)
      ->
        clearTimeout(wheelTimer)
        before = undefined
        $value = start
        return
    µ._mjs_formLabel @, spinRef, true

  µdestroy ->
    clearTimeout(wheelTimer) if wheelTimer
</script>

<div class="box" part="box" @this=!{boxRef} @class{$off}="off" --mjs-gauge-color={$color} --mjs-gauge-warn={$warnColor} --mjs-gauge-fill={($ratio * 100) + '%'}>
  <div class="spinner" role="spinbutton" tabindex="0" aria-label={$labelText} @this=!{spinRef} aria-valuenow={$n} aria-valuemin={num($min, 0)} aria-valuemax={num($max, 10)} aria-disabled={$off ? 'true' : null} @keydown={onKey(e)} @keyup={onKeyEnd(e)} @blur={commit()}>
    <output part="value">{$n}</output>
    <div class="progress" part="meter">
      <span class="meter" @class{$hot}="hot"></span>
    </div>
    <button type="button" class="btn" part="button" aria-label="+" disabled={$off ? true : null} @class{$pushed is 'plus'}="pushed" @click={bump(1)}>+</button>
    <button type="button" class="btn" part="button" aria-label="-" disabled={$off ? true : null} @class{$pushed is 'minus'}="pushed" @click={bump(-1)}>-</button>
  </div>
</div>

<style @display="inline-block">
  .box
    display: flex
    justify-content: center
    align-items: center
    width: 44px
    height: 230px
    border-radius: 22px
    background: #333
    box-shadow: 0 3px 24px rgba(0, 0, 0, .5)

    // le compteur focalisé au clavier : un anneau autour du boîtier
    &:has(.spinner:focus-visible)
      box-shadow: 0 3px 24px rgba(0, 0, 0, .5), 0 0 0 3px rgba(59, 130, 246, .35)

    &.off
      opacity: .5

  .spinner
    display: flex
    flex-direction: column
    justify-content: center
    align-items: center
    gap: 7px
    width: 28px
    outline: none
    user-select: none

  output
    color: #fff
    font-size: 1.15em
    text-shadow: 0 0 4px #fff

  .progress
    position: relative
    display: flex
    flex-direction: column-reverse
    width: 6px
    height: 120px
    border-radius: 20px
    background: #222

  .meter
    position: absolute
    bottom: 0
    width: 100%
    height: var(--mjs-gauge-fill)
    border-radius: 20px
    background: var(--mjs-gauge-color)
    filter: drop-shadow(0 0 2px var(--mjs-gauge-color)) drop-shadow(0 0 6px var(--mjs-gauge-color))
    transition: .5s

    &.hot
      background: var(--mjs-gauge-warn)
      filter: drop-shadow(0 0 2px var(--mjs-gauge-warn)) drop-shadow(0 0 6px var(--mjs-gauge-warn))

  .btn
    width: 28px
    height: 28px
    padding: 0
    border: 0
    border-radius: 50%
    background: #444
    color: #fff
    font-size: 1.1em
    font-weight: 500
    line-height: 28px
    text-shadow: 0 0 4px #fff, 0 0 8px #fff
    cursor: pointer

    &:active, &.pushed
      font-size: .95em
      box-shadow: inset 0 0 10px rgba(0, 0, 0, .9)

    &:disabled
      cursor: not-allowed
      box-shadow: none

  @media (prefers-reduced-motion: reduce)
    .meter
      transition: none
</style>
