// une expression du gabarit que Civet rend en plusieurs instructions se construit, et l'écran la suit : comparaison chaînée
// (`0 < $x < 5` : Civet déclare `let ref;` devant l'expression), `|>=` sur un chemin, compréhension écrite seule entre
// parenthèses (`(e for e of $l)` : sa boucle devant le résultat). Avant, ces instructions étaient posées telles quelles à
// une place d'expression, la construction s'arrêtait sur « The keyword 'let' is reserved » ou « Unexpected token ».
// Composant bâti, monté dans happy-dom, valeur changée au clic, écran relu ; rendu serveur ; expression avec `await`
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { cleanJsExpr } from '../src/generator/utils.js'
import { monterHote, pause } from './helpers/coeur-monter.js'
import { mjsTmp } from './helpers/tmp.js'

// forme, état du script, gabarit lu, écriture au clic, écran avant, écran après (texte du <p>, ou son title : `false` retire
// l'attribut, comme `$x > 0 and $x < 5`, lu `null`)
const SCENES: [string, string, string, string, string, string][] = [
  ['comparaison chaînée dans un texte', '$x = 3', '<p>{0 < $x < 5}</p>', '$x = 9', 'true', 'false'],
  ['comparaison chaînée dans un attribut', '$x = 3', '<p title={0 < $x < 5}>t</p>', '$x = 9', 'true', 'null'],
  ['comparaison chaînée dans un {if}', '$x = 3', '<p>{if 0 < $x < 5}oui{else}non{end}</p>', '$x = 9', 'oui', 'non'],
  ['comparaison chaînée dans la tête d\'un {for}', '$l = [{prix: 3}, {prix: 50}]\n$max = 1', '<p>[{for v in $l.filter(&.prix < $max < 100)}{v.prix};{end}]</p>', '$max = 5', '[]', '[3;]'],
  ['comparaison chaînée dans un if … then', '$x = 1\n$y = \'dedans\'\n$z = \'dehors\'', '<p>{(if 0 < $x < 10 then $y else $z)}</p>', '$x = 20', 'dedans', 'dehors'],
  ['comparaison chaînée dans une liste filtrée', '$l = [{prix: 3}]\n$max = 1', '<p>{$l.filter(&.prix < $max < 100).length}</p>', '$max = 5', '0', '1'],
  ['comparaison chaînée dans une compréhension suivie d\'un appel', '$l = [5, 6, 7]\n$max = 2', '<p>{(e for e in $l when 0 < e < $max).join(\'-\')}</p>', '$max = 3', '1', '1-2'],
  ['comparaison chaînée dans une chaîne interpolée', '$n = 1', '<p>{"#{$n} résultat#{if 1 < $n < 9 then \'s\' else \'\'}"}</p>', '$n = 3', '1 résultat', '3 résultats'],
  ['comparaison chaînée dans un objet', '$x = 1\n$y = 2', '<p>{({dedans: 0 < $x < 10, $y}).dedans}</p>', '$x = 20', 'true', 'false'],
  ['|>= sur un chemin', '$x = {y: 1}\nf = (q) -> q', '<p>{$x.y |>= f}</p>', '$x = {y: 7}', '1', '7'],
  ['|>= avec une fonction de l\'état', '$x = {y: {z: 1}}\n$g = (q) -> q', '<p>{$x.y.z |>= $g}</p>', '$x = {y: {z: 7}}', '1', '7'],
  ['|>= sur un accès calculé', '$x = {n: 1}\n$k = \'n\'\nf = (q) -> q', '<p>{$x[$k] |>= f}</p>', '$x = {n: 7}', '1', '7'],
  ['for … of sur une variable de l\'état', '$x = 0\n$l = [1, 2]', '<p>{($x for $x of $l)}</p>', '$l = [3]', '1,2', '3'],
  ['for … of dans une expression', '$l = [1, 2]\n$k = 1', '<p>{(e * $k for e of $l)}</p>', '$k = 10', '1,2', '10,20'],
  ['chaîne sur deux lignes et comparaison chaînée', '$x = \'a\'\n$y = 1', '<p>{"ligne 1\n  ligne 2 #{$x}" + (0 < $y < 5)}</p>', '$y = 9', 'true', 'false'],
  ['objet sur plusieurs lignes', '$x = 1\n$y = 1', '<p>{({\n  x: $x\n  y: 0 < $y < 5\n}).y}</p>', '$y = 9', 'true', 'false'],
  ['comparaison chaînée dans un gestionnaire', '$x = 3\n$r = \'rien\'', '<p>{$r}</p>', '$r = 0 < $x < 5', 'rien', 'true']
]

const racine = (hote: any): any => hote._shadow ?? hote.shadowRoot ?? hote
const ecran  = (hote: any, gabarit: string): string => {
  const p = racine(hote).querySelector('p')
  return / title=/.test(gabarit) ? String(p?.getAttribute('title')) : String(p?.textContent ?? '').trim()
}

describe('une expression que Civet rend en plusieurs instructions se construit, l\'écran la suit', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  SCENES.forEach(([forme, script, gabarit, ecriture, avant, apres], i) => {
    it(`${forme} : ${gabarit.replace(/\n/g, '⏎')}`, async () => {
      const source = `<script>\n${script}\n</script>\n${gabarit}\n<button @click={${ecriture}}>+</button>\n`
      const { hote, erreurs } = await monterHote(source, `plusieurs-instructions-${i}`)
      assert.ok(ecran(hote, gabarit).includes(avant), `avant le clic : « ${ecran(hote, gabarit)} »`)
      racine(hote).querySelector('button').click()
      await pause(60)
      assert.ok(ecran(hote, gabarit).includes(apres), `après le clic : « ${ecran(hote, gabarit)} »`)
      assert.equal(erreurs.length, 0, String(erreurs))
    })
  })

  it('rendu serveur : texte, attribut et {if} rendus', async () => {
    const root   = mjsTmp('plusieurs-instructions-serveur')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), '<script>\n$x = 3\n</script>\n<p>{0 < $x < 5}</p>\n<p title={0 < $x < 5}>t</p>\n<p>{if 0 < $x < 5}oui{else}non{end}</p>\n')
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'out') } as any)
    try {
      const html = (await renderer.renderToString('mjs-hote', {} as any)).html.replace(/<!--[\s\S]*?-->/g, '')
      assert.match(html, /<p[^>]*>true<\/p>/)
      assert.match(html, /<p[^>]* title="true"[^>]*>t<\/p>/)
      assert.match(html, /<p[^>]*>oui<\/p>/)
    }
    finally { await renderer.close() }
  })

  it('expression avec await : la fonction appelée sur place est async, attendue à la place de l\'expression', async () => {
    const js     = cleanJsExpr('0 < (await $p) < 5', [], 'hote')
    const valeur = (p: unknown) => new Function('$', `return (async () => ${js})()`)({ p: Promise.resolve(p) })
    assert.match(js, /^\(await \(async \(\) => \{/)
    assert.equal(await valeur(3), true)
    assert.equal(await valeur(9), false)
  })
})
