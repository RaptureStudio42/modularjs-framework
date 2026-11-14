@formAssociated

<script>
  $value        = ''
  $min          = null
  $max          = null
  # sans `step` écrit, le pas vaut 1 ; avec `decimals` ou `precision`, la plus petite unité de leurs décimales (voir $by)
  $step         = null
  # `decimals` : un nombre FIXE de décimales montrées (« 64,30 ») ; `precision` : au plus ce nombre de décimales, sans zéro final (« 9,9 »),
  # deux quand il est écrit seul ; `decimals` écrit, `precision` ne compte pas
  $decimals     = null
  $precision    = null
  # le séparateur décimal montré : celui de la langue de la page (« 64,3 » en français, « 64.3 » en anglais), sauf « , » ou « . » écrits ici
  $separator    = null
  # `zero` : un champ vidé vaut 0, ramené dans les bornes (`min` s'il est plus grand, `max` s'il est plus petit), et l'écrit à la sortie ;
  # `strict` : une frappe ou un collage qui donnerait plus de décimales que le champ n'en tient, ou qui allongerait le texte au-delà de 15 caractères, est refusé
  $zero         = false
  $strict       = false
  $name         = ''
  $label        = null
  $placeholder  = ''
  $disabled     = false
  $required     = false
  # comme sur un champ nombre natif, `readonly` met le nombre hors de la validation (écrit sur la balise, par la règle du navigateur ; lié, `readonly={$x}`,
  # par le module ; « false », toute casse, est ôté par le socle du cœur) et le fige : ni la frappe, ni les flèches, ni les boutons ne changent sa valeur ;
  # la saisie la montre et se laisse sélectionner, le formulaire l'envoie
  $readonly     = false
  $formDisabled = false
  $lessLabel    = null
  $moreLabel    = null
  $big          = false
  $bigLessLabel = ''
  $bigMoreLabel = ''
  $draft        = null

  # un attribut booléen écrit vaut vrai quelle que soit sa valeur ; absent, posé à `null`, `undefined` ou `false` (`readonly={$x ? true : null}`) ou à
  # « false », quelle que soit sa casse (le rendu serveur la lit ici, sans le socle du cœur qui l'ôte dans le navigateur), il est faux
  boolAttr = (v)-> v? and v !== false and String(v).toLowerCase() !== 'false'

  # libellés par défaut : la langue de la page choisit (lire µlang rend le dérivé réactif à la bascule)
  tr = (key, lang, n)-> String(µ._mjs_label('core', key) ?? '').replace('{n}', n ?? '')

  # une pilule, « − » et « + » dans ses bords, la saisie au milieu
  ARROWS     = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']
  NOISE      = /[^0-9.,-]/g
  INNER_DASH = /(?!^)-/g
  LEAD_DASH  = /^-/
  SEPARATOR  = /[.,]/
  SEPARATORS = /[.,]/g
  GROUPS     = /^-?[1-9]\d{0,2}(?:([.,])\d{3})(?:\1\d{3})*(?:(?!\1)[.,]\d*)?$/
  TAIL_SEP   = /[.,]+$/
  FIRST_WAIT = 420

  before    = undefined
  holdTimer = null
  holding   = false

  toNum = (v)->
    return null if v is null or v is undefined or v is ''
    n = Number(String(v).replace(',', '.'))
    if Number.isFinite(n) then n else null

  # la valeur d'une frappe : sous un pas entier, un séparateur suivi d'exactement trois chiffres groupe des milliers (« 1,000 », « 10.000 »,
  # « 1.234,56 ») ; sinon le premier séparateur est la virgule décimale et les suivants tombent ; un séparateur en fin de frappe attend la suite
  read = (text)->
    s = String(text ?? '').trim().replace(TAIL_SEP, '')
    m = if $digits is 0 then s.match(GROUPS) else null
    return toNum(s.split(m[1]).join('')) if m
    cut = s.search(SEPARATOR)
    s   = s.slice(0, cut + 1) + s.slice(cut + 1).replace(SEPARATORS, '') if cut >= 0
    toNum(s)

  # un nombre que JavaScript écrirait en notation exponentielle (0.0000001 : « 1e-7 » ; 1e21 : « 1e+21 ») s'écrit en clair, le champ ne garde
  # ni « e » ni signe au milieu
  show = (v)->
    n = toNum(v)
    return '' if n is null
    text = String(n)
    if text.includes('e') then plain(n, decimalsOf(n)) else text

  # un nombre en clair à `digits` décimales : toFixed, sauf à partir de 1e21, où toFixed passe lui aussi en notation exponentielle ; un tel
  # nombre est entier : ses chiffres, puis les zéros des décimales
  plain = (n, digits)-> if Math.abs(n) < 1e21 then n.toFixed(digits) else BigInt(n).toString() + (if digits > 0 then '.' + '0'.repeat(digits) else '')

  # l'arrondi au plus proche, la moitié loin de zéro, sur l'écriture décimale du nombre : « 1,005 » donne 1,01 comme « 1,125 » donne 1,13
  # (toFixed arrondit la valeur binaire, où 1,005 vaut un rien de moins) ; un nombre qui tient dans ces décimales reste tel quel
  roundTo = (n, digits)->
    return n if decimalsOf(n) <= digits
    parts = String(Math.abs(n)).split('e')
    Math.sign(n) * Number(Math.round(Number(parts[0] + 'e' + (Number(parts[1] ?? 0) + digits))) + 'e-' + digits)

  # ce que le champ montre, au séparateur en vigueur : avec `decimals`, toutes les décimales en vigueur ; avec `precision`, la valeur arrondie
  # à ces décimales, sans zéro final ; sans l'un ni l'autre, la valeur en clair (la variable liée et le formulaire reçoivent le nombre, au point)
  view = (v, fixed, prec, digits, mark)->
    n = toNum(v)
    return show(v).replace('.', mark) if n is null or (fixed is null and prec is null)
    (if fixed is null then show(roundTo(n, digits)) else plain(roundTo(n, digits), digits)).replace('.', mark)

  # le séparateur que le navigateur écrit pour la langue `tag`, rien quand il la refuse
  markFor = (tag)->
    try
      if (1.5).toLocaleString(tag).includes(',') then ',' else '.'
    catch
      null

  # le séparateur décimal de la langue de la page, virgule ou point, tel que le navigateur l'écrit pour elle (« 1,5 » en français, « 1.5 » en
  # anglais) ; la langue est celle qui choisit les libellés, lue dans le même ordre (`µlang`, celle du module i18n, `<html lang>`, celle de la
  # construction), mais entière : sa région compte (« 1.5 » en `de-CH` et en `es-MX`) ; un nom de langue que le navigateur refuse se lit par
  # son premier sous-tag (« en- » : l'anglais), comme les libellés ; refusé lui aussi, ou sans langue, c'est la virgule du français (lire µlang
  # rend le dérivé réactif à la bascule)
  markOf = (lang)->
    tag = (µ._mjs_storeRaw and µ._mjs_storeRaw.__mjsLang) or (typeof µ._mjs_i18nEffectiveLang is 'function' and µ._mjs_i18nEffectiveLang()) or (typeof document isnt 'undefined' and document.documentElement and document.documentElement.lang) or µ._runtimeLabelsLang or 'fr'
    markFor(tag) ?? markFor(String(tag).split('-')[0]) ?? ','

  # `separator` : « , » ou « . » ; une autre valeur est une faute, le séparateur reste celui de la langue et la console le dit (cf. le µeffect des fautes)
  markIn = (v)-> if placesIn(v) is ',' or placesIn(v) is '.' then placesIn(v) else null

  # la frappe gardée : des chiffres, un signe en tête si la borne basse le permet, et les séparateurs, virgule ou point : un seul sous un pas
  # décimal, comme un champ nombre natif, tous sous un pas entier (ceux des milliers, « 1,000,000 ») — retiré, le séparateur faisait de
  # « 1.5 » 15 ; la valeur qui part est arrondie aux décimales du pas
  clean = (raw, signed, grouped)->
    s = String(raw).replace(NOISE, '').replace(INNER_DASH, '')
    s = s.replace(LEAD_DASH, '') unless signed
    cut = s.search(SEPARATOR)
    return s if grouped or cut < 0
    s.slice(0, cut + 1) + s.slice(cut + 1).replace(SEPARATORS, '')

  norm       = (v)-> toNum(v) ?? ''
  stepOf     = (v)-> if (toNum(v) ?? 0) > 0 then toNum(v) else 1
  # `decimals` : un entier de 0 à 100 (toFixed n'en accepte pas plus), en chiffres (« 2 ») ou en nombre (`decimals={2}`), comme le `decimals` du graphique ;
  # vide ou absent, il n'y en a pas. Une autre valeur (négative, fractionnaire, illisible, au-delà de 100) est une faute : il n'y en a pas non plus,
  # et la console le dit (cf. le µeffect des fautes, plus bas)
  placesIn   = (v)-> if v? and v isnt false then String(v).trim() else ''
  placesBad  = (v)-> placesIn(v) isnt '' and not (/^\d+$/.test(placesIn(v)) and Number(placesIn(v)) <= 100)
  placesOf   = (v)-> if placesIn(v) is '' or placesBad(v) then null else Number(placesIn(v))
  # `precision` suit la même règle, mais écrit seul (vide, ou `precision={true}`) il vaut deux ; absent, `false` ou « false », il n'y en a pas
  precBad    = (v)-> boolAttr(v) and v isnt true and placesBad(v)
  precOf     = (v)-> if not boolAttr(v) then null else (if v is true or placesIn(v) is '' then 2 else placesOf(v))
  # les décimales d'un pas, notation exponentielle comprise (« 1e-7 » en a 7) ; toFixed n'en accepte pas plus de 100
  decimalsOf = (n)->
    parts = String(n).split('e')
    Math.min(100, Math.max(0, (parts[0].split('.')[1] or '').length - Number(parts[1] ?? 0)))
  strideOf   = (reps)-> if reps < 18 then 1 else (if reps < 40 then 5 else 10)

  # avec `decimals` ou `precision` et sans `step` utilisable, le pas est la plus petite unité des décimales (0,01 pour deux) : une valeur tapée
  # reste dans le pas, que le formulaire valide comme un champ nombre natif ; les décimales en vigueur sont celles du pas et du grand pas, et
  # avec `decimals` ou `precision`, ce nombre, sauf si le pas, le grand pas ou une borne en ont davantage : la valeur montrée est toujours
  # celle que tient le champ
  $lo       = toNum($min)
  $hi       = toNum($max)
  $fixed    = placesOf($decimals)
  $prec     = if $fixed is null then precOf($precision) else null
  $places   = $fixed ?? $prec
  $by       = if $places is null or (toNum($step) ?? 0) > 0 then stepOf($step) else Number('1e-' + $places)
  $wide     = boolAttr($big)
  $bigBy    = stepOf(if toNum($big) is null then 10 else $big)
  $digits   = Math.max(decimalsOf($by), decimalsOf($bigBy), (if $places is null then 0 else Math.max($places, decimalsOf($lo ?? 0), decimalsOf($hi ?? 0))))
  $keypad   = if $digits > 0 then 'decimal' else 'numeric'
  $mark     = markIn($separator) ?? markOf(µlang)
  $cur      = toNum($value)

  $labelText = $label ?? tr('numberLabel', µlang)
  $lessText  = $lessLabel ?? tr('numberLess', µlang)
  $moreText  = $moreLabel ?? tr('numberMore', µlang)
  $bigLess   = if $bigLessLabel then $bigLessLabel else tr('numberBigLess', µlang, show($bigBy).replace('.', $mark))
  $bigMore   = if $bigMoreLabel then $bigMoreLabel else tr('numberBigMore', µlang, show($bigBy).replace('.', $mark))

  $nullable = ($placeholder or '') isnt ''
  $shown    = if $draft is null then view($value, $fixed, $prec, $digits, $mark) else $draft
  # désactivé par lui-même ou par un `<fieldset disabled>` autour de lui (`$formDisabled`, posé par le socle du cœur, qui ôte `disabled="false"`)
  $off      = boolAttr($disabled) or $formDisabled
  $ro       = boolAttr($readonly)
  $atMin    = toNum($min) isnt null and toNum($value) isnt null and toNum($value) <= toNum($min)
  $atMax    = toNum($max) isnt null and toNum($value) isnt null and toNum($value) >= toNum($max)

  clamp = (n)->
    n = Math.min($hi, n) if $hi isnt null
    n = Math.max($lo, n) if $lo isnt null
    n

  round = (n)-> roundTo(n, $digits)

  # la frappe porte-t-elle plus de décimales que le champ n'en tient ? Sa valeur lue en décide, pas son texte : un zéro final (« 12,500 ») ou
  # un groupe de milliers (« 1,000 » sous un pas entier) passent
  over = (text)->
    n = read(text)
    n isnt null and round(n) isnt n

  setValue = (v)->
    n = toNum(v)
    return if toNum($value) is n
    $value = if n is null then '' else n

  # un geste (appui, frappe, flèches) : « change » part à sa fin, si la valeur a bougé
  touch = -> before = norm($value) if before is undefined

  commit = ->
    return if before is undefined
    now    = norm($value)
    moved  = now isnt before
    before = undefined
    µemit('change', now) if moved

  stop = ->
    holdTimer?.()
    holdTimer = null

  finish = ->
    stop()
    holding = false
    commit()

  nudge = (dir, mult, size = $by)->
    base   = if $draft is null then toNum($value) else read($draft)
    next   = clamp(round((base ?? 0) + dir * size * mult))
    moved  = toNum($value) isnt next
    $draft = null
    setValue(next)
    moved

  # appui long : un pas tout de suite, puis de plus en plus vite, par pas de plus en plus grands
  press = (dir, e, wide)->
    return if $off or $ro or e.button > 0 or holding
    return if (dir < 0 and $atMin) or (dir > 0 and $atMax)
    e.preventDefault()
    touch()
    holding = true
    size = if wide then $bigBy else $by
    nudge(dir, 1, size)
    reps = 0
    tick = ->
      reps++
      return finish() unless nudge(dir, strideOf(reps), size)
      holdTimer = µafter Math.max(35, 150 - reps * 6), tick
    holdTimer = µafter FIRST_WAIT, tick

  # au clavier (Entrée, Espace sur un bouton) : un clic sans appui
  activate = (dir, e, wide)->
    return if e.detail isnt 0 or $off or $ro
    touch()
    nudge(dir, 1, (if wide then $bigBy else $by))
    commit()

  release = -> finish() if holding
  keyEnd  = (e)-> commit() if ARROWS.includes(e.key)

  typed = (e)->
    return if $off
    field = e.target
    raw   = clean(field.value, $lo is null or $lo < 0, $digits is 0)
    # `strict` : la frappe ou le collage de trop est refusé en entier, comme au-delà d'un `maxlength` ; le champ reprend son texte d'avant
    # et le curseur sa place. La saisie n'a alors pas de `maxlength`, qui couperait un collage avant cette vérification : un texte de plus
    # de 15 caractères, plus long que celui d'avant, est refusé de même (sans `strict`, le navigateur le coupe à 15)
    if boolAttr($strict) and (over(raw) or (raw.length > 15 and raw.length > $shown.length))
      at = field.selectionStart - field.value.length + $shown.length
      field.value = $shown
      field.setSelectionRange(at, at) if at >= 0
      return
    field.value = raw if field.value isnt raw
    touch()
    $draft = raw
    n = read(raw)
    # le champ montre la frappe ; la variable liée, le formulaire et aria-valuenow ne reçoivent que la valeur bornée et arrondie aux décimales du pas,
    # celle que la sortie du champ y écrira (999 sous max="10" partait tel quel jusqu'à la sortie) ; vidé, il vaut 0 avec `zero`, rien avec un `placeholder`
    if n isnt null
      setValue(clamp(round(n)))
    else if raw is '' and boolAttr($zero)
      setValue(clamp(0))
    else if raw is '' and $nullable
      setValue('')

  settle = ->
    return if $draft is null
    n = read($draft)
    n = toNum($value) if n is null
    $draft = null
    setValue(clamp(round(n))) if n isnt null
    commit()

  key = (e)->
    return if $off or $ro
    if ARROWS.includes(e.key)
      e.preventDefault()
      touch()
      nudge((if e.key is 'ArrowUp' or e.key is 'PageUp' then 1 else -1), 1, (if e.key is 'PageUp' or e.key is 'PageDown' then (if $wide then $bigBy else $by * 10) else $by))
    else if ((e.key is 'Home' and $lo isnt null) or (e.key is 'End' and $hi isnt null)) and not (e.shiftKey or e.ctrlKey or e.altKey or e.metaKey)
      # Début et Fin mènent aux bornes quand elles existent (motif ARIA du spinbutton) ; sans borne, ou tenues avec Maj, Ctrl, Alt ou Méta
      # (Maj + Début sélectionne le texte jusqu'au début), la touche reste au texte
      e.preventDefault()
      touch()
      $draft = null
      setValue(if e.key is 'Home' then $lo else $hi)
      commit()
    else if e.key is 'Enter'
      settle()

  hiddenInput = null
  inputRef    = null

  # @@ reprise
  # rendu par le serveur, le champ dit sa valeur dans sa balise (même posée par `value={…}`) : un module chargé avant la page la relit à son montage et part de la bonne valeur de départ ; le build de production n'envoie ce code qu'à une application qui reprend des pages rendues par le serveur (repères `@@`)
  reflect = ->
    return unless µserver
    if ($value or $value is 0) and typeof $value isnt 'object' then @@setAttribute('value', String($value)) else @@removeAttribute('value')
  # @@

  # le champ du formulaire suit la valeur (un `<fieldset disabled>` le désactive lui-même : rien ne part) ; le champ que le module a déjà écrit dans la balise (page rendue par le serveur,
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
      hiddenInput.value = show($value)
      µ._mjs_formField hiddenInput
    else if hiddenInput
      hiddenInput.remove()
      hiddenInput = null

  # obligatoire (`required`), bornes et pas : le formulaire voit la validité d'un `<input type="number">` aux mêmes règles, posé hors de la
  # page (le manque, la valeur hors des bornes ou hors du pas, avec le message du navigateur) ; sans `min`, le pas part de la valeur de
  # départ, comme celui d'un champ natif part de son attribut `value` ; désactivé ou en lecture seule, il ne compte plus, comme un champ nombre natif ;
  # avec `decimals` ou `precision`, le pas validé est l'unité des décimales en vigueur (`step` ne règle que les boutons et les flèches :
  # sous `step="1" decimals="2"`, 7,50 est valide), comptée depuis 0 ou le `min`, sur la valeur que le champ montre, arrondie à ces
  # décimales : une valeur de départ qui en a davantage (7.505 sous `decimals="2"`) ne décale pas le pas
  probe = null
  first = undefined

  µeffect =>
    $required
    $value
    $lo
    $hi
    $by
    $places
    $digits
    $off
    $ro
    return unless @internals
    unless probe
      probe = document.createElement('input')
      probe.type = 'number'
    probe.required     = boolAttr($required)
    probe.min          = show($lo)
    probe.max          = show($hi)
    probe.step         = if $places is null then show($by) else show(Number('1e-' + $digits))
    probe.defaultValue = if $places is null then first ?? show($value) else ''
    probe.value        = if $places is null or toNum($value) is null then show($value) else show(round(toNum($value)))
    µ._mjs_formNative @, inputRef, (if $off or $ro then null else probe)

  # une précision fautive est ignorée (aucune décimale fixe) : une erreur le dit au montage, puis à chaque changement qui la laisse fautive ;
  # de même pour `precision` et pour `separator`
  µeffect ->
    µ.error(µ._mjs_msg('coreNumberDecimals', { value: placesIn($decimals) }, '<@@number> : decimals « {value} » est ignoré — écrivez un nombre entier de 0 à 100 ; la valeur s\'écrit comme sans decimals.')) if placesBad($decimals)

  µeffect ->
    µ.error(µ._mjs_msg('coreNumberPrecision', { value: placesIn($precision) }, '<@@number> : precision « {value} » est ignoré — écrivez un nombre entier de 0 à 100, ou precision seul pour deux décimales.')) if precBad($precision)

  µeffect ->
    µ.error(µ._mjs_msg('coreNumberSeparator', { value: placesIn($separator) }, '<@@number> : separator « {value} » est ignoré — écrivez « , » ou « . » ; sans separator, le séparateur est celui de la langue de la page.')) if placesIn($separator) isnt '' and markIn($separator) is null

  # un min plus grand que le max bloque la valeur sur le min : un avertissement le dit au montage, puis à chaque changement de bornes qui les laisse inversées
  µeffect ->
    µ.warn(µ._mjs_msg('coreRangeInverted', { tag: 'number', min: show($min), max: show($max) }, '<@@{tag}> : min « {min} » est plus grand que max « {max} », la valeur reste bloquée sur une borne. Écrivez un min plus petit que max.')) if toNum($min) isnt null and toNum($max) isnt null and toNum($min) > toNum($max)

  µmount ->
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    # la valeur de départ est celle du premier rendu, lue APRÈS le montage par l'aide du cœur : une prop `value={…}` n'est posée
    # par la page qu'à la fin de son premier rendu, un cran après le montage du champ
    # un formulaire remis à zéro rend le champ à sa valeur de départ, comme un champ natif : le geste en cours s'arrête sans rien
    # annoncer (aucun `change`, le formulaire dit lui-même son `reset`) ; cette valeur de départ est aussi celle d'où part le pas, sans `min`
    # une `<label for>` qui vise le champ y met le focus, comme l'étiquette d'un champ nombre natif
    µ._mjs_formReset @, ->
      start = $value
      first = show(start)
      ->
        stop()
        holding = false
        before  = undefined
        $draft  = null
        setValue(start)
    µ._mjs_formLabel @, inputRef, true

  µdestroy ->
    stop()
    window.removeEventListener('pointerup', release)
    window.removeEventListener('pointercancel', release)
    window.removeEventListener('blur', release)
