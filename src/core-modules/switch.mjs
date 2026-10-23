@formAssociated

<script>
  $name         = ''
  $checked      = false
  $disabled     = false
  $required     = false
  $formDisabled = false
  $value        = 'on'
  $on           = 'On'
  $off          = 'Off'

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

  # le champ du formulaire suit l'état : posé quand l'interrupteur est allumé et actif, retiré sinon ; le champ que le module a
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

  # @@ reprise
  # rendu par le serveur, l'interrupteur dit son état dans sa balise (même posé par `checked={…}`) : un module chargé avant la page le relit à son montage et part du bon état de départ ; le build de production n'envoie ce code qu'à une application qui reprend des pages rendues par le serveur (repères `@@`)
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

  # obligatoire (`required`), l'interrupteur manque tant qu'il n'est pas allumé — sauf désactivé, par lui-même ou par un `<fieldset disabled>`
  # (`$formDisabled`, posé par le socle du cœur) : le formulaire le sait, avec le message du navigateur, comme pour une case native
  @syncValidity = ->
    µ._mjs_formValid @, native, on($required) and not $checked and not on($disabled) and not $formDisabled

  µeffect ->
    $required
    $checked
    $disabled
    $formDisabled
    @@syncValidity()

  # un formulaire remis à zéro rend l'interrupteur à son état de départ, comme une case native, sans annoncer de `change` : l'aide du cœur
  # prend cet état UN cran après le montage (une prop `checked={…}` n'est posée par la page qu'à la fin de son premier rendu),
  # suit le formulaire où l'interrupteur EST, et le rend une fois l'événement passé (une remise annulée par la page ne touche à rien)
  # une `<label for>` qui vise l'interrupteur le bascule comme une étiquette de case native ; la validité de départ, la case native posée
  µmount ->
    µ._mjs_formReset @, ->
      start = $checked
      ->
        $checked = start
        return
    µ._mjs_formLabel @, native
    @syncValidity()
</script>

<label class="wrap" part="wrap" @class{on($disabled) or $formDisabled}="disabled" @class{µlayout is 'triangle'}="triangle">
  <input type="checkbox" role="switch" class="native" name="{$name}" value="{$value}" checked={$checked} disabled={on($disabled) or $formDisabled} required={on($required)} @this=!{native} @change={@onChange(e)}>
  <span class="pill" part="pill" aria-hidden="true">
    {if µlayout is 'triangle'}
      <span class="tri-on">{$on}</span>
      <span class="tri-off">{$off}</span>
    {end}
    <span class="knob"></span>
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
    width: var(--mjs-switch-width, 40px)
    height: var(--mjs-switch-height, 22px)
    margin: 0
    cursor: inherit

  .pill
    position: relative
    display: inline-flex
    align-items: center
    box-sizing: border-box
    width: var(--mjs-switch-width, 40px)
    height: var(--mjs-switch-height, 22px)
    flex: none
    border: 2px solid var(--mjs-switch-border, var(--mjs-border, #888))
    border-radius: calc(var(--mjs-switch-height, 22px) / 2)
    background-color: transparent
    transition: background-color .2s ease, border-color .2s ease

  .knob
    position: absolute
    left: 2px
    width: calc(var(--mjs-switch-height, 22px) - 8px)
    height: calc(var(--mjs-switch-height, 22px) - 8px)
    border-radius: 50%
    background-color: var(--mjs-switch-border, var(--mjs-border, #888))
    transition: transform .2s ease, background-color .2s ease

  input.native:checked ~ .pill
    background-color: var(--mjs-switch-accent, var(--mjs-accent, #3b82f6))
    border-color: var(--mjs-switch-accent, var(--mjs-accent, #3b82f6))

    .knob
      background-color: var(--mjs-switch-color, #fff)
      transform: translateX(calc(var(--mjs-switch-width, 40px) - var(--mjs-switch-height, 22px)))

  input.native:focus-visible ~ .pill
    box-shadow: 0 0 0 3px var(--mjs-switch-focus, rgba(59, 130, 246, .35))

  .label
    font-size: .9rem

  .triangle
    input.native
      width: 120px
      height: 60px

    .pill
      justify-content: space-between
      width: 120px
      height: 60px
      padding: 0
      border: 0
      border-radius: 10px
      background: #222
      box-shadow: inset 0 2px 15px rgba(0, 0, 0, .2), inset 0 2px 2px rgba(0, 0, 0, .2), inset 0 -1px 1px rgba(0, 0, 0, .2)
      transform: skewX(330deg)
      font-family: consolas, monospace
      text-transform: uppercase

    .knob
      left: auto
      width: 0
      height: 0
      border-radius: 0
      background: none
      border-left: 35px solid transparent
      border-right: 35px solid transparent
      border-bottom: 60px solid var(--mjs-switch-off, #0f0)
      transform: skewX(30deg) scale(.6) translateX(-16px)
      filter: drop-shadow(0 0 10px var(--mjs-switch-off, #0f0)) drop-shadow(0 0 30px var(--mjs-switch-off, #0f0))
      transition: .5s

    .tri-on, .tri-off
      padding: 10px
      transition: .5s

    .tri-on
      color: var(--mjs-switch-on, #f00)
      transform: skewX(30deg) scale(0)
      filter: drop-shadow(0 0 10px var(--mjs-switch-on, #f00)) drop-shadow(0 0 30px var(--mjs-switch-on, #f00))

    .tri-off
      color: var(--mjs-switch-off, #0f0)
      transform: skewX(30deg) scale(1)
      filter: drop-shadow(0 0 10px var(--mjs-switch-off, #0f0)) drop-shadow(0 0 30px var(--mjs-switch-off, #0f0))

  .triangle input.native:checked ~ .pill
    background-color: #222

    .knob
      background: none
      border-bottom-color: var(--mjs-switch-on, #f00)
      transform: skewX(30deg) scale(.6) translateX(100px) rotate(180deg)
      filter: drop-shadow(0 0 10px var(--mjs-switch-on, #f00)) drop-shadow(0 0 30px var(--mjs-switch-on, #f00))

    .tri-on
      transform: skewX(30deg) scale(1)

    .tri-off
      transform: skewX(30deg) scale(0)

  @media (prefers-reduced-motion: reduce)
    .triangle .knob, .triangle .tri-on, .triangle .tri-off
      transition: none
</style>
