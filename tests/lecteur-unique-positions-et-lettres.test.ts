// Le lecteur unique (src/reader) donne à chaque nœud sa position exacte dans le fichier (`fichier:ligne:colonne`) :
// le gabarit par ses propres indices, le code par la carte de Civet ramenée au fichier (les raccourcis de MJS sont
// déguisés à longueur égale, si bien qu'un indice du texte déguisé est l'indice du fichier). Les lettres du
// déguisement sont réservées : une source qui en contient une est refusée, avec sa position et la correction.
// L'échantillon des positions est pris sur les modules du cœur : chaque chaîne, regex, commentaire et nom de code
// lu doit tomber, dans le fichier, sur le caractère qui l'ouvre.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import { transformSync } from 'esbuild'
import { lireFichier, positionDe, formaterPosition, deguiser, rendre, LETTRES_RESERVEES } from '../src/reader/index.js'

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..')
const COEUR = join(ROOT, 'src', 'core-modules')
const S     = (lignes: string[]): string => lignes.join('\n') + '\n'

describe('lecteur unique : positions', function () {
  this.timeout(120000)

  it('ligne et colonne d\'un indice (colonne comptée à partir de 1, en unités UTF-16), fins de ligne CRLF et BOM retirés', () => {
    const f = lireFichier('﻿<p>a</p>\r\n<script>\r\n  $n = 1\r\n</script>\r\n', { fichier: 'src/pos.mjs' })
    assert.equal(f.source, '<p>a</p>\n<script>\n  $n = 1\n</script>\n')
    assert.deepEqual(positionDe(f, 0), { ligne: 1, colonne: 1 })
    assert.deepEqual(positionDe(f, f.source.indexOf('$n')), { ligne: 3, colonne: 3 })
    assert.equal(formaterPosition(f, f.source.indexOf('</script>')), 'src/pos.mjs:4:1')
    assert.deepEqual(positionDe(f, f.source.length), { ligne: 5, colonne: 1 })
    const n = f.codes[0].noms.find((x) => x.nom === '$n')
    assert.equal(formaterPosition(f, n.debut), 'src/pos.mjs:3:3')
  })

  it('les nœuds du gabarit couvrent exactement leur texte', () => {
    const src = S(['<ul class="liste">', '  {for x in $items}<li @click={ µemit \'choisi\', x }>{x.nom}</li>{end}', '</ul>', '<script>', '$items = []', '</script>'])
    const f = lireFichier(src, { fichier: 'gabarit.mjs' })
    assert.deepEqual(f.diagnostics, [])
    const ul = f.enfants.find((n) => n.sorte === 'balise')
    assert.equal(src.slice(ul.debut, ul.fin), src.slice(0, src.indexOf('</ul>') + 5))
    const script = f.enfants.find((n) => n.sorte === 'script')
    assert.equal(src.slice(script.debut, script.fin), '<script>\n$items = []\n</script>')
    const choisi = f.codes.flatMap((c) => c.textes).find((t) => t.valeur === 'choisi')
    assert.equal(choisi.debut, src.indexOf('\'choisi\''))
  })

  it('échantillon des modules du cœur : chaque chaîne, regex, commentaire et nom lu tombe sur son texte dans le fichier', () => {
    const fichiers = readdirSync(COEUR).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort()
    assert.ok(fichiers.length >= 20, 'modules du cœur trouvés')
    const fausses: string[] = []
    const compte = { chaine: 0, regex: 0, commentaire: 0, nom: 0, sansPosition: 0 }
    for (const nom of fichiers) {
      const f = lireFichier(readFileSync(join(COEUR, nom), 'utf-8'), { fichier: nom })
      assert.deepEqual(f.diagnostics.map((d) => d.position + ' ' + d.message), [], nom + ' lu sans faute')
      for (const c of f.codes) {
        for (const t of c.textes) {
          if (t.sorte === 'gabarit') continue
          if (t.debut === null) { compte.sansPosition++; continue }
          compte[t.sorte]++
          const ouvre = t.sorte === 'chaine' ? '\'"' : t.sorte === 'regex' ? '/' : '#/'
          if (!ouvre.includes(f.source[t.debut])) fausses.push(`${formaterPosition(f, t.debut)} ${t.sorte} ${JSON.stringify(t.valeur.slice(0, 30))} lu ${JSON.stringify(f.source.slice(t.debut, t.debut + 12))}`)
        }
        for (const n of c.noms) {
          if (n.debut === null) { compte.sansPosition++; continue }
          compte.nom++
          if (!f.source.startsWith(n.nom, n.debut)) fausses.push(`${formaterPosition(f, n.debut)} nom ${n.nom} lu ${JSON.stringify(f.source.slice(n.debut, n.debut + 12))}`)
        }
      }
    }
    assert.deepEqual(fausses, [])
    assert.equal(compte.sansPosition, 0, 'chaque texte et chaque nom a sa position')
    assert.ok(compte.chaine > 500 && compte.commentaire > 50 && compte.regex > 10 && compte.nom > 500, JSON.stringify(compte))
  })

  it('erreur de Civet dans un script : rapportée à sa ligne et sa colonne du fichier', () => {
    const src = S(['<p>{$a}</p>', '<script>', '  $a = 1', '  $b = 2 + * 3', '</script>'])
    const f = lireFichier(src, { fichier: 'src/casse.mjs' })
    assert.equal(f.diagnostics.length, 1, JSON.stringify(f.diagnostics))
    assert.equal(f.diagnostics[0].position, 'src/casse.mjs:4:12')
    assert.equal(src[f.diagnostics[0].debut], '*')
  })

  it('erreur de Civet dans une expression du gabarit : rapportée à sa place sur la ligne', () => {
    const src = S(['<div>', '  <p>{ $a + * 2 }</p>', '</div>', '<script>', '$a = 1', '</script>'])
    const f = lireFichier(src, { fichier: 'expr.mjs' })
    assert.equal(f.diagnostics.length, 1, JSON.stringify(f.diagnostics))
    assert.equal(src[f.diagnostics[0].debut], '*')
    assert.equal(f.diagnostics[0].ligne, 2)
  })

  it('erreur d\'acorn sur le JavaScript produit par Civet : ramenée au fichier par la carte', () => {
    const src = S(['<script>', '  $o = {}', '  $o.a =: 2', '</script>'])
    const f = lireFichier(src, { fichier: 'membre.mjs' })
    assert.equal(f.diagnostics.length, 1, JSON.stringify(f.diagnostics))
    assert.equal(f.diagnostics[0].ligne, 3)
    assert.ok(f.diagnostics[0].colonne >= 3 && f.diagnostics[0].colonne <= 11, f.diagnostics[0].position)
  })

  it('accolade ou section non refermée : la faute est à l\'ouvrante', () => {
    const a = lireFichier(S(['<p>', '  {$a', '</p>']), { fichier: 'a.mjs' })
    assert.deepEqual(a.diagnostics.map((d) => d.position), ['a.mjs:2:3'])
    const b = lireFichier(S(['<p>x</p>', '<script>', '$a = 1']), { fichier: 'b.mjs' })
    assert.deepEqual(b.diagnostics.map((d) => d.position), ['b.mjs:2:1'])
  })
})

