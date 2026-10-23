// Effets — syntaxe `*nom(réglages)` sur une balise : lue par l'analyseur, vérifiée à la
// compilation (effet connu, réglage connu, valeur permise), compilée en un appel au moteur
// d'effets avec ses réglages déjà convertis. Le premier réglage peut s'écrire sans son nom.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output
const appels   = (js: string) => [...js.matchAll(/µ\._mjs_fx\(this, _mjs_fxn, "([a-z-]+)", (\{[^}]*\})\)/g)].map(m => [m[1], JSON.parse(m[2])])

describe('effets — syntaxe *nom(réglages)', () => {
  it('un effet sans réglage : *glitch', async () => {
    assert.deepEqual(appels(await compiler('<h1 *glitch>MJS</h1>')), [['glitch', {}]])
  })

  it('réglages nommés, valeurs converties selon leur règle', async () => {
    const js = await compiler('<button *neon(color: #f0f, flicker: true, size: 2)>Jouer</button>')
    assert.deepEqual(appels(js), [['neon', { color: '#f0f', flicker: true, size: 2 }]])
  })

  it('le premier réglage peut s\'écrire sans son nom (le réglage principal de l\'effet)', async () => {
    assert.deepEqual(appels(await compiler('<p *neon(#0ff)>x</p>')), [['neon', { color: '#0ff' }]])
    assert.deepEqual(appels(await compiler('<section *scale(.5, delay: 200ms)>x</section>')), [['scale', { start: 0.5, delay: '200ms' }]])
    assert.deepEqual(appels(await compiler('<div *tilt(20)>x</div>')), [['tilt', { max: 20 }]])
  })

  it('une valeur entre guillemets, ou avec des parenthèses et des virgules, reste une seule valeur', async () => {
    assert.deepEqual(appels(await compiler('<p *neon(rgb(0, 255, 255))>x</p>')), [['neon', { color: 'rgb(0, 255, 255)' }]])
    assert.deepEqual(appels(await compiler("<p *neon('hsl(180 100% 50%)')>x</p>")), [['neon', { color: 'hsl(180 100% 50%)' }]])
  })

  it('plusieurs effets sur la même balise, et sur un composant', async () => {
    assert.deepEqual(appels(await compiler('<h1 *glitch *neon(#f0f)>MJS</h1>')), [['glitch', {}], ['neon', { color: '#f0f' }]])
    assert.deepEqual(appels(await compiler('<@card *tilt(10)></@card>')), [['tilt', { max: 10 }]])
  })

  it('un effet dans un {for} et dans un {if}', async () => {
    const js = await compiler('<script>\n$items = [1, 2]\n$ok = true\n</script>\n{for i in $items}<li *ripple>{i}</li>{end}\n{if $ok}<p *reveal>x</p>{end}')
    // le {for} a deux chemins (création d'une ligne, mise à jour) : l'appel y figure deux fois
    assert.deepEqual([...new Set(appels(js).map(a => a[0]))].sort(), ['reveal', 'ripple'])
  })

  it('la balise compilée ne garde pas l\'attribut *nom', async () => {
    const js = await compiler('<h1 *glitch>MJS</h1>')
    assert.doesNotMatch(js, /\*glitch/)
  })
})

