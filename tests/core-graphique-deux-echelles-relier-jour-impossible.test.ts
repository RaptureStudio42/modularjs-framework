// module cœur <@@chart>, sous happy-dom. `bridge` relie les points d'une courbe ou d'une aire par-dessus une case vide (sans lui, la case
// vide coupe le trait, comme avant). Une série écrite `axis: 'right'` prend sa propre échelle, graduée à droite : les séries de gauche
// gardent la leur, l'unité de chaque côté s'écrit au bout de sa graduation du haut, aucune note « une échelle par série » ; des barres
// restent côte à côte, chacune sur son échelle. Sur une forme qui n'a qu'une échelle, `axis: 'right'` est ignoré avec un avertissement du
// développement ; un mot inconnu de `axis` est une faute dite une fois. Une ligne dont la date n'existe pas (le 30 février) ne se range
// dans aucune période : regroupée par `step` ou posée sur un calendrier, elle quittait le graphique sans rien dire, elle est maintenant
// signalée comme les autres valeurs fausses

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'
import { attendre, pause } from './helpers/coeur-monter.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const HOTE = `<script>
  $trou    = [{ x: 'a', v: 1 }, { x: 'b' }, { x: 'c', v: 3 }, { x: 'd', v: 2 }]
  $une     = [{ key: 'v', name: 'Valeur' }]
  $meteo   = [{ x: '2026-10-01', t: 100, p: 3 }, { x: '2026-10-02', t: 150, p: 2 }, { x: '2026-10-03', t: 200, p: 1 }]
  $deux    = [{ key: 't', name: 'Température', unit: '°C' }, { key: 'p', name: 'Pluie', unit: 'mm', axis: 'right' }]
  $memes   = [{ key: 't', name: 'Haut', unit: 'u' }, { key: 'p', name: 'Bas', unit: 'u', axis: 'right' }]
  $commune = [{ key: 't', name: 'Haut', unit: 'u' }, { key: 'p', name: 'Bas', unit: 'u' }]
  $faute   = [{ key: 't', name: 'Température', unit: '°C' }, { key: 'p', name: 'Pluie', unit: 'mm', axis: 'droite' }]
  $fevrier = [{ x: '2026-02-27', v: 1 }, { x: '2026-02-30', v: 2 }, { x: '2026-03-02', v: 3 }]
  $avril   = [{ x: '2026-04-28', v: 1 }, { x: '2026-04-31', v: 2 }, { x: '2026-05-02', v: 3 }]
  $forme   = 'stack'
  $seule   = [{ x: '2026-10-01', t: 100 }, { x: '2026-10-02', t: 150 }, { x: '2026-10-03', t: 200, p: 3 }]
