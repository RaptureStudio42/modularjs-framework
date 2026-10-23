@formAssociated

<script module>
  nextStart = 0
  # les boutons, et les groupes quittés par un bouton parti, qui ont à refaire leur arrêt de tabulation et leur validité : refaits ensemble au
  # cran suivant, chaque groupe une seule fois
  queued = null
  # le choix de départ de chaque groupe, cherché une fois par remise à zéro : le premier bouton remis le trouve pour tout son groupe, ses
  # voisins remis dans le même tour le reprennent (deux mille boutons : une recherche du groupe au lieu de deux mille) ; oublié au cran suivant
  starts = null
</script>

<script>
  $name         = ''
  $value        = 'on'
  $checked      = false
  $disabled     = false
  $required     = false
  $formDisabled = false
  $group        = undefined

  lastScope = null
  lastForm  = null

  # un attribut booléen écrit sur la balise vaut vrai quelle que soit sa valeur, comme en HTML (`disabled=""`, `required=""`, posé par
  # `setAttribute(…, '')`) ; « false », quelle que soit sa casse, le laisse faux (le rendu serveur la lit ici, sans le socle du cœur qui l'ôte
  # de la balise dans le navigateur)
  on = (v)-> v? and v !== false and String(v).toLowerCase() !== 'false'

  # le formulaire d'un bouton, comme celui d'un bouton natif : celui que vise son `form="id"`, où qu'il soit dans la racine, sinon le <form>
  # autour de lui (sans le socle du cœur, navigateur sans attachInternals : le <form> autour de lui)
  formOf = (el)-> if el.hasAttribute('form') and el.internals then el.form else el.closest('form')

  # les boutons d'un même groupe : même name, même formulaire, cherchés dans la racine du bouton (document ou ombre) — un bouton qui rejoint
  # le <form> par `form="id"` est du groupe des boutons écrits dedans ; un bouton sans formulaire ne coordonne qu'avec ceux sans formulaire
  groupIn = (scope, form, name)->
    # sécurité : un name à guillemet cassait le sélecteur (SyntaxError sur querySelectorAll)
    safeName = if typeof CSS != 'undefined' and CSS.escape then CSS.escape(name) else String(name).replace(/["\\]/g, '\\$&')
    sel = 'mjs-core-radio[name="' + safeName + '"]'
    Array.from(scope.querySelectorAll(sel)).filter (el)-> formOf(el) == form

  # le formulaire et la racine du bouton, gardés pour son départ
  place = ->
    lastForm  = formOf(@@closest('mjs-core-radio')) # le bouton lui-même : closest commence par lui
    lastScope = @@getRootNode()

  groupOf = ->
    place()
    groupIn(lastScope, lastForm, $name)

  nativeOf = (el)-> el._shadow?.querySelector('input[type=radio]')

  # l'arrêt de tabulation et les flèches ne font jamais tomber le bouton : un moteur qui refuse le
  # sélecteur du groupe (name exotique) le laisse seul dans son groupe
  tryGroup = (find)->
    try
      find()
    catch e
      []

  # chaque case native vit dans son propre shadow : le navigateur y voit autant de groupes que de
  # boutons. Le module fait donc ce que fait un groupe natif — un seul arrêt de tabulation, le bouton
  # coché (tous, quand aucun ne l'est) ; un bouton coché désactivé n'est pas focalisable : le premier
  # bouton libre prend l'arrêt à sa place, comme dans un groupe natif ; les flèches cochent le voisin
  # et y mettent le focus
  rove = (group)->
    free   = group.filter (el)-> not on(el._state?.disabled) and not el._state?.formDisabled
    marked = group.some (el)-> !!el._state?.checked
    stop   = free.find (el)-> !!el._state?.checked
    stop ||= free[0] if marked
    for el in group
      input = nativeOf(el)
      input.tabIndex = (if stop and el isnt stop then -1 else 0) if input

  # un groupe obligatoire (un de ses boutons porte `required`) manque tant qu'aucun de ses boutons n'est coché : chaque bouton actif le dit au
  # formulaire (la bulle va au premier, comme dans un groupe natif), et le bouton coché, quel qu'il soit, lève la bulle de tous ; un bouton
  # désactivé, par lui-même ou par un `<fieldset disabled>` (`$formDisabled`, posé par le socle du cœur), ne compte plus
  validate = (group)->
    required = group.some (el)-> on(el._state?.required)
    checked  = group.some (el)-> !!el._state?.checked
    for el in group
      µ._mjs_formValid el, nativeOf(el), required and not checked and not on(el._state?.disabled) and not el._state?.formDisabled

  # le choix de départ d'un groupe lié : celui du bouton monté le premier. Un bouton monté plus tard, quand la
  # variable avait déjà changé, en a pris un autre en photo
  startOf = ->
    return starts.get(@@resetStart) if starts?.has(@@resetStart)
    firsts = tryGroup(groupOf).filter((el)-> el.resetStart).sort((a, b)-> a.resetStart.rank - b.resetStart.rank)
    start  = firsts[0]?.resetStart.group
    unless starts
      starts = new Map()
      queueMicrotask(-> starts = null)
    for el in firsts
      starts.set(el.resetStart, start)
    start

  @onKey = (e)->
    dir = if e.key is 'ArrowRight' or e.key is 'ArrowDown' then 1 else if e.key is 'ArrowLeft' or e.key is 'ArrowUp' then -1 else 0
    return unless dir
    # Alt, Ctrl et Méta gardent leurs raccourcis au navigateur (Alt+← est le « retour »)
    return if e.altKey or e.ctrlKey or e.metaKey
    self  = @
    group = tryGroup(groupOf).filter (el)-> el is self or not nativeOf(el)?.disabled
    return if group.length < 2
    e.preventDefault()
    i     = group.indexOf(self)
    input = nativeOf(group[(i + dir + group.length) % group.length])
    return unless input
    input.focus()
    input.click() unless input.checked

  # le bouton que l'utilisateur vient de cocher annonce sa valeur par `change`, la variable liée, les voisins et le
  # champ du formulaire de chacun déjà à jour ; rien pour un bouton déjà coché, quand la page pose elle-même la valeur,
  # ni pour la remise à zéro du formulaire
  @onChange = (e)->
    return unless e.target.checked
    self     = @
    changed  = not $checked
    $checked = true
    $group   = $value
    @syncHidden()
    # les voisins se décochent dans le geste même, comme dans un groupe natif : leur case native, leur état et le choix du groupe qu'ils
    # gardent — un voisin coché dans la même tâche (deux `click()` de suite) se recochait au passage suivant de la réactivité
    chosen = $value
    groupOf().forEach (el)->
      return if el == self
      el._set('checked', false)
      el._set('group', chosen) if el._state?.group isnt undefined
      box = nativeOf(el)
      box.checked = false if box
      el.syncHidden?()
    @syncValidity()
    µemit 'change', $value if changed

  # le groupe du bouton, lui seul s'il n'en a pas (sans `name`, comme un bouton natif)
  @syncValidity = ->
    self  = @
    group = tryGroup(groupOf)
    validate(if group.includes(self) then group else [self])

  # refait l'arrêt de tabulation et la validité du groupe du bouton ; `done` reçoit les boutons refaits
  @regroup = (done)->
    self  = @
    group = tryGroup(groupOf)
    group.forEach (el)-> done.add(el)
    rove(group)
    validate(if group.includes(self) then group else [self])

  # un groupe se refait au cran suivant, une fois pour tous les boutons qui l'ont demandé ensemble (mille boutons montés ensemble : une
  # seule recherche du groupe, un seul passage, au lieu d'un passage par bouton) ; un bouton parti laisse son groupe à refaire sans lui
  soon = (item)->
    unless queued
      queued = []
      queueMicrotask(flush)
    queued.push(item)

  flush = ->
    items  = queued
    queued = null
    done   = new Set()
    for item in items
      continue if done.has(item)
      if item.regroup
        item.regroup(done) if item.isConnected
        continue
      group = tryGroup(-> groupIn(item.scope, item.form, item.name))
      continue if group.some((el)-> done.has(el))
      group.forEach (el)-> done.add(el)
      rove(group)
      validate(group)
    return

  @later = ->
    place()
    soon(@)

  µeffect ->
    if $group != undefined
      $checked = ($group == $value)
      @@setAttribute('group', String($group)) if µserver and ($group or $group is 0) and typeof $group isnt 'object' # @@ reprise

  µeffect ->
    $checked
    $name
    $disabled
    $required
    $formDisabled
    @@later()

  # le rang se prend au montage : il dit quel bouton du groupe a été monté le premier. L'état de départ est celui du premier rendu, lu APRÈS
  # le montage par l'aide du cœur (qui suit le formulaire où le bouton EST et le rend une fois l'événement passé) : une prop `checked={…}` n'est
  # posée par la page qu'à la fin de son premier rendu, un cran après le montage du bouton, et les effets ci-dessus viennent alors de déduire
  # celui d'un groupe lié. Le choix lié que ce bouton a vu se dit aussi à ses voisins (startOf)
  # La remise à zéro du formulaire ramène le groupe au choix de son premier rendu : la variable liée (group=!{…}) reprend le choix du bouton
  # monté le premier et chaque bouton se coche d'après elle — le moment où un bouton a été monté, la place qu'il tient (un {for} réordonné
  # réutilise les nœuds) n'y changent rien. Sans variable liée, chaque bouton revient à coché ou non (`checked`, ce qu'il a lu au départ)
  µmount ->
    @@resetStart = { rank: nextStart++ }
    µ._mjs_formReset @, ->
      @@resetStart.group = $group
      checked            = $checked
      ->
        start = startOf()
        if start is undefined
          $checked = checked
          $group   = undefined
        else
          $group   = start
          $checked = start == $value
        return
    # une `<label for>` qui vise le bouton le coche comme une étiquette de bouton natif ; l'arrêt de tabulation et la validité de départ, la
    # case native posée
    µ._mjs_formLabel @, nativeOf(@)
    @later()

  # parti de la page, le bouton coché rend l'arrêt de tabulation aux autres, et le groupe qui reste dit sa validité sans lui
  µdestroy ->
    return unless lastScope
    soon({ scope: lastScope, form: lastForm, name: $name })

  hiddenInput = null

  # le champ du formulaire suit l'état : posé quand le bouton est coché et actif, retiré sinon ; un bouton qui
  # vient d'être coché met à jour celui de ses voisins sans attendre leur effet ; le champ que le module a déjà écrit dans
  # la balise (page rendue par le serveur, il porte `mjs-f`) est repris, jamais doublé ; un champ caché de la page, de même
  # nom, n'est jamais touché ; la marque n'est écrite que par le serveur (le champ créé dans le navigateur ne la porte pas, le module en garde la référence),
  # et sa recherche comme son écriture ne partent en production que vers une application qui reprend des pages rendues par le serveur (repères `@@`) ;
  # `form="id"` sur la balise passe au champ, qui part alors avec ce formulaire
  @syncHidden = ->
    hiddenInput ||= @@querySelector(':scope > [mjs-f]') # @@ reprise
    active = $checked and not on($disabled)
    if active
      if not hiddenInput
        hiddenInput = document.createElement('input')
        hiddenInput.type = 'hidden'
        hiddenInput.setAttribute('mjs-f', '') if µserver # @@ reprise
        @@appendChild(hiddenInput)
      hiddenInput.name  = $name
      hiddenInput.value = $value
      µ._mjs_formField hiddenInput
    else if hiddenInput
      hiddenInput.remove()
      hiddenInput = null

  # @@ reprise
  # rendu par le serveur, le bouton dit son état dans sa balise (`checked` ici, `group` dans l'effet du groupe), même posé par expression : un module chargé avant la page le relit à son montage et part du bon état de départ ; le build de production n'envoie ce code qu'à une application qui reprend des pages rendues par le serveur (repères `@@`)
  reflect = ->
    return unless µserver
    if $checked then @@setAttribute('checked', 'true') else @@removeAttribute('checked')
  # @@

  µeffect ->
    $checked
    $disabled
    $name
    $value
    @@syncHidden()
    reflect() # @@ reprise
</script>

<label class="wrap" part="wrap" @class{on($disabled) or $formDisabled}="disabled">
  <input type="radio" class="native" name="{$name}" value="{$value}" checked={$checked} disabled={on($disabled) or $formDisabled} required={on($required)} @change={@onChange(e)} @keydown={@onKey(e)}>
  <span class="ring" part="dot" aria-hidden="true">
    <span class="dot"></span>
  </span>
  <span class="label" part="label"><slot></slot></span>
</label>

<style>
  :host
    display: inline-block

  .wrap
    display: inline-flex
    align-items: center
    gap: 8px
    cursor: pointer
    user-select: none

    &.disabled
      cursor: not-allowed
      opacity: .5

  input.native
    position: absolute
    opacity: 0
    width: var(--mjs-check-size, 20px)
    height: var(--mjs-check-size, 20px)
    margin: 0
    cursor: inherit

  .ring
    position: relative
    display: inline-flex
    align-items: center
    justify-content: center
    width: var(--mjs-check-size, 20px)
    height: var(--mjs-check-size, 20px)
    flex: none
    border: 2px solid var(--mjs-check-border, var(--mjs-border, #888))
    border-radius: 50%
    transition: border-color .18s ease

  .dot
    width: 50%
    height: 50%
    border-radius: 50%
    background-color: var(--mjs-check-accent, var(--mjs-accent, #3b82f6))
    opacity: 0
    transform: scale(.4)
    transition: opacity .15s ease, transform .15s ease

  input.native:checked ~ .ring
    border-color: var(--mjs-check-accent, var(--mjs-accent, #3b82f6))

    .dot
      opacity: 1
      transform: scale(1)

  input.native:focus-visible ~ .ring
    box-shadow: 0 0 0 3px var(--mjs-check-focus, rgba(59, 130, 246, .35))

  .label
    font-size: .9rem
</style>
