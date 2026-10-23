@formAssociated

<script>
  $name          = ''
  $checked       = false
  $disabled      = false
  $required      = false
  $formDisabled  = false
  $indeterminate = false
  $value         = 'on'

  # un attribut booléen écrit sur la balise vaut vrai quelle que soit sa valeur, comme en HTML (`disabled=""`, `required=""`, posé par
  # `setAttribute(…, '')`) ; « false », quelle que soit sa casse, le laisse faux (le rendu serveur la lit ici, sans le socle du cœur qui l'ôte
  # de la balise dans le navigateur)
  on = (v)-> v? and v !== false and String(v).toLowerCase() !== 'false'

  # le geste de l'utilisateur annonce son état par `change`, la variable liée et le champ du formulaire déjà à
  # jour ; rien quand la page pose elle-même l'état ni pour la remise à zéro du formulaire : ce ne sont pas des gestes
  @onChange = (e)->
    changed  = e.target.checked != $checked
    $checked = e.target.checked
    syncHidden()
    @syncValidity()
    µemit 'change', $checked if changed

  hiddenInput = null
  native      = null

  # le champ du formulaire suit l'état : posé quand la case est cochée et active, retiré sinon ; le champ que le module a
  # déjà écrit dans la balise (page rendue par le serveur, il porte `mjs-f`) est repris, jamais doublé ; un champ caché
  # de la page, de même nom, n'est jamais touché ; la marque n'est écrite que par le serveur (le champ créé dans le navigateur ne la porte pas, le module en garde la référence),
  # et sa recherche comme son écriture ne partent en production que vers une application qui reprend des pages rendues par le serveur (repères `@@`)
  syncHidden = ->
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

  µeffect ->
    native.indeterminate = $indeterminate if native

  # obligatoire (`required`), la case manque tant qu'elle n'est pas cochée — sauf désactivée, par elle-même ou par un `<fieldset disabled>`
  # (`$formDisabled`, posé par le socle du cœur) : le formulaire le sait, avec le message du navigateur, comme pour une case native
  @syncValidity = ->
    µ._mjs_formValid @, native, on($required) and not $checked and not on($disabled) and not $formDisabled

  µeffect ->
    $required
    $checked
    $disabled
    $formDisabled
    @@syncValidity()

  # @@ reprise
  # rendu par le serveur, la case dit son état dans sa balise (même posé par `checked={…}`) : un module chargé avant la page le relit à son montage et part du bon état de départ ; le build de production n'envoie ce code qu'à une application qui reprend des pages rendues par le serveur (repères `@@`)
  reflect = ->
    return unless µserver
    if $checked then @@setAttribute('checked', 'true') else @@removeAttribute('checked')
  # @@

  µeffect ->
    $checked
    $disabled
    $name
    $value
    syncHidden()
    reflect() # @@ reprise

  # un formulaire remis à zéro rend la case à son état de départ, comme une case native, sans annoncer de `change` : l'aide du cœur
  # prend cet état UN cran après le montage (une prop `checked={…}` n'est posée par la page qu'à la fin de son premier rendu),
  # suit le formulaire où la case EST, et le rend une fois l'événement passé (une remise annulée par la page ne touche à rien)
  # une `<label for>` qui vise la case la coche comme une étiquette de case native ; la validité de départ, la case native posée
  µmount ->
    µ._mjs_formReset @, ->
      start = $checked
      ->
        $checked = start
        return
    µ._mjs_formLabel @, native
    @syncValidity()
</script>

<label class="wrap" part="wrap" @class{on($disabled) or $formDisabled}="disabled" @class{µlayout is 'glow'}="glow">
  <input type="checkbox" class="native" name="{$name}" value="{$value}" checked={$checked} disabled={on($disabled) or $formDisabled} required={on($required)} @this=!{native} @change={@onChange(e)}>
  <span class="box" part="box" aria-hidden="true">
    <svg class="tick" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <span class="dash"></span>
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

  .box
    position: relative
    display: inline-flex
    align-items: center
    justify-content: center
    width: var(--mjs-check-size, 20px)
    height: var(--mjs-check-size, 20px)
    flex: none
    border: 2px solid var(--mjs-check-border, var(--mjs-border, #888))
    border-radius: var(--mjs-check-radius, 4px)
    background-color: transparent
    transition: background-color .18s ease, border-color .18s ease

  .tick
    width: 70%
    height: 70%
    color: var(--mjs-check-color, #fff)
    opacity: 0
    transform: scale(.5)
    transition: opacity .15s ease, transform .15s ease

  .dash
    position: absolute
    inset: 0
    margin: auto
    width: 60%
    height: 2px
    border-radius: 1px
    background-color: var(--mjs-check-color, #fff)
    opacity: 0
    transition: opacity .15s ease

  input.native:checked ~ .box
    background-color: var(--mjs-check-accent, var(--mjs-accent, #3b82f6))
    border-color: var(--mjs-check-accent, var(--mjs-accent, #3b82f6))

    .tick
      opacity: 1
      transform: scale(1)

  input.native:indeterminate ~ .box
    background-color: var(--mjs-check-accent, var(--mjs-accent, #3b82f6))
    border-color: var(--mjs-check-accent, var(--mjs-accent, #3b82f6))

    .tick
      opacity: 0
      transform: scale(.5)

    .dash
      opacity: 1

  input.native:focus-visible ~ .box
    box-shadow: 0 0 0 3px var(--mjs-check-focus, rgba(59, 130, 246, .35))

  .label
    font-size: .9rem

  .glow
    input.native
      width: 120px
      height: 40px

    .box
      width: 120px
      height: 40px
      border: 0
      border-radius: 20px
      background: linear-gradient(0deg, #333, #000)
      box-shadow: 0 0 0 4px #353535, 0 0 0 5px #3e3e3e, inset 0 0 10px #000, 0 5px 20px rgba(0, 0, 0, .5), inset 0 0 15px rgba(0, 0, 0, .2)

      &::before
        content: ''
        position: absolute
        top: 0
        left: 0
        width: 80px
        height: 40px
        border-radius: 20px
        background: linear-gradient(0deg, #000, #6b6b6b)
        box-shadow: 0 0 0 1px #232323
        transform: scale(.98, .96)
        transition: .5s

      &::after
        content: ''
        position: absolute
        top: calc(50% - 2px)
        left: 65px
        width: 4px
        height: 4px
        border-radius: 50%
        background: linear-gradient(0deg, #6b6b6b, #000)
        transition: .5s

    .tick, .dash
      display: none

  .glow input.native:indeterminate ~ .box
    background-color: #20b7ff
    border-color: #20b7ff

  .glow input.native:checked ~ .box
    border-color: #20b7ff
    background: linear-gradient(0deg, #6dd1ff, #20b7ff)
    box-shadow: 0 0 2px #6dd1ff, 0 0 0 4px #353535, 0 0 0 5px #3e3e3e, inset 0 0 10px #000, 0 5px 20px rgba(0, 0, 0, .5), inset 0 0 15px rgba(0, 0, 0, .2)

    &::before
      left: 40px

    &::after
      left: 105px
      background: #63cdff
      box-shadow: 0 0 5px #13b3ff, 0 0 15px #13b3ff

  @media (prefers-reduced-motion: reduce)
    .glow .box::before, .glow .box::after
      transition: none
</style>
