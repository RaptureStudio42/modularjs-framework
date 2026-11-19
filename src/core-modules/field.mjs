<script>
  $name    = ''
  $label   = ''
  $help    = ''
  $okLabel = ''
  $icon    = ''

  $status   = 'neutral'
  $fieldId  = ''
  $errorMsg = ''

  seen         = false
  seenControl  = null
  gone         = false
  nameObserver = null
  $filled      = false
  targetEl        = null
  control      = null
  firstErrors  = undefined
  answered     = false
  labelSet     = false
  invalidSet   = false
  valueWatched = false
  valueSeen    = null

  # une saisie du cœur (nombre, jauge, bouton rotatif, liste de choix, éditeur) ne porte pas de propriété `value` : sa valeur se lit dans son
  # état (jamais lue, le libellé flottant restait couché sur elle) ; remplie : une valeur non vide (le zéro en est une), au moins un choix
  # d'une liste multiple, un éditeur qui n'est pas vide
  CORE         = 'mjs-core-number, mjs-core-gauge, mjs-core-knob, mjs-core-select, mjs-core-editor'
  full         = (v)-> if typeof v is 'number' then not Number.isNaN(v) else (if Array.isArray(v) then v.length > 0 else !!v)
  readFilled   = -> $filled = filledOf(control)
  focusControl = -> control?.focus?()

  filledOf = (el)->
    return full(el?.value) unless el and µ._mjs_matches(el, CORE)
    # pas encore mise à niveau (son module arrive après celui du champ) : sa balise dit la valeur de départ
    return full(el.getAttribute('value')) unless el._state
    if el.localName is 'mjs-core-editor' then el._state.empty is false else full(el._state.value)

  # chaque écriture de sa valeur — geste, liaison de la page, remise à zéro — change son arbre (`aria-valuenow`, option affichée, surface de
  # l'éditeur) : le champ la relit
  watchCore = (el)->
    return if gone or not el._shadow or typeof MutationObserver isnt 'function'
    valueSeen = new MutationObserver(readFilled)
    valueSeen.observe(el._shadow, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow', 'class'] })
    readFilled()

  # le <label> du module vit dans son shadow : son `for` ne vise rien hors de cet arbre, et le champ
  # enveloppé resterait sans nom pour un lecteur d'écran — le libellé lui est donc donné en
  # aria-label, sauf s'il a déjà le sien (aria-label, aria-labelledby, <label> de la page)
  applyLabel = (label)->
    return unless control
    return unless labelSet or not (control.hasAttribute('aria-label') or control.hasAttribute('aria-labelledby') or control.labels?.length)
    if label
      control.setAttribute('aria-label', label)
      labelSet = true
    else if labelSet
      control.removeAttribute('aria-label')
      labelSet = false

  # une valeur posée par programme (liaison value=!{$x}, formulaire d'édition) ne déclenche ni input
  # ni change : l'écriture de la propriété est relayée pour que le libellé flottant suive
  watchValue = (el)->
    proto = Object.getPrototypeOf(el)
    d     = null
    while proto and not d
      d     = Object.getOwnPropertyDescriptor(proto, 'value')
      proto = Object.getPrototypeOf(proto)
    return unless d?.get and d?.set
    setValue = (v)->
      d.set.call(el, v)
      $filled = full(d.get.call(el))
    Object.defineProperty(el, 'value', { configurable: true, enumerable: d.enumerable, get: (-> d.get.call(el)), set: setValue })
    valueWatched = true

  # les saisies : un champ natif, ou une balise du cœur qui porte une valeur
  INPUTS = 'input, select, textarea, mjs-core-select, mjs-core-number, mjs-core-checkbox, mjs-core-switch, mjs-core-radio, mjs-core-knob, mjs-core-gauge, mjs-core-editor'

  # le champ d'un élément du corps : lui-même, ou celui qu'il enveloppe (icône/affixe) ; `matches` se prend à
  # la balise : un composant d'auteur qui déclare @matches masque celui de sa balise
  fieldOf = (el)->
    return el if µ._mjs_matches(el, INPUTS)
    el.querySelector?(INPUTS) or el.querySelector?('[name]')

  µmount ->
    els = slotRef?.assignedElements() ?? []
    # le champ nommé est le PREMIER CHAMP du corps, pas son premier élément : une aide ou une icône peut passer devant
    target = els.find((el)-> fieldOf(el)) ?? els[0]
    if target
      targetEl = target
      # target peut envelopper le vrai champ (icône/affixe) : id/for doivent viser le champ natif, pas l'enveloppe
      native  = fieldOf(target) or target
      control = native
      mark($status)
      applyLabel($label)
      if not native.id
        native.id = 'mjs-field-' + Math.random().toString(36).slice(2, 9)
      $fieldId = native.id
      # name FACULTATIF sur l'enveloppe : le champ porte DÉJÀ le sien, sans quoi aucun formulaire ne le ramasse
      explicit = !!$name
      $name     = native.getAttribute?('name') or '' unless explicit
      # un name déduit suit le champ enveloppé si son attribut change plus tard ; un name
      # explicite sur l'enveloppe, lui, reste prioritaire à vie (jamais réévalué)
      unless explicit
        nameObserver = new MutationObserver -> $name = native.getAttribute?('name') or ''
        nameObserver.observe(native, { attributes: true, attributeFilter: ['name'] })
      # libellé flottant : il reste en haut tant que le champ n'est pas vide — relu aussi en quittant
      # le champ (valeur rendue par le navigateur) et après la remise à zéro du formulaire
      $filled = filledOf(native)
      # une saisie du cœur peut se mettre à niveau après le champ (un fichier par module, celui du champ arrive avant) : le champ l'attend pour la suivre
      if µ._mjs_matches(native, CORE)
        if native._shadow then watchCore(native) else customElements.whenDefined(native.localName).then(-> watchCore(native))
      native.addEventListener('input', readFilled)
      native.addEventListener('change', readFilled)
      native.addEventListener('focusout', readFilled)
      µ._mjs_formReset(@, (-> readFilled), -> native.form)
      watchValue(native)
    µ.error('[mjs-core-field] ' + µ._mjs_txt('coreFieldNoName', null, 'aucun « name » : ni sur <@@field>, ni sur le champ enveloppé.')) unless $name

  µdestroy ->
    gone = true
    nameObserver?.disconnect()
    valueSeen?.disconnect()
    return unless control
    control.removeEventListener('input', readFilled)
    control.removeEventListener('change', readFilled)
    control.removeEventListener('focusout', readFilled)
    delete control.value if valueWatched

  # le succès attend une réponse du serveur : elle remplace le sac d'erreurs, c'est donc lui qu'on
  # compare — un simple repassage (le name déduit du champ au montage) n'en est pas une. Le sac lu est
  # celui du formulaire qui emporte le champ natif, même enveloppé (son `form`, sinon la balise form
  # autour), que mjs_form_answers.ts range quand l'application écrit un formulaire, `µres.errors` sinon ;
  # le premier sac est repris quand le champ se fait connaître (au montage) : le succès attend une
  # réponse à SON formulaire
  µeffect ->
    errors = µres.errors
    own    = if control and µ._mjs_formView then µ._mjs_formView?.(control, errors, targetEl.parentNode) else errors
    unless seen and seenControl is control
      seen        = true
      seenControl = control
      firstErrors = µ._mjs_toRaw?.(own) ?? own
    # la réponse de son formulaire n'est pas le sac : lu quand même, le sac fait repasser ce reffet à une écriture en place
    errors?.[$name] unless own is errors
    # l'objet formulaire du composant qui a écrit ce champ (µform, absent sans lui), s'il connaît ce nom : l'erreur qu'il montre, celle du
    # serveur comprise ; sinon le sac lu. Le module se trouve par l'élément qu'il enveloppe (`@`, dans un reffet, serait le reffet),
    # connu au montage, qui pose `$fieldId` : sa lecture fait repasser ce reffet une fois le champ trouvé
    err      = µ._mjs_formErr?.($fieldId and targetEl, $name) ?? own?.[$name]
    answered = true if err or (µ._mjs_toRaw?.(own) ?? own) isnt firstErrors
    if err
      $status   = 'error'
      $errorMsg = if Array.isArray(err) then String(err[0] ?? '') else String(err)
    else
      $errorMsg = ''
      $status   = 'ok' if answered

  µeffect -> applyLabel($label)

  # l'état se lit aussi sur le champ slotté lui-même (attribut mjs-field) : c'est lui que colorent
  # les règles ::slotted — une classe posée plus haut, dans l'arbre du module, n'est pas toujours
  # recalculée par Chromium sur un élément slotté (le cadre restait rouge après le succès) ; le
  # champ natif porte aussi aria-invalid, le seul signe d'erreur qu'un lecteur d'écran lise sur lui
  mark = (state) ->
    return unless targetEl
    if state is 'neutral' then targetEl.removeAttribute('mjs-field') else targetEl.setAttribute('mjs-field', state)
    if state is 'error'
      control?.setAttribute('aria-invalid', 'true')
      invalidSet = true
    else if invalidSet
      control?.removeAttribute('aria-invalid')
      invalidSet = false

  µeffect -> mark($status)
</script>

<div class="field" part="field" :class{$status == 'error'}="has-error" :class{$status == 'ok'}="has-ok" :class{µlayout is 'float'}="float" :class{$filled}="filled">
  {if $label and µlayout isnt 'float'}
    <label class="label" part="label" for="{$fieldId}" @click={focusControl()}>{$label}</label>
  {end}
  <div class="control">
    <slot :this=!{slotRef}></slot>
    {if µlayout is 'float' and $icon}
      <span class="icon" part="icon" aria-hidden="true">{$icon}</span>
    {end}
    {if µlayout is 'float' and $label}
      <label class="label float-label" part="label" for="{$fieldId}" @click={focusControl()}>{$label}</label>
    {end}
  </div>
  <p class="help" part="help">{$help}</p>
  {if $status == 'error'}
    <p class="error" part="error" role="alert">{$errorMsg}</p>
  {end}
  {if $status == 'ok'}
    <p class="ok" part="ok">{$okLabel}</p>
  {end}
</div>

<style>
  :host
    display: block

  .field
    display: flex
    flex-direction: column
    gap: 4px

  .label
    font-size: .85rem
    font-weight: 600

  ::slotted(input), ::slotted(select), ::slotted(textarea)
    border: 1px solid var(--mjs-border, #888)
    border-radius: 6px
    padding: 6px 10px
    font: inherit
    transition: border-color .18s ease, box-shadow .18s ease

  // bordure d'état : un ::slotted() perd TOUJOURS face à une règle normale de l'arbre externe (page), quelle que soit la spécificité — seul !important inverse ce départage (spec CSS Scoping)
  ::slotted(input[mjs-field="error"]), ::slotted(select[mjs-field="error"]), ::slotted(textarea[mjs-field="error"])
    border-color: var(--mjs-field-error-color, #e5484d) !important

  ::slotted(input[mjs-field="ok"]), ::slotted(select[mjs-field="ok"]), ::slotted(textarea[mjs-field="ok"])
    border-color: var(--mjs-field-ok-color, #2e9e5b) !important

  .control
    position: relative
    display: flex
    flex-direction: column

  .float
    padding-top: 30px

    // marge du modèle : l'icône et le libellé sont posés dans la case — une remise à zéro de la page (* { padding: 0 }) l'emporterait sur ce ::slotted() et les ferait passer sous la case, sur le message ; !important la garde, comme la bordure d'état (le reste de la case reste à la page)
    ::slotted(input)
      padding: 20px 10px 20px 60px !important
      border: 2px solid #000
      border-radius: 8px
      background: var(--mjs-field-float-bg, #142846)
      color: #fff
      letter-spacing: 2px
      outline: none

    // rempli, le libellé ne bouge plus quand on entre dans le champ : l'anneau montre le focus
    ::slotted(input:focus-visible)
      box-shadow: 0 0 0 3px rgba(59, 130, 246, .35)

    .icon
      position: absolute
      top: 14px
      left: 12px
      display: flex
      justify-content: center
      align-items: center
      width: 40px
      height: 40px
      border-radius: 6px
      background: var(--mjs-field-float-accent, #216fed)
      color: #fff
      font-size: 1.4em
      pointer-events: none
      transition: .25s

    .float-label
      position: absolute
      top: 0
      padding: 22px 0 0 60px
      color: rgba(255, 255, 255, .5)
      font-size: 1em
      font-weight: 400
      letter-spacing: 2px
      text-transform: uppercase
      pointer-events: none
      transition: .25s

  :host(:focus-within) .float .icon, .float.filled .icon
    top: -25px
    left: -30px
    width: 60px
    height: 60px

  :host(:focus-within) .float .float-label, .float.filled .float-label
    top: -45px
    padding-left: 40px
    color: #fff
    font-size: .75em

  .help
    margin: 0
    font-size: .78rem
    color: var(--mjs-fg-muted, #888)

  .field.has-error .help
    display: none

  .error
    margin: 0
    font-size: .78rem
    color: var(--mjs-field-error-color, #e5484d)

    &:empty
      display: none

  .ok
    margin: 0
    font-size: .78rem
    color: var(--mjs-field-ok-color, #2e9e5b)

    &:empty
      display: none
</style>
