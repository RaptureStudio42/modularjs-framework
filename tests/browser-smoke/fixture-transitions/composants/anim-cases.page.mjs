<routes target="vt">
  /   vt-page-a
  /b  vt-page-b
</routes>

<script>
  $fade          = true
  $fly           = true
  $fly_angle     = true
  $fly_elastic   = true
  $slide         = true
  $scale         = true
  $scale_origin  = true
  $scale_elastic = true
  $blur          = true
  $typewriter    = true
  $draw          = true
  $iris          = true
  $iris_corner   = true
  $volet         = true
  $swipe         = true
  $swipe_angle   = true
  $bars          = true
  $blocks        = true
  $shatter       = true
  $toupie        = true
  $typer         = true
  $inout         = true
  $maison        = true
  $shared        = true
  $global        = true
  $events        = true
  $status        = 'attente'
  $face          = 0
  $k             = 0
  $todos         = [{ id: 1, text: 'un' }, { id: 2, text: 'deux' }, { id: 3, text: 'trois' }]
  $done          = []
  $order         = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  $progress      = µinterpolate(0, 400)
  $size          = µspring(10, 0.1, 0.25)
  trio           = [1, 2, 3]

  µanim.create 'toupie',
    duration: 300
    css: (t)->
      transform: "scale(#{t}) rotate(#{t * 360}deg)"

  µanim.create 'typer', (node)->
    text = node.textContent
    { duration: 300, tick: (t)-> node.textContent = text.slice(0, Math.trunc(text.length * t)) }

  message = (k)-> "message numero #{k}"

  finishFirst = ->
    return unless $todos.length
    todo   = $todos[0]
    $todos = $todos.filter((t)-> t.id != todo.id)
    $done  = $done.concat(todo)

  shuffle = -> $order = $order.slice().reverse()
</script>