describe('effets — une variable comme valeur : *neon($couleur)', () => {
  it('la variable est lue à la pose puis suivie ; sa règle part avec elle', async () => {
    const js = await compiler('<script>\n$c = "#f0f"\n$n = 1\n</script>\n<h1 *neon($c, size: $n, flicker: true)>x</h1>')
    assert.match(js, /µ\._mjs_fx\(this, _mjs_fxn, "neon", \{"flicker":true\}, \{"color": \(\$\.c\), "size": \(\$\.n\)\}, \{"color":\["c",[^\]]*\],"size":\["f",0\.2,5,"float 0\.2\.\.5"\]\}\)/)
    assert.match(js, /µ\._mjs_fxSet\(_mjs_fxn, "neon", \{"color": \(\$\.c\), "size": \(\$\.n\)\}, \{/)
  })

  it('un store, le champ d\'un objet, une variable dans une boucle', async () => {
    const js = await compiler('<script>\n$reglages = { max: 10 }\n$items = [1, 2]\n</script>\n<p *neon($$accent)>a</p>\n<div *tilt($reglages.max)>b</div>\n{for i in $items by i}<li *ripple($$accent)>{i}</li>{end}')
    assert.equal((js.match(/µ\._mjs_fxSet\(_mjs_fxn, "neon"/g) || []).length > 0, true)
    assert.match(js, /µ\._mjs_fxSet\(_mjs_fxn, "tilt", \{"max": \([^)]*reglages[^)]*\.max\)\}/)
    assert.match(js, /µ\._mjs_fxSet\(_mjs_fxn, "ripple"/)
  })

  it('un réglage « qui dessine dedans » tenu par une variable compte comme allumé pour le contrôle de la balise', async () => {
    await assert.rejects(compiler('<script>\n$g = true\n</script>\n<img *tilt(glare: $g) src="a.png" alt="a">'), /\*tilt\(glare: true\) dessine à l'intérieur/)
  })
})

describe('effets — les fautes arrêtent la compilation, avec un message clair', () => {
  it('effet inconnu, avec une suggestion', async () => {
    await assert.rejects(compiler('<p *neom>x</p>'), /\*neom : effet inconnu[\s\S]*\*neon/)
  })

  it('*drop ne fait plus partie de la bibliothèque : effet inconnu, absent de la liste', async () => {
    await assert.rejects(compiler('<div *drop>x</div>'), (e: Error) => /\*drop : effet inconnu/.test(e.message) && !/\*drop,/.test(e.message.split('disponibles')[1]))
  })

  it('réglage inconnu : la liste des réglages de l\'effet', async () => {
    await assert.rejects(compiler('<p *neon(colour: red)>x</p>'), /\*neon : réglage « colour » inconnu[\s\S]*color[\s\S]*flicker/)
  })

  it('valeur hors de sa règle : la règle est citée', async () => {
    await assert.rejects(compiler('<div *tilt(99)>x</div>'), /\*tilt : max = 99 — permis : float 0\.\.45/)
    await assert.rejects(compiler('<p *reveal(slide)>x</p>'), /\*reveal : direction = slide — permis : 'right' \| 'left' \| 'up' \| 'down'/)
    await assert.rejects(compiler('<p *neon(flicker: oui)>x</p>'), /\*neon : flicker = oui — permis : bool/)
    await assert.rejects(compiler('<p *reveal(delay: 2 secondes)>x</p>'), /\*reveal : delay = 2 secondes/)
  })

  it('deux valeurs sans nom : une seule est permise', async () => {
    await assert.rejects(compiler('<p *neon(#f0f, #0ff)>x</p>'), /\*neon : une seule valeur sans nom/)
  })

  it('un réglage écrit deux fois', async () => {
    await assert.rejects(compiler('<p *neon(#f0f, color: #0ff)>x</p>'), /\*neon : « color » est écrit deux fois/)
  })

  it('des accolades entre les parenthèses : refusées, le message donne la variable telle quelle', async () => {
    await assert.rejects(compiler('<script>\n$c = "#f0f"\n</script>\n<p *neon(color: {$c})>x</p>'), /\*neon : color — pas d'accolades entre les parenthèses : écrivez la valeur, ou la variable telle quelle \(\*neon\(color: \$x\)\)/)
  })

  it('un calcul est refusé : une variable s\'écrit seule', async () => {
    await assert.rejects(compiler('<script>\n$n = 1\n</script>\n<p *neon(size: $n + 1)>x</p>'), /\*neon : size = \$n \+ 1 — une variable s'écrit seule/)
  })

  it('un nom d\'effet en majuscules est un effet inconnu, jamais un attribut', async () => {
    await assert.rejects(compiler('<p *Neon>x</p>'), /\*Neon : effet inconnu[\s\S]*\*neon/)
  })

  it('*neon=… : les réglages s\'écrivent entre parenthèses', async () => {
    await assert.rejects(compiler('<p *neon="#f0f">x</p>'), /\*neon=… \(ligne 1\) : les réglages d'un effet s'écrivent entre parenthèses/)
    await assert.rejects(compiler('<p *neon(#f0f)={$x}>x</p>'), /\*neon=…/)
  })

  it('une parenthèse jamais refermée', async () => {
    await assert.rejects(compiler('<p *neon(#f0f>x</p>'), /\(/)
  })

  it('le même effet deux fois sur une balise', async () => {
    await assert.rejects(compiler('<p *neon *neon>x</p>'), /\*neon/)
  })
})

describe('effets — balises qui peuvent porter un effet', () => {
  const macro = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).data.macroErrors.join('\n')

  it('HTML, composant, module cœur, <svg> lui-même : acceptés', async () => {
    for (const src of ['<p *neon>x</p>', '<@card *tilt(10)>x</@card>', '<@@select *reveal></@@select>', '<svg *tilt><circle r="3"/></svg>', '<img *neon src="a.png" alt="a">']) {
      assert.equal(appels(await compiler(src)).length, 1, src)
    }
  })

  it('<slot> et <template> n\'affichent rien eux-mêmes : refusés', async () => {
    await assert.rejects(compiler('<@slot *neon></@slot>'), /\*neon ne se pose pas sur <slot>/)
    await assert.rejects(compiler('<slot *neon></slot>'), /\*neon ne se pose pas sur <slot>/)
    await assert.rejects(compiler('<template *reveal><p>x</p></template>'), /\*reveal ne se pose pas sur <template>/)
  })

  it('à l\'intérieur d\'un <svg> : refusé', async () => {
    await assert.rejects(compiler('<svg><circle *neon r="3"/></svg>'), /\*neon sur <circle> : dans un <svg>/)
    await assert.rejects(compiler('<svg>{for i in [1, 2] by i}<circle *neon r="3"/>{end}</svg>'), /\*neon sur <circle> : dans un <svg>/)
    await assert.rejects(compiler('<svg>{if 1}<g *neon></g>{end}</svg>'), /\*neon sur <g> : dans un <svg>/)
    assert.equal(appels(await compiler('<svg><foreignObject><p *neon>x</p></foreignObject></svg>')).length, 1, 'du HTML dans <foreignObject> : permis')
  })

  it('un effet qui dessine dans sa balise, sur une balise sans contenu affiché : refusé', async () => {
    await assert.rejects(compiler('<input *ripple>'), /\*ripple dessine à l'intérieur de sa balise, et <input> n'affiche pas de contenu/)
    await assert.rejects(compiler('<img *tilt(glare: true) src="a.png" alt="a">'), /\*tilt\(glare: true\) dessine à l'intérieur/)
    assert.equal(appels(await compiler('<img *tilt(12) src="a.png" alt="a">')).length, 1, 'sans le reflet, l\'inclinaison passe')
    assert.equal(appels(await compiler('<img *glitch src="a.png" alt="a">')).length, 1, 'le glitch secoue l\'image elle-même')
  })

  it('un effet qui travaille le texte de sa balise : refusé sur une image, un champ, un composant', async () => {
    await assert.rejects(compiler('<@card *bounce>x</@card>'), /\*bounce travaille le texte de sa balise, et <@card> n'a pas de texte à elle/)
    await assert.rejects(compiler('<img *count src="a.png" alt="a">'), /\*count travaille le texte de sa balise, et <img>/)
    await assert.rejects(compiler('<@@select *rainbow></@@select>'), /<@@select> n'a pas de texte à elle/)
    for (const src of ['<p *bounce>Hop</p>', '<h1 *rainbow *bounce>Arc</h1>', '<span *count(3s)>12480</span>', '<div *marquee(8s, pause: true)>Défile</div>']) {
      assert.ok(appels(await compiler(src)).length >= 1, src)
    }
  })

  it('sur un composant, tous les effets passent (le moteur dessine dans le composant)', async () => {
    for (const src of ['<@card *ripple>x</@card>', '<@@select *glitch></@@select>', '<@view *ripple></@view>', '<@card *tilt(glare: true)></@card>', '<@view *reveal></@view>', '<@card *shine></@card>', '<@card *particles(stars)></@card>', '<@card *confetti></@card>']) {
      assert.equal(appels(await compiler(src)).length, 1, src)
    }
  })

  it('<@window>, <@document> (hors effets de souris), <@body>, <@html>, <@head>, <@element>, <@module>, <@failed> : refusés, jamais ignorés', async () => {
    const formes: Array<[string, string]> = [
      ['<@window *neon></@window>', 'window'],
      ['<@document *neon @click={x()}></@document>', 'document'],
      ['<@body *reveal></@body>', 'body'],
      ['<@html *neon></@html>', 'html'],
      ['<@head *neon><title>x</title></@head>', 'head'],
      ['<script>\n$tag = "p"\n</script>\n<@element $tag *neon>x</@element>', 'element'],
      ['<script>\n$c = "mjs-x"\n</script>\n<@module $c *tilt>x</@module>', 'module'],
      ['<@failed *neon><p>x</p></@failed>', 'failed'],
    ]
    for (const [src, balise] of formes) {
      let texte = ''
      try { texte = await macro(src) } catch (e: any) { texte = String(e?.message ?? e) }
      assert.match(texte, new RegExp(`\\*[a-z]+ ne se pose pas sur <@${balise}>`), src)
    }
  })

  it('une étoile dans une expression ou un texte n\'est pas un effet', async () => {
    assert.equal(await macro('<@window @click={f(\'x *neon\')}></@window>'), '')
    assert.equal(await macro('<@document title="a *neon"></@document>'), '')
  })
})
