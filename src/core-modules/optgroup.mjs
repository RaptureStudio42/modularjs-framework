<script>
  µeffect =>
    if $label == undefined or $label == null then @removeAttribute('label') else @setAttribute('label', String($label))
</script>

<slot></slot>

<style>
  :host
    display: none
</style>