<section class="cases">
  <button id="btn-fade" @click={$fade = not $fade}>fade</button>
  {if $fade}
    <p data-case="fade" @transition=*fade(300ms)>fade</p>
  {end}

  <button id="btn-fly" @click={$fly = not $fly}>fly</button>
  {if $fly}
    <p data-case="fly" @transition=*fly(up, distance: 40, duration: 300ms)>fly</p>
  {end}

  <button id="btn-fly_angle" @click={$fly_angle = not $fly_angle}>fly_angle</button>
  {if $fly_angle}
    <p data-case="fly_angle" @transition=*fly(135, distance: 40, duration: 300ms)>fly en biais</p>
  {end}

  <button id="btn-fly_elastic" @click={$fly_elastic = not $fly_elastic}>fly_elastic</button>
  {if $fly_elastic}
    <p data-case="fly_elastic" @transition=*fly(up, distance: 40, easing: elastic-out, duration: 300ms)>fly elastique</p>
  {end}

  <button id="btn-slide" @click={$slide = not $slide}>slide</button>
  {if $slide}
    <p data-case="slide" @transition=*slide(duration: 300ms)>slide</p>
  {end}

  <button id="btn-scale" @click={$scale = not $scale}>scale</button>
  {if $scale}
    <p data-case="scale" @transition=*scale(duration: 300ms)>scale</p>
  {end}

  <button id="btn-scale_origin" @click={$scale_origin = not $scale_origin}>scale_origin</button>
  {if $scale_origin}
    <p data-case="scale_origin" @transition=*scale(0.55, origin: top-left, duration: 300ms)>scale depuis un coin</p>
  {end}

  <button id="btn-scale_elastic" @click={$scale_elastic = not $scale_elastic}>scale_elastic</button>
  {if $scale_elastic}
    <p data-case="scale_elastic" @transition=*scale(0, easing: elastic-out, duration: 300ms)>scale elastique</p>
  {end}

  <button id="btn-blur" @click={$blur = not $blur}>blur</button>
  {if $blur}
    <p data-case="blur" @transition=*blur(duration: 300ms)>blur</p>
  {end}

  <button id="btn-typewriter" @click={$typewriter = not $typewriter}>typewriter</button>
  {if $typewriter}
    <p data-case="typewriter" @transition=*typewriter(20)>le vif zephyr jubile sur les kumquats</p>
  {end}

  <button id="btn-draw" @click={$draw = not $draw}>draw</button>
  <div class="wrap" @childtransition="all">
    {if $draw}
      <svg viewBox="0 0 120 40" width="120" height="40">
        <path data-case="draw" d="M10 20 L110 20" @transition=*draw(300ms)/>
      </svg>
    {end}
  </div>

  <button id="btn-iris" @click={$iris = not $iris}>iris</button>
  {if $iris}
    <p data-case="iris" @transition=*iris(duration: 300ms)>iris</p>
  {end}

  <button id="btn-iris_corner" @click={$iris_corner = not $iris_corner}>iris_corner</button>
  {if $iris_corner}
    <p data-case="iris_corner" @transition=*iris(top-left, duration: 300ms)>iris depuis un coin</p>
  {end}

  <button id="btn-volet" @click={$volet = not $volet}>volet</button>
  {if $volet}
    <p data-case="volet" @transition=*volet(down, duration: 300ms)>volet</p>
  {end}

  <button id="btn-swipe" @click={$swipe = not $swipe}>swipe</button>
  {if $swipe}
    <p data-case="swipe" @transition=*swipe(left, duration: 300ms)>swipe</p>
  {end}

  <button id="btn-swipe_angle" @click={$swipe_angle = not $swipe_angle}>swipe_angle</button>
  {if $swipe_angle}
    <p data-case="swipe_angle" @transition=*swipe(135, duration: 300ms)>swipe en biais</p>
  {end}

  <button id="btn-bars" @click={$bars = not $bars}>bars</button>
  {if $bars}
    <p data-case="bars" @transition=*bars(up, duration: 300ms)>bars</p>
  {end}

  <button id="btn-blocks" @click={$blocks = not $blocks}>blocks</button>
  {if $blocks}
    <p data-case="blocks" @transition=*blocks(duration: 300ms)>blocks</p>
  {end}

  <button id="btn-shatter" @click={$shatter = not $shatter}>shatter</button>
  <div class="scene">
    {if $shatter}
      <img data-case="shatter" src="/eclats.svg" width="80" height="40" alt="" @transition=*shatter(size: 16, duration: 300ms)>
    {end}
  </div>

  <button id="btn-toupie" @click={$toupie = not $toupie}>toupie</button>
  {if $toupie}
    <p data-case="toupie" @transition=*toupie>toupie</p>
  {end}

  <button id="btn-typer" @click={$typer = not $typer}>typer</button>
  {if $typer}
    <p data-case="typer" @transition=*typer>tape ce texte lettre a lettre</p>
  {end}

  <button id="btn-inout" @click={$inout = not $inout}>in/out</button>
  {if $inout}
    <p data-case="inout" @in=*fly(up, distance: 30, duration: 300ms) @out=*fade(300ms)>in fly, out fade</p>
  {end}

  <button id="btn-maison" @click={$maison = not $maison}>maison</button>
  {if $maison}
    <p data-case="maison" @in=*entree @out=*voile(duration: 300ms)>effets de l'appli</p>
  {end}

  <button id="btn-shared" @click={$shared = not $shared}>shared</button>
  {if $shared}
    <p data-case="shared" @transition.shared=*fade(300ms)>shared</p>
  {end}

  <button id="btn-events" @click={$events = not $events}>events</button>
  <p id="status">{$status}</p>
  {if $events}
    <p data-case="events" @transition=*fly(up, distance: 30, duration: 300ms) @introstart={$status = 'introstart'} @introend={$status = 'introend'} @outrostart={$status = 'outrostart'} @outroend={$status = 'outroend'}>events</p>
  {end}

  <button id="btn-global" @click={$global = not $global}>global</button>
  <div class="wrap" @childtransition="all">
    {if $global}
      <ul>
        {for n in trio}
          <li data-case="global" @transition.global=*fade(300ms)>{n}</li>
        {end}
      </ul>
    {end}
  </div>

  <button id="btn-face" @click={$face++}>face</button>
  <div class="deck" data-deck="reveal">
    {key $face}
      <div data-case="reveal" @transition=*reveal(duration: 300ms)>reveal {$face}</div>
    {end}
  </div>
  <div class="deck" data-deck="flip">
    {key $face}
      <div data-case="flip" @transition=*flip(duration: 300ms)>flip {$face}</div>
    {end}
  </div>
  <div class="deck" data-deck="cube">
    {key $face}
      <div data-case="cube" @transition=*cube(duration: 300ms)>cube {$face}</div>
    {end}
  </div>
  <div class="deck" data-deck="turn">
    {key $face}
      <div data-case="turn" @transition=*turn(duration: 300ms)>turn {$face}</div>
    {end}
  </div>

  <button id="btn-keyed" @click={$k++}>keyed</button>
  <div class="deck" data-deck="keyed">
    {key $k}
      <p data-case="keyed" @in=*typewriter(40)>{message($k)}</p>
    {end}
  </div>

  <button id="btn-finish" @click={finishFirst()}>finish</button>
  <ul data-list="todo">
    {for t in $todos by id}
      <li data-case="todo" @transition=*crossfade(t.id, group: todo, duration: 300ms) @flip=300>{t.text}</li>
    {end}
  </ul>
  <ul data-list="done">
    {for t in $done by id}
      <li data-case="done" @transition=*crossfade(t.id, group: todo, duration: 300ms) @flip=300>{t.text}</li>
    {end}
  </ul>

  <button id="btn-shuffle" @click={shuffle()}>shuffle</button>
  <ul data-list="order">
    {for o in $order by id}
      <li data-case="order" @flip=300>{o.id}</li>
    {end}
  </ul>

  <button id="btn-progress" @click={$progress = 100}>progress</button>
  <span id="progress">{Math.round($progress.current)}</span>

  <button id="btn-size" @click={$size = 30}>size</button>
  <span id="size">{Math.round($size.current)}</span>

  <a id="lnk-a" href="#/">A</a>
  <a id="lnk-b" href="#/b">B</a>
  <@view vt @viewTransition.cube={ dir: left }>
</section>

<style>
  .cases
    display: flex
    flex-direction: column
    gap: 6px
    padding: 12px
    font-family: sans-serif

  p, li, .deck > div
    margin: 0
    padding: 6px 10px
    background: #eef
    color: #123

  .wrap
    min-height: 20px

  .scene
    position: relative
    min-height: 40px

  .deck
    position: relative
    min-height: 32px

  ul
    display: flex
    gap: 8px
    margin: 0
    padding: 0
    list-style: none

  path
    stroke: #123
    stroke-width: 3
    fill: none
</style>