</script>

<div class="field" part="field" role="group" aria-label={$labelText} :class{$off}="off" :class{$wide}="wide">
  {if $wide}
    <button type="button" class="step less big" part="button" tabindex="-1" aria-label={$bigLess} disabled={($off or $ro or $atMin) ? true : null} @pointerdown={press(-1, e, true)} @click={activate(-1, e, true)}>−−</button>
  {end}
  <button type="button" class="step less" part="button" tabindex="-1" aria-label={$lessText} disabled={($off or $ro or $atMin) ? true : null} @pointerdown={press(-1, e)} @click={activate(-1, e)}>−</button>
  <input class="input" part="input" type="text" role="spinbutton" inputmode={$keypad} autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" maxlength={boolAttr($strict) ? null : 15} aria-label={$labelText} aria-valuemin={$lo} aria-valuemax={$hi} aria-valuenow={$cur} aria-required={boolAttr($required) ? 'true' : null} placeholder={$placeholder} value={$shown} readonly={$ro ? true : null} disabled={$off ? true : null} :this=!{inputRef} @input={typed(e)} @keydown={key(e)} @keyup={keyEnd(e)} @blur={settle()}>
  <button type="button" class="step more" part="button" tabindex="-1" aria-label={$moreText} disabled={($off or $ro or $atMax) ? true : null} @pointerdown={press(1, e)} @click={activate(1, e)}>+</button>
  {if $wide}
    <button type="button" class="step more big" part="button" tabindex="-1" aria-label={$bigMore} disabled={($off or $ro or $atMax) ? true : null} @pointerdown={press(1, e, true)} @click={activate(1, e, true)}>++</button>
  {end}
