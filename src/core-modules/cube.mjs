<script>
  $size   = 200
  $height = 50
  $color  = '#ff0606'
  $speed  = 4
  $hue    = true

  boolAttr = (v)-> v !== undefined and v !== false and v !== 'false'
  num      = (v, d)-> if v? and v !== '' and isFinite(Number(v)) then Number(v) else d
</script>

<div class="scene" part="scene" @class{boolAttr($hue)}="hue" --mjs-cube-size={num($size, 200) + 'px'} --mjs-cube-height={num($height, 50) + 'px'} --mjs-cube-color={$color} --mjs-cube-speed={num($speed, 4) + 's'}>
  <div class="cube">
    <div class="top">
      <span class="icon" part="icon"><slot></slot></span>
    </div>
    <div class="box">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>
  </div>
</div>

<style @display="inline-block">
  .scene
    display: grid
    place-items: center
    width: calc(var(--mjs-cube-size) * 1.6)
    height: calc(var(--mjs-cube-size) * 1.6)

    &.hue
      animation: mjs-cube-hue calc(var(--mjs-cube-speed) * 1) linear infinite

  .cube
    position: relative
    width: var(--mjs-cube-size)
    height: var(--mjs-cube-height)
    transform-style: preserve-3d
    animation: mjs-cube-turn var(--mjs-cube-speed) linear infinite

  .box
    position: absolute
    inset: 0
    transform-style: preserve-3d

    span
      position: absolute
      inset: 0
      background: linear-gradient(#151519, var(--mjs-cube-color))
      transform-style: preserve-3d
      transform: rotateY(calc(90deg * var(--mjs-cube-i, 0))) translateZ(calc(var(--mjs-cube-size) / 2))

      &:nth-child(2)
        --mjs-cube-i: 1

      &:nth-child(3)
        --mjs-cube-i: 2

      &:nth-child(4)
        --mjs-cube-i: 3

  .top
    position: absolute
    top: 0
    left: 0
    display: flex
    justify-content: center
    align-items: center
    width: var(--mjs-cube-size)
    height: var(--mjs-cube-size)
    background: #222
    transform-style: preserve-3d
    transform: rotateX(90deg) translateZ(calc(var(--mjs-cube-size) / 2))

    &::before
      content: ''
      position: absolute
      inset: 0
      background: var(--mjs-cube-color)
      opacity: .75
      transform: translateZ(calc(var(--mjs-cube-size) * -.625))
      box-shadow: 0 0 calc(var(--mjs-cube-size) * .3) color-mix(in srgb, var(--mjs-cube-color) 20%, transparent), 0 0 calc(var(--mjs-cube-size) * .5) color-mix(in srgb, var(--mjs-cube-color) 40%, transparent), 0 0 calc(var(--mjs-cube-size) * .75) color-mix(in srgb, var(--mjs-cube-color) 60%, transparent), 0 0 var(--mjs-cube-size) color-mix(in srgb, var(--mjs-cube-color) 80%, transparent), 0 0 calc(var(--mjs-cube-size) * 1.25) var(--mjs-cube-color)

  .icon
    position: absolute
    color: var(--mjs-cube-color)
    font-size: calc(var(--mjs-cube-size) * .375)
    line-height: 1
    text-shadow: 0 0 calc(var(--mjs-cube-size) * .125) color-mix(in srgb, var(--mjs-cube-color) 25%, transparent), 0 0 calc(var(--mjs-cube-size) * .25) color-mix(in srgb, var(--mjs-cube-color) 50%, transparent), 0 0 calc(var(--mjs-cube-size) * .5) color-mix(in srgb, var(--mjs-cube-color) 75%, transparent)

  @keyframes mjs-cube-turn
    0%
      transform: rotateX(-30deg) rotateY(0deg)
    100%
      transform: rotateX(-30deg) rotateY(360deg)

  @keyframes mjs-cube-hue
    0%
      filter: hue-rotate(0deg)
    50%
      filter: hue-rotate(360deg)

  @media (prefers-reduced-motion: reduce)
    .scene.hue, .cube
      animation: none
</style>
