// Une faute d'effet dans un composant (`<p *titre>` qui n'existe pas, `*scramble(on: bogus)`, `<input *scramble>`)
// cite la ligne EXACTE de sa balise, juste après le nom de l'effet : `*titre (ligne 6) : effet inconnu`. Le générateur
// la lit sur la balise elle-même et la porte sur l'erreur ; le bundler l'écrit dans le message. La recherche de `*nom`
// dans le texte du fichier n'est plus qu'un repli, pour les fautes que le générateur ne situe pas (une transition
// `@in=*nom`). La ligne du générateur est celle du HTML recollé : un partiel inclus ou une macro de balise (`<@head>`,
// `<@window>`) qui précède la décale. Le bundler la garde donc seulement quand c'est la ligne d'une balise du fichier
// qui écrit cet effet ; sinon il revient à la recherche dans le texte, jamais une ligne devinée. Un appel direct à
// `transpile()` garde le message tel quel : la faute porte seulement la ligne (`cause.mjsLine`).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('effet-ligne-noeud')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, '_bas.mjs'), '<p>a</p>\n<p>b</p>\n<p>c</p>\n')
writeFileSync(join(dir, '_effet.mjs'), '<p>a</p>\n<p *titre>b</p>\n')

// la faute telle que le bundler la rend (transpileFromMsg : le générateur, puis la ligne écrite dans le message)
async function faute(src: string): Promise<string> {
  try {
    await transpileFromMsg({ type: 'transpile', id: 1, content: src, moduleName: 'carte', baseDir: dir, preResolvedAssets: {} } as any)
  } catch (e: any) {
    return String(e.message)
  }
  throw new Error('la compilation devait échouer')
}

const lignes = (m: string): string[] => m.match(/\((?:ligne|lignes) [\d, ]+\)/g) ?? []