</div>

<style :display="inline-block">
  .field
    display: flex
    align-items: stretch
    box-sizing: border-box
    width: var(--mjs-number-width, 160px)
    overflow: hidden
    border: 1px solid var(--mjs-number-border, var(--mjs-border, #888))
    border-radius: var(--mjs-number-radius, 999px)
    touch-action: manipulation
    transition: border-color .15s ease, box-shadow .15s ease, opacity .15s ease

    &:focus-within
      border-color: var(--mjs-number-accent, var(--mjs-accent, #3b82f6))
      box-shadow: 0 0 0 3px var(--mjs-number-focus, rgba(59, 130, 246, .35))

    &.off
      opacity: .5

  // `big` : deux boutons de 40px en plus, le champ s'élargit d'autant (la saisie garde sa place) ; une largeur posée par la page reste la sienne
  .field.wide
    width: var(--mjs-number-width, 240px)

  .step
    flex: none
    width: 40px
    margin: 0
    padding: 0
    border: 0
    background: var(--mjs-number-step-bg, transparent)
    color: inherit
    font: inherit
    font-size: 18px
    font-weight: 700
    line-height: 1
    cursor: pointer
    user-select: none
    -webkit-user-select: none
    -webkit-tap-highlight-color: transparent
    transition: background .12s ease

    &:hover:not(:disabled), &:active:not(:disabled)
      background: var(--mjs-number-step-hover, rgba(127, 127, 127, .32))

    &:disabled
      opacity: .35
      cursor: default

  .less
    border-right: 1px solid var(--mjs-number-border, var(--mjs-border, #888))

  .more
    border-left: 1px solid var(--mjs-number-border, var(--mjs-border, #888))

  // `.field .input` : passe devant une feuille partagée de la page qui style `input[type="text"]`
  .field .input
    flex: 1
    box-sizing: border-box
    min-width: 0
    width: 100%
    margin: 0
    padding: 8px 6px
    border: 0
    border-radius: 0
    box-shadow: none
    background: transparent
    color: inherit
    font: inherit
    font-variant-numeric: tabular-nums
    text-align: center
    outline: none
    appearance: none

    &:disabled
      cursor: not-allowed
</style>