describe('lecteur unique : lettres du déguisement', function () {
  this.timeout(60000)

  const lettres = Object.entries(LETTRES_RESERVEES)

  it('cinq lettres distinctes du bloc latin étendu D, une unité UTF-16 chacune, lettres de nom pour JavaScript', () => {
    assert.deepEqual(lettres.map(([ecrit]) => ecrit), ['§', '@@', '#', '&', '@import'])
    assert.equal(new Set(lettres.map(([, l]) => l)).size, 5)
    for (const [ecrit, l] of lettres) {
      const cp = l.codePointAt(0)
      assert.ok(l.length === 1 && cp >= 0xA720 && cp <= 0xA7FF, ecrit + ' → U+' + cp.toString(16))
      assert.ok(/^\p{ID_Start}$/u.test(l), ecrit + ' : lettre de début de nom')
    }
  })

  it('acorn, Civet et esbuild lisent chaque lettre dans un nom, au début comme au milieu', () => {
    const civet = createRequire(import.meta.url)('@danielx/civet')
    for (const [ecrit, l] of lettres) {
      const js = `const ${l}a = 1\nexport function f(${l}${l}b) { return ${l}${l}b + ${l}a }\nclass C { ${l}champ = 2 }\nexport { C }\n`
      assert.doesNotThrow(() => acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' }), ecrit + ' : acorn')
      const cv = civet.compile(`"civet coffeeComment coffeeInterpolation"\n${l}a := 1\nf := (${l}${l}b) -> ${l}${l}b + ${l}a\n${l}import 'x' # note\n`, { js: true, sync: true })
      assert.ok(cv.includes(`${l}import(`) && cv.includes(`${l}${l}b`), ecrit + ' : Civet ' + cv)
      for (const charset of ['ascii', 'utf8'] as const) {
        const out = transformSync(js, { format: 'esm', minify: true, charset }).code
        assert.doesNotThrow(() => acorn.parse(out, { ecmaVersion: 'latest', sourceType: 'module' }), ecrit + ' : esbuild ' + charset)
      }
    }
  })

  it('une source qui contient déjà une lettre du déguisement est refusée, à sa position, avec la correction', () => {
    for (const [ecrit, l] of lettres) {
      const f = lireFichier(S(['<p>{$a}</p>', '<script>', `  $a = '${l}'`, '</script>']), { fichier: 'src/lettre.mjs' })
      const d = f.diagnostics.filter((x) => x.message.includes(l))
      assert.equal(d.length, 1, ecrit + ' : ' + JSON.stringify(f.diagnostics))
      assert.equal(d[0].position, 'src/lettre.mjs:3:9')
      const code = 'U+' + l.codePointAt(0).toString(16).toUpperCase()
      assert.ok(d[0].message.includes(code) && d[0].message.includes('\\u' + code.slice(2)), d[0].message)
    }
    const f = lireFichier(S(['<p>ꞩ {$a}</p>', '<script>', '$a = \'ꞩ\'', '</script>']), { fichier: 'voisine.mjs' })
    assert.deepEqual(f.diagnostics, [], 'une lettre voisine, non réservée, est acceptée')
  })

  it('le déguisement garde chaque longueur et se rend à l\'identique (=: excepté, relu à sa place)', () => {
    const src = '@import µ$$x \'./a\'\n§prix = §§total + &id\n@@aide = #champ\n$v =: 1\na && b, c &= d, mail = "a@b.fr", n = 2 # note\n'
    const d   = deguiser(src)
    assert.equal(d.length, src.length)
    assert.ok(d.includes('$v := 1') && d.includes('a && b, c &= d') && d.includes('"a@b.fr"'), d)
    assert.equal(rendre(d), src.replace('$v =: 1', '$v := 1'))
    for (const nom of readdirSync(COEUR).filter((f) => f.endsWith('.mjs'))) {
      const texte = readFileSync(join(COEUR, nom), 'utf-8')
      const vu    = deguiser(texte)
      assert.equal(vu.length, texte.length, nom)
      const rendu  = rendre(vu)
      const ecarts: string[] = []
      for (let i = 0; i < texte.length; i++) {
        if (rendu[i] === texte[i] || texte.startsWith('=:', i) || texte.startsWith('=:', i - 1)) continue
        ecarts.push(i + ' ' + JSON.stringify(texte.slice(i - 3, i + 3)) + ' → ' + JSON.stringify(rendu.slice(i - 3, i + 3)))
      }
      assert.deepEqual(ecarts, [], nom)
    }
  })
})