describe('une faute d\'effet cite la ligne de sa balise', function () {
  this.timeout(60000)

  it('effet inconnu : la ligne de la balise, juste après le nom de l\'effet', async () => {
    const m = await faute('<script>\n$a = 1\n</script>\n\n<p class="x">ok</p>\n<p *titre>ABC</p>\n')
    assert.match(m, /\[ModularJS\] \*titre \(ligne 6\) : effet inconnu/)
    assert.deepEqual(lignes(m), ['(ligne 6)'])
  })

  it('le même effet écrit deux fois : la ligne de celui qui est fautif, pas les deux', async () => {
    const m = await faute('<p *scramble(on: click)>a</p>\n<p>b</p>\n<p *scramble(on: bogus)>c</p>\n')
    assert.match(m, /\*scramble \(ligne 3\) : on = bogus/)
    assert.deepEqual(lignes(m), ['(ligne 3)'])
    const premiere = await faute('<p *scramble(on: bogus)>a</p>\n<p>b</p>\n<p *scramble(on: click)>c</p>\n')
    assert.match(premiere, /\*scramble \(ligne 1\) : on = bogus/)
    assert.deepEqual(lignes(premiere), ['(ligne 1)'])
  })

  it('une balise sur plusieurs lignes : la ligne où elle s\'ouvre', async () => {
    const m = await faute('<p>un</p>\n<input aria-label="x"\n  class="y"\n  *titre>\n')
    assert.match(m, /\*titre \(ligne 2\) : effet inconnu/)
    assert.deepEqual(lignes(m), ['(ligne 2)'])
  })

  it('un réglage faux, et un effet donné en réglage d\'un autre : la ligne de la balise qui les écrit', async () => {
    assert.match(await faute('<div>\n<p *scramble(on: bogus)>ABC</p>\n</div>\n'), /\*scramble \(ligne 2\) : on = bogus/)
    assert.match(await faute('<div>\n\n<p *delta(fx: *zzz)>1</p>\n</div>\n'), /\*zzz \(ligne 3\) : effet inconnu/)
    assert.match(await faute('<p>\n<b *fade(duree: 3)>x</b>\n</p>\n'), /\*fade \(ligne 2\) : réglage « duree » inconnu/)
  })

  it('un effet mal placé : la ligne vient avant le reste de la phrase, sans « : » pour la chercher dans le texte', async () => {
    assert.match(await faute('<p>un</p>\n<input aria-label="x" *scramble>\n'), /\*scramble \(ligne 2\) travaille le texte de sa balise/)
    assert.match(await faute('<p>un</p>\n<p>deux</p>\n<img alt="a" src="/a.png" *shine>\n'), /\*shine \(ligne 3\) dessine à l'intérieur de sa balise/)
    assert.match(await faute('<p>un</p>\n<div *guard>x</div>\n'), /\*guard \(ligne 2\) se pose sur un champ/)
  })

  it('un effet en direct sans connexion (@sock absent) : la ligne de sa balise', async () => {
    assert.match(await faute('<script>\n$a = 1\n</script>\n<p>un</p>\n<div *cursors>x</div>\n'), /\*cursors \(ligne 5\) prend sa connexion dans @sock/)
  })

  it('dans un {for} et dans un {if} : la ligne de la balise', async () => {
    const m = await faute('<script>\n$l = [1, 2]\n$a = true\n</script>\n{for i in $l}\n  <p>{i}</p>\n  {if $a}\n    <b *titre>x</b>\n  {end}\n{end}\n')
    assert.match(m, /\*titre \(ligne 8\) : effet inconnu/)
  })

  it('le message complet garde son contenu : les effets disponibles et la suggestion', async () => {
    const m = await faute('<p *fdae>x</p>\n')
    assert.match(m, /\*fdae \(ligne 1\) : effet inconnu — effets disponibles : \*annotate/)
    assert.match(m, /Vouliez-vous dire \*fade \?/)
  })

  it('repli : une transition fautive que le générateur ne situe pas prend les lignes du texte', async () => {
    const m = await faute('<p @in=*fdae>a</p>\n<p>b</p>\n<p @in=*fdae>c</p>\n')
    assert.match(m, /\*fdae \(lignes 1, 3\) : effet inconnu/)
  })
})

describe('la ligne du générateur est contrôlée contre le fichier', function () {
  this.timeout(60000)

  it('un <@head> avant la balise décale les lignes du HTML recollé : la ligne citée est celle du fichier', async () => {
    const m = await faute('<@head>\n<title>x</title>\n<meta name="a" content="b">\n</@head>\n<p>x</p>\n<p *titre>y</p>\n')
    assert.match(m, /\*titre \(ligne 6\) : effet inconnu/)
    assert.deepEqual(lignes(m), ['(ligne 6)'])
  })

  it('un partiel inclus avant la balise : la ligne du HTML recollé n\'est pas celle du fichier, aucune n\'est citée', async () => {
    const m = await faute('<p>x</p>\n<@include bas>\n<p *titre>y</p>\n')
    assert.match(m, /\*titre : effet inconnu/)
    assert.deepEqual(lignes(m), [])
  })

  it('un partiel inclus APRÈS la balise : les lignes d\'avant ne bougent pas, la ligne est citée', async () => {
    const m = await faute('<p *titre>y</p>\n<@include bas>\n')
    assert.match(m, /\*titre \(ligne 1\) : effet inconnu/)
    assert.deepEqual(lignes(m), ['(ligne 1)'])
  })

  it('un effet qui vient d\'un partiel : aucune ligne, jamais celle du HTML recollé', async () => {
    const m = await faute('<p>x</p>\n<@include effet>\n')
    assert.match(m, /\*titre : effet inconnu/)
    assert.deepEqual(lignes(m), [])
  })

  it('le même effet écrit dans le fichier et dans un partiel : on ne sait pas laquelle est fautive, aucune ligne', async () => {
    const m = await faute('<@include effet>\n<p>x</p>\n<p *titre>y</p>\n')
    assert.match(m, /\*titre : effet inconnu/)
    assert.deepEqual(lignes(m), [])
  })
})

describe('un appel direct à transpile() : le message ne change pas, la faute porte la ligne', function () {
  this.timeout(60000)

  it('le message garde sa forme ; cause.mjsLine est la ligne de la balise', async () => {
    let erreur: any
    try {
      await transpile('<script>\n$a = 1\n</script>\n\n<p class="x">ok</p>\n<p *titre>ABC</p>\n', { moduleName: 'carte' } as any)
    } catch (e) {
      erreur = e
    }
    assert.ok(erreur, 'la compilation devait échouer')
    assert.match(erreur.message, /\[ModularJS\] \*titre : effet inconnu/)
    assert.equal(erreur.cause?.mjsLine, 6)
  })
})
