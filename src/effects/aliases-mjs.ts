// effects/aliases-mjs — les alias d'effets que ModularJS livre lui-même, écrits comme ceux d'une appli
// (`*effet.nom = *effet(réglages)`, cf. effects/project.ts), rangés par effet. Ils restent dans le framework : rien n'en est
// copié dans les sources de l'appli, et ce fichier n'est lu qu'à la construction. Un alias de l'appli qui porte le même nom
// les remplace, avec un avertissement à la construction.
//
// Un nom d'alias s'écrit en anglais, en minuscules avec `_` (`frosted_glass`). Aucun ne porte d'image ni de cible propre à
// une page (`image`, `images`, `to`, `of`) : l'auteur les donne à l'usage (`*behind.blurred_edge('moi.png')`,
// `*travel.spin_path('.arrivee')`).

export const MJS_ALIASES_FILE = 'aliases-mjs.ts'

export const MJS_ALIASES = [
  // *backlight
  '*backlight.wide_glow = *backlight(blur: 60, opacity: .9, size: 1.3, y: 24, on: hover)',
  '*backlight.caption_glow = *backlight(legend: true, blur: 36, opacity: 1, saturate: 1.8, size: 1.15, y: 10)',
  // *gradient
  '*gradient.knockout = *gradient(colors: [#ff4fa3, #7c3aed, #22d3ee], angle: 90, size: 200, speed: 15s, direction: left)',
  '*gradient.texture = *gradient(pattern: stripes, colors: [#ff4fa3, #7c3aed, #22d3ee], speed: 6s, angle: 45)',
  // *behind
  '*behind.depth = *behind(depth: 18)',
  '*behind.blurred_edge = *behind(depth: 30, edge: blur)',
  '*behind.solid_edge = *behind(depth: 30, edge: #101014)',
  // *pile
  '*pile.offset = *pile(gap: 64)',
  '*pile.deep = *pile(gap: 40, scale: .08, dim: .25)',
  '*pile.blurred = *pile(gap: 48, top: 72, scale: .06, dim: .2, blur: 5, radius: 28, origin: center)',
  // *velocity
  '*velocity.stretch = *velocity(style: stretch, max: 20, axis: x)',
  '*velocity.tilt = *velocity(style: tilt, max: 28)',
  '*velocity.bend = *velocity(style: bend, max: 44)',
  '*velocity.motion_blur = *velocity(style: blur, max: 10)',
  '*velocity.lag = *velocity(style: shift, max: 60, smooth: .06)',
  // *fluid
  '*fluid.ink_title = *fluid(where: text, auto: true, colors: [#ff2d95, #ffe600, #00ffb3, #00cfff], size: 1, fade: .7)',
  '*fluid.two_colors = *fluid(auto: true, colors: [#ff3d81, #3dc8ff], size: .8, fade: 1.2)',
  '*fluid.glow_rays = *fluid(auto: true, glow: 1.6, rays: 1, colors: [#3dc8ff, #6ee7b7, #a78bfa], size: .9, fade: .8)',
  '*fluid.long_trail = *fluid(fade: .6, friction: .5, curl: 8, size: .9)',
  // *focus
  '*focus.dim_others = *focus(blur: 0, opacity: .3)',
  '*focus.gray_others = *focus(blur: 2, grayscale: 1, scale: .94, grow: 1.12)',
  // *gallery
  '*gallery.strip = *gallery(style: strip, on: drag, index: 3)',
  '*gallery.wheel = *gallery(style: wheel, on: scroll, loop: true)',
  '*gallery.free_wheel = *gallery(style: wheel, on: drag, loop: true, snap: false)',
  '*gallery.arc = *gallery(style: arc, on: drag, loop: true, index: 3, tilt: 8)',
  '*gallery.tunnel = *gallery(style: tunnel, on: always, loop: true, speed: 2500ms, perspective: 900)',
  '*gallery.sphere = *gallery(style: sphere, on: pointer)',
  // *liquid
  '*liquid.tiles = *liquid(strength: 80, cells: 64, radius: 240)',
  '*liquid.red_ghost = *liquid(strength: 56, cells: 48, radius: 260, ghost: #ff0000)',
  '*liquid.smooth_wave = *liquid(strength: 70, radius: 260)',
  // *marquee
  '*marquee.thumbnails = *marquee(speed: 30s, gap: 16, drag: true)',
  '*marquee.columns = *marquee(direction: up, on: scroll, speed: 10s, gap: 14)',
  '*marquee.wall = *marquee(axis: both, gap: 12)',
  '*marquee.text_pause = *marquee(speed: 14s, gap: 64, pause: true)',
  // *physics
  '*physics.springy_cards = *physics(mode: float, push: 170, strength: .18)',
  '*physics.hanging_letters = *physics(mode: hang, length: 200, color: #151515)',
  '*physics.balloons = *physics(mode: hang, gravity: -1, length: 200, color: #14304f)',
  // *pointer
  '*pointer.pink_ring = *pointer(style: ring, color: #e11d48, size: 60, blend: normal)',
  '*pointer.trailing_dot = *pointer(style: dot, color: #fff, size: 72, blend: difference, smooth: .06)',
  '*pointer.gray_lens = *pointer(style: lens, filter: grayscale, size: 170, grow: 1.3)',
  '*pointer.blur_lens = *pointer(style: lens, filter: blur, color: #1f2937, size: 190, grow: 1.3)',
  '*pointer.soft_circle = *pointer(style: lens, outside: true, filter: blur, size: 200, grow: 1.25, soft: 80)',
  // *lift
  '*lift.pressed_key = *lift(on: always, press: true, blur: 0, color: #b45309)',
  // *neon
  '*neon.breathing_red = *neon(color: #ff2a2a, breathe: true, speed: 1.5s)',
  '*neon.pink_frame = *neon(color: #ff3df2, where: both, breathe: true, speed: 2.4s)',
  // *tilt
  '*tilt.floating_layers = *tilt(depth: 80, glare: true, slide: true)',
  '*tilt.bounce_back = *tilt(wait: 650ms, bounce: .28, duration: 1000ms, max: 14.29, scale: 1, perspective: 600, follow: 130ms)',
  // *loader
  '*loader.amber_vortex = *loader(style: vortex, size: 280, speed: 6s, color: #ffb703)',
  '*loader.steps = *loader(style: steps)',
  '*loader.plus = *loader(style: plus)',
  '*loader.neon = *loader(style: neon)',
  '*loader.trio = *loader(style: trio)',
  '*loader.slab_ring = *loader(style: 3d)',
  '*loader.bloom = *loader(style: bloom)',
  '*loader.spiral = *loader(style: spiral)',
  '*loader.galaxy = *loader(style: galaxy)',
  '*loader.cross = *loader(style: cross)',
  // *parallax
  '*parallax.drift = *parallax(origin: page, speed: .6, smooth: .1)',
  // *scrub
  '*scrub.on_hover = *scrub(on: hover)',
  // *filter
  '*filter.gray_spot = *filter(style: grayscale, spot: 280)',
  '*filter.frosted_glass = *filter(style: none, blur: 12, spot: 240, soft: 100)',
  '*filter.lens = *filter(style: none, blur: 10, spot: 200, soft: 0, smooth: 1, ring: true, near: true, parallax: .04)',
  '*filter.sepia_spot = *filter(style: sepia, spot: 320, soft: 160, smooth: .1)',
  '*filter.vintage = *filter(style: vintage)',
  '*filter.lomo = *filter(style: lomo)',
  '*filter.cyberpunk = *filter(style: cyberpunk)',
  '*filter.thermal = *filter(style: thermal)',
  '*filter.posterize = *filter(style: posterize)',
  '*filter.halftone = *filter(style: halftone)',
  '*filter.vignette = *filter(style: vignette)',
  '*filter.tiltshift = *filter(style: tiltshift)',
  '*filter.duotone = *filter(style: duotone, colors: [#1b1464, #ff4fa3])',
  '*filter.gray_at_rest = *filter(style: grayscale, on: rest)',
  '*filter.pixelate = *filter(style: pixelate)',
  '*filter.bright_hue_shift = *filter(brightness: 1.2, hue: 40)',
  // *spotlight
  '*spotlight.dark_veil = *spotlight(where: veil, on: always, smooth: .15)',
  '*spotlight.hover_veil = *spotlight(where: veil, size: 220, soft: 160, on: hover, smooth: .15)',
  '*spotlight.lagging_halo = *spotlight(color: #6ff5d0, fill: .65, size: 320, width: 3, smooth: .15, on: always)',
  '*spotlight.green_torch = *spotlight(where: border, color: #0f0, size: 150)',
  '*spotlight.corner_glow = *spotlight(origin: bottom-left, on: always, color: #b388ff, size: 240, fill: .5, glow: 170)',
  '*spotlight.corner_flash = *spotlight(origin: bottom-left, on: always, every: 2.5s, color: #ffd166, size: 240, fill: .6, glow: 170)',
  // *sprite
  '*sprite.hover_two_frames = *sprite(frames: 2, speed: 200ms, on: hover)',
  '*sprite.spin_on_click = *sprite(frames: 16, columns: 4, speed: 900ms, on: click, repeat: 1)',
  '*sprite.burst_once = *sprite(frames: 12, fps: 16, on: load, repeat: 1)',
  '*sprite.four_directions = *sprite(columns: 3, rows: 4, row: 0, poses: [1,2,1,0], fps: 5, start: 1, animate: true, pixel: true)',
  // *stagger
  '*stagger.masked_lines = *stagger(unit: line, clip: true, opacity: 1, distance: 60, duration: 900ms, step: 130ms, on: view)',
  '*stagger.scroll_lines = *stagger(unit: line, clip: true, opacity: 1, distance: 52, duration: 600ms, step: 200ms, easing: linear, on: scroll)',
  '*stagger.cards_in_row = *stagger(unit: child, duration: 700ms, step: 110ms, distance: 36, on: view)',
  '*stagger.menu_slide = *stagger(unit: child, direction: right, clip: true, opacity: 1, distance: 200, duration: 700ms, step: 110ms, on: view)',
  '*stagger.title_words = *stagger(unit: word, clip: true, opacity: 1, distance: 95, duration: 800ms, step: 140ms, on: view)',
  '*stagger.flip = *stagger(style: flip)',
  '*stagger.blur_words = *stagger(unit: word, style: blur)',
  '*stagger.scroll_words = *stagger(unit: word, style: fade, on: scroll, opacity: .2, zone: 80% 30%)',
  // *sticky
  '*sticky.reappearing_bar = *sticky(offset: 300)',
  '*sticky.hiding_bar = *sticky(hide: true)',
  // *fly
  '*fly.rising_caption = *fly(on: hover, direction: up, distance: 48, duration: 400ms)',
  '*fly.slide_left = *fly(on: hover, direction: left, distance: 30, duration: 250ms)',
  '*fly.spin_in = *fly(on: view, direction: left, distance: 220, rotate: -360, blur: 4, duration: 1100ms)',
  '*fly.light_speed = *fly(direction: left, distance: 120, skew: 30, blur: 6)',
  // *iris
  '*iris.tilted_box = *iris(on: scroll, range: 0 300px, shape: box, start: .2, angle: -11)',
  '*iris.tilted_oval = *iris(on: scroll, range: 0 300px, shape: ellipse, angle: 8)',
  '*iris.from_click = *iris(on: load, origin: pointer, shape: circle, duration: 1400ms, easing: linear)',
  '*iris.box = *iris(shape: box)',
  '*iris.diamond = *iris(shape: diamond)',
  '*iris.cross = *iris(shape: cross)',
  // *blocks
  '*blocks.random_tiles = *blocks(on: view, cols: 16, rows: 9, order: random, seed: 3, duration: 1400ms)',
  '*blocks.stripes = *blocks(on: view, cols: 5, rows: 18, order: rows, duration: 1400ms)',
  '*blocks.from_center = *blocks(on: view, cols: 12, rows: 8, order: center, duration: 1400ms)',
  // *scale
  '*scale.zoom_out = *scale(on: scroll, range: 0 300px, start: 20, origin: 50% 87%)',
  '*scale.stretch_x = *scale(axis: x)',
  // *pixelate
  '*pixelate.three_steps = *pixelate(on: view, steps: 3, duration: 1800ms, easing: linear)',
  '*pixelate.big_pixels = *pixelate(on: view, size: 160, steps: 5, duration: 2000ms, easing: linear)',
  '*pixelate.scroll_mosaic = *pixelate(on: scroll, range: 0 300px, size: 64, steps: 6)',
  // *travel
  '*travel.spin_path = *travel(rotate: 360, arc: 120, zone: 30% 60%)',
  '*travel.flip_card = *travel(spin: 360, arc: 90, zone: 35% 70%)',
  '*travel.reveal = *travel(size: false, fade: true, zone: 35% 70%)',
  // *longshadow
  '*longshadow.lamp = *longshadow(light: true)',
  // *pixels
  '*pixels.explode = *pixels(mode: explode, size: 10, spread: 30, color: #03a9f4)',
  '*pixels.strip = *pixels(mode: strip, color: #e50914)',
  '*pixels.card_burst = *pixels(mode: explode, spread: 100, cover: true, color: #ff5722)',
  '*pixels.mosaic = *pixels(mode: mosaic, on: always)',
  '*pixels.swap = *pixels(mode: swap)',
  // *particles
  '*particles.aura = *particles(mode: aura, color: #e50914, on: hover)',
  '*particles.stars = *particles(mode: stars)',
  '*particles.network = *particles(mode: network)',
  '*particles.meteors = *particles(mode: meteors, direction: down-left)',
  // *border
  '*border.wave = *border(style: wave)',
  '*border.run = *border(style: run)',
  // *ink
  '*ink.brush = *ink(style: brush)',
  '*ink.wash = *ink(style: wash)',
  '*ink.smoke = *ink(style: smoke)',
  '*ink.drip = *ink(style: drip)',
  '*ink.dots = *ink(style: dots)',
  '*ink.shards = *ink(style: shards)',
  '*ink.swirl = *ink(style: swirl)',
  '*ink.tear = *ink(style: tear)',
  '*ink.burn = *ink(style: burn)',
  '*ink.frost = *ink(style: frost)',
  '*ink.rain = *ink(style: rain)',
  '*ink.cells = *ink(style: cells)',
  '*ink.cracks = *ink(style: cracks)',
  '*ink.ripple = *ink(style: ripple)',
  '*ink.scribble = *ink(style: scribble)',
  '*ink.petals = *ink(style: petals)',
  '*ink.glitch = *ink(style: glitch)',
  '*ink.topo = *ink(style: topo)',
  '*ink.maze = *ink(style: maze)',
  // *grid
  '*grid.halo = *grid(style: halo)',
  '*grid.trail = *grid(style: trail)',
  '*grid.needle = *grid(style: needle)',
  '*grid.outline = *grid(light: outline)',
  '*grid.glow = *grid(light: glow)',
  '*grid.rows = *grid(light: rows)',
  '*grid.lines = *grid(style: lines, fade: down)',
  // *magnet
  '*magnet.ring = *magnet(strength: 50, ring: true)',
  // *zoom
  '*zoom.from_pointer = *zoom(origin: pointer)',
  // *goo
  '*goo.merge = *goo(mode: merge, drag: true)',
  // *attention
  '*attention.heartbeat = *attention(style: heartbeat, on: always)',
  '*attention.jello = *attention(style: jello, on: always)',
  '*attention.rubber = *attention(style: rubber, on: always)',
  '*attention.swing = *attention(style: swing, on: always)',
  '*attention.wiggle = *attention(style: wiggle, duration: 500ms, on: hover, every: 1.5s)',
  // *shine
  '*shine.shimmer = *shine(where: text, color: #fff, direction: 100, width: 50, duration: 2.2s, on: always, every: 2.2s)',
  // *annotate
  '*annotate.circle = *annotate(style: circle)',
  '*annotate.box = *annotate(style: box, color: #22d3ee)',
  '*annotate.strike = *annotate(style: strike, color: #f85149)',
  '*annotate.bracket = *annotate(style: bracket, color: #facc15)',
  // *cycle
  '*cycle.flip = *cycle(style: flip)',
  '*cycle.blur = *cycle(style: blur)',
  '*cycle.typewriter = *cycle(style: type, speed: 3s)',
  '*cycle.frame = *cycle(style: frame, speed: 3s)',
  // *wheel
  '*wheel.four_spokes = *wheel(spokes: 4)',
  // *rotate
  '*rotate.quarter_turn = *rotate(angle: -90, start: 0)',
  // *flipcard
  '*flipcard.click_flip = *flipcard(axis: x, on: click)',
  // *scratch
  '*scratch.gold = *scratch(colors: [#fde68a, #b45309], ink: #78350f, brush: 36)',
  // *spoiler
  '*spoiler.blur = *spoiler(style: blur)',
  '*spoiler.bar = *spoiler(style: bar)',
  '*spoiler.pixels = *spoiler(style: pixels)',
  '*spoiler.on_hover = *spoiler(on: hover)',
  // *weight
  '*weight.stretch = *weight(fallback: stretch)',
  // *mesh
  '*mesh.aurora = *mesh(drift: sweep, colors: [#8a2be2, #4682b4], background: transparent, size: 30, opacity: .6, blur: 40)',
  '*mesh.sunset = *mesh(style: sunset)',
  '*mesh.ocean = *mesh(style: ocean)',
  '*mesh.neon = *mesh(style: neon)',
  '*mesh.candy = *mesh(style: candy)',
  '*mesh.forest = *mesh(style: forest)',
  // *chromatic
  '*chromatic.cmy_title = *chromatic(mode: cmy, gap: 6)',
  // *reflect
  '*reflect.water = *reflect(water: true)',
  // *crt
  '*crt.amber = *crt(tint: #ffb000)',
  // *scrollprogress
  '*scrollprogress.glow_gradient = *scrollprogress(colors: [#f97316, #ec4899, #8b5cf6], thickness: 6, glow: 12)',
  '*scrollprogress.side_rail = *scrollprogress(place: right, thickness: 6, track: #30363d)',
  // *path
  '*path.loop = *path(d: loop)',
  '*path.circle = *path(d: circle)',
  '*path.infinity = *path(d: infinity)',
  '*path.zigzag = *path(d: zigzag)',
  '*path.spiral = *path(d: spiral)',
  '*path.heart = *path(d: heart)',
  // *blend
  '*blend.difference = *blend(mode: difference)',
  '*blend.overlay = *blend(mode: overlay)',
  '*blend.screen_gradient = *blend(mode: screen, colors: [#7c3aed, #22d3ee], angle: 135)'
].join('\n')

// les noms des effets de l'appli de la compilation en cours (`fade.lent` y est un alias), lus là où ils sont rangés (effects/catalog.ts)
let declared: () => string[] = () => []

export function setDeclaredAliases(source: () => string[]): void {
  declared = source
}

/** un alias qui existe pour cet effet, à citer en exemple dans un message : le premier de la liste « alias connus » (`*filter.frosted_glass`), qu'il soit
 *  livré par ModularJS ou déclaré par l'appli ; un nom neutre quand l'effet n'en a aucun (`*ripple.my_alias`) */
export function aliasExample(effect: string): string {
  const livres = MJS_ALIASES.split('\n').filter(l => l.startsWith('*' + effect + '.')).map(l => l.slice(1, l.indexOf(' ')))
  const names  = [...new Set([...livres, ...declared().filter(n => n.startsWith(effect + '.'))])].sort()
  return '*' + (names[0] ?? effect + '.my_alias')
}