</script>
<@@chart class="coupe" rows={$trou} series={$une}></@@chart>
<@@chart class="relie" rows={$trou} series={$une} bridge></@@chart>
<@@chart class="aire-coupee" rows={$trou} series={$une} shape="area"></@@chart>
<@@chart class="aire" rows={$trou} series={$une} shape="area" bridge></@@chart>
<@@chart class="deux" rows={$meteo} series={$deux}></@@chart>
<@@chart class="memes" rows={$meteo} series={$memes}></@@chart>
<@@chart class="commune" rows={$meteo} series={$commune}></@@chart>
<@@chart class="barres" rows={$meteo} series={$deux} shape="bar"></@@chart>
<@@chart class="pile" rows={$meteo} series={$deux} shape={$forme}></@@chart>
<@@chart class="mot" rows={$meteo} series={$faute}></@@chart>
<@@chart class="semaine" rows={$fevrier} series={$une} step="week"></@@chart>
<@@chart class="tel" rows={$avril} series={$une}></@@chart>
<@@chart class="calendrier" rows={$avril} series={$une} shape="calendar"></@@chart>
<@@chart class="tendance" rows={$seule} series={$deux} stats="trend"></@@chart>
`

// l'hôte compilé par le vrai Bundler (développement), monté dans happy-dom ; µ.error et µ.warn recueillis
async function monter(): Promise<{ window: any, hote: any, erreurs: string[], avis: string[] }> {
  const root   = mjsTmp('graphique-deux-echelles')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
  const code  = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  window.eval(`${code}\nglobalThis.µ = µ;\nglobalThis.__erreurs = [];\nglobalThis.__avis = [];\nµ.error = function(...a) { globalThis.__erreurs.push(a.map(String).join(' ')); };\nµ.warn = function(...a) { globalThis.__avis.push(a.map(String).join(' ')); };`)
  window.document.body.innerHTML = '<mjs-hote></mjs-hote>'
  const hote = window.document.querySelector('mjs-hote')
  await attendre(() => !!hote._shadow && hote._shadow.querySelectorAll('mjs-core-chart').length === 14 && [...hote._shadow.querySelectorAll('mjs-core-chart')].every((c: any) => c._shadow?.querySelector('.chart')))
  await pause(150)
  return { window, hote, erreurs: window.eval('globalThis.__erreurs'), avis: window.eval('globalThis.__avis') }
}

// les nombres d'un tracé, par paires (x, y)
const paires = (d: string) => { const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number); const out: number[][] = []; for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]); return out }

describe('<@@chart> — relier par-dessus une case vide, deux échelles, date qui n\'existe pas', function () {
  this.timeout(120000)
  let monte: { window: any, hote: any, erreurs: string[], avis: string[] }
  const graphique = (classe: string) => monte.hote._shadow.querySelector(`mjs-core-chart.${classe}`)._shadow
  const textes = (classe: string, sel: string) => [...graphique(classe).querySelectorAll(sel)].map((n: any) => n.textContent.trim())

  before(async () => { monte = await monter() })
  after(async () => { await monte?.window.happyDOM.close(); await terminateSharedWorkerPool() })

  it('témoin : sans bridge, une case vide coupe la courbe et l\'aire', () => {
    const d = graphique('coupe').querySelector('path.line').getAttribute('d')
    assert.equal(d.match(/M/g)?.length, 2, d)
    const a = graphique('aire-coupee').querySelector('path.area').getAttribute('d')
    assert.equal(a.match(/Z/g)?.length, 2, a)
  })

  it('bridge : la courbe et l\'aire passent d\'un seul trait par-dessus la case vide, sans point sur elle', () => {
    const d = graphique('relie').querySelector('path.line').getAttribute('d')
    assert.equal(d.match(/M/g)?.length, 1, d)
    assert.equal(d.match(/L/g)?.length, 2, `trois points reliés : ${d}`)
    assert.equal(graphique('relie').querySelectorAll('circle.dot').length, 3, 'un point par valeur, aucun sur la case vide')
    const a = graphique('aire').querySelector('path.area').getAttribute('d')
    assert.equal(a.match(/Z/g)?.length, 1, a)
    assert.equal(graphique('aire').querySelector('path.line').getAttribute('d').match(/M/g)?.length, 1)
  })

  it('axis: \'right\' : une graduation à droite pour la pluie, à gauche pour la température, l\'unité au bout de chaque côté, sans note', () => {
    const gauche = textes('deux', 'text.ylabel:not(.right)')
    const droite = textes('deux', 'text.ylabel.right')
    assert.ok(gauche.length >= 2, `graduations de gauche : ${gauche}`)
    assert.ok(droite.length >= 2, `graduations de droite : ${droite}`)
    assert.match(gauche[gauche.length - 1], /200 °C$/, `le haut de gauche : ${gauche}`)
    assert.match(droite[droite.length - 1], /3 mm$/, `le haut de droite : ${droite}`)
    assert.ok(gauche.slice(0, -1).every((t) => !/°C|mm/.test(t)) && droite.slice(0, -1).every((t) => !/°C|mm/.test(t)), 'l\'unité ne s\'écrit qu\'en haut')
    assertAbsent(graphique('deux').querySelector('p.note'), 'aucune note « une échelle par série »')
    assert.ok(graphique('deux').querySelector('.frame').classList.contains('twin'), 'le cadre porte l\'axe de droite')
    assert.equal(graphique('commune').querySelector('.frame').classList.contains('twin'), false, 'sans axe de droite, le cadre de toujours')
    assert.equal(graphique('commune').querySelectorAll('text.ylabel.right').length, 0)
  })

  it('axis: \'right\' : même unité, la série de droite garde sa propre échelle (sur l\'échelle commune, elle restait collée au bas)', () => {
    const [haut, bas] = [...graphique('memes').querySelectorAll('path.line')].map((p: any) => paires(p.getAttribute('d')))
    assert.deepEqual(bas.map((p) => Math.round(p[1])), [0, 150, 300], `la série de droite couvre toute la hauteur : ${bas}`)
    assert.deepEqual(haut.map((p) => Math.round(p[1])), [300, 150, 0], `la série de gauche aussi : ${haut}`)
    const commune = paires(graphique('commune').querySelectorAll('path.line')[1].getAttribute('d'))
    assert.ok(commune.every((p) => p[1] > 280), `témoin : sur l'échelle commune, la série reste en bas : ${commune}`)
  })

  it('axis: \'right\' sur des barres : deux barres par colonne, côte à côte, chacune sur son échelle', () => {
    const barres = [...graphique('barres').querySelectorAll('rect.bar')].map((r: any) => ({ x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')), w: Number(r.getAttribute('width')) }))
    assert.equal(barres.length, 6)
    for (let i = 0; i < 6; i += 2) {
      assert.ok(Math.abs(barres[i].x + barres[i].w - barres[i + 1].x) < 0.02, `colonne ${i / 2} : côte à côte ${JSON.stringify(barres.slice(i, i + 2))}`)
      assert.equal(barres[i].w, barres[i + 1].w)
    }
    assert.equal(Math.round(barres[1].y), 0, 'la plus haute pluie touche le haut de son échelle')
    assert.ok(textes('barres', 'text.ylabel.right').length >= 2, 'graduations de droite')
  })

  it('une forme à une seule échelle ignore axis: \'right\' : un avertissement du développement, une fois', () => {
    const dits = monte.avis.filter((a) => a.includes('n\'a qu\'une échelle'))
    assert.equal(dits.length, 1, monte.avis.join('\n'))
    assert.match(dits[0], /la forme stack n'a qu'une échelle, axis « right » est ignoré pour p — formes à deux échelles : line area dots bar\./)
    assert.equal(graphique('pile').querySelectorAll('text.ylabel.right').length, 0)
  })

  it('un mot inconnu de axis est une faute, dite une fois : la série reste à gauche', () => {
    const dits = monte.erreurs.filter((e) => e.includes('axis « droite »'))
    assert.equal(dits.length, 1, monte.erreurs.join('\n'))
    assert.match(dits[0], /axis « droite » de la série « p » n'est pas une valeur connue, la série reste sur l'axe de gauche — valeurs connues : left right\./)
    assert.equal(graphique('mot').querySelectorAll('text.ylabel.right').length, 0)
  })

  it('une date qui n\'existe pas, regroupée par semaine ou posée sur un calendrier, est signalée au lieu de disparaître', () => {
    const fevrier = monte.erreurs.filter((e) => e.includes('« 2026-02-30 »'))
    assert.equal(fevrier.length, 1, monte.erreurs.join('\n'))
    assert.match(fevrier[0], /« 2026-02-30 » n'est pas une date qui existe, sa ligne ne se range dans aucune période et quitte le graphique/)
    assert.equal(monte.erreurs.filter((e) => e.includes('« 2026-04-31 »')).length, 1, `le calendrier le dit aussi :\n${monte.erreurs.join('\n')}`)
    assert.equal(textes('semaine', 'tbody th').length, 2, 'deux semaines, la ligne impossible n\'y est pas')
  })

  it('deux échelles et tendance d\'un seul côté : les points des deux côtés restent sur les mêmes colonnes', () => {
    const cx = [...graphique('tendance').querySelectorAll('circle.dot')].map((c: any) => c.getAttribute('cx'))
    assert.equal(cx.length, 4, cx.join(' '))
    assert.equal(cx[3], cx[2], `la pluie du 3 octobre sur la colonne du 3 octobre : ${cx.join(' ')}`)
    assert.notEqual(cx[2], '100%', 'la tendance garde une place après la dernière colonne')
  })

  it('au rendu serveur : les graduations de droite, leur gouttière et l\'axe de droite sont dans la page servie', async () => {
    const root   = mjsTmp('graphique-deux-echelles-serveur')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'gd-ssr.mjs'), `<script>\n  $meteo = [{ x: '2026-10-01', t: 100, p: 3 }, { x: '2026-10-02', t: 150, p: 2 }, { x: '2026-10-03', t: 200, p: 1 }]\n  $deux  = [{ key: 't', name: 'Poids', unit: 'kg' }, { key: 'p', name: 'Pluie', unit: 'mm', axis: 'right' }]\n</script>\n<@@chart rows={$meteo} series={$deux}></@@chart>\n`)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    let html = ''
    try { html = (await renderer.renderToString('mjs-gd-ssr', { ssrMode: 'markers' } as any)).html }
    finally { await renderer.close() }
    const droite = [...html.matchAll(/<text class="ylabel right"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
    assert.ok(droite.length >= 3, `graduations de droite servies : ${droite.join(' | ')}`)
    assert.equal(droite[droite.length - 1], '3 mm')
    assert.match(html, /class="frame[^"]*\btwin\b/, 'le cadre servi porte l\'axe de droite')
    assert.match(html, /--mjs-chart-gutter-right:\s*\d+/, 'la gouttière de droite est réservée dès la page servie')
  })

  it('témoin : sans regroupement, le jour impossible reste une colonne, écrite telle quelle', () => {
    assert.ok(textes('tel', 'tbody th').includes('2026-04-31'), textes('tel', 'tbody th').join(' | '))
  })
})
