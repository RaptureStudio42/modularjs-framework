// le repli d'un <@failed> est du HTML posé tel quel, une seule fois, après l'erreur : ce que seul le gabarit compilé fait agir y
// arrête la construction à sa ligne, au lieu d'un repli faux sans un mot. <@element $tag> y restait un <div> qui ne devenait
// jamais la balise, <@module $comp> un <div> vide ; un bloc ({if}, {for}…) tombait sur une erreur de Civet illisible, ou passait
// la construction et faisait planter le repli à l'affichage. Une fermante d'une autre casse que son ouvrante (`<@Carte>…</@carte>`)
// y est refusée comme dans le gabarit, qui ne l'apparie pas davantage : le navigateur en faisait un commentaire et le contenu
// sortait de la balise. Ce que le repli calculait juste reste accepté : l'expression d'un paramètre nommé `error`, `success`, `key`
// ou `end`, une expression en ligne (`{if err then 'a' else 'b'}`), ces balises citées dans un exemple (<pre>, <code>, un script, un
// style, un <textarea>), laissées telles qu'écrites. Développement et production, composant et partiel

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CARTE = '<p class="carte">carte {$titre}</p>\n<script>\n  $titre = \'\'\n</script>\n'
const LEVE  = '<p>{jette()}</p>\n<script>\n  $tag = \'p\'\n  $comp = \'mjs-carte\'\n  jette = -> throw new Error(\'boum\')\n</script>\n'

interface Facon { prod?: boolean, partiel?: boolean, place?: 'repli' | 'gabarit' | 'apres', params?: string }

// le bloc <@failed> de la page, `corps` à sa troisième ligne
const REPLI = (corps = '', params = 'err reset'): string => `<@failed ${params}>\n  <p class="repli">repli</p>\n${corps}</@failed>\n`

// la construction d'une page dont le repli porte `corps` (sa troisième ligne) ; `partiel` : la page entière dans un partiel
// inclus ; `place` : `corps` à la troisième ligne du gabarit, avant le repli (`gabarit`), ou dans le gabarit après lui (`apres`).
// Rend le texte de toutes les erreurs, leur nombre et le code compilé de la page
async function construire(corps: string, facon: Facon = {}): Promise<{ texte: string, nombre: number, js: string }> {
  const root = mjsTmp('failed-repli-refus')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'carte.mjs'), CARTE)
  const cas = facon.place === 'gabarit' ? `<div>\n  <p>x</p>\n${corps}</div>\n${REPLI()}${LEVE}` : facon.place === 'apres' ? `${REPLI()}<div>\n${corps}</div>\n${LEVE}` : `${REPLI(corps, facon.params)}${LEVE}`
  if (facon.partiel) writeFileSync(join(src, '_cas.mjs'), cas)
  writeFileSync(join(src, 'page.mjs'), facon.partiel ? '<div><@include cas></div>\n' : cas)
  const garde = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  try {
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: facon.prod ? 'prod' : 'dev' })
    const stats = await b.compile()
    await b.close()
    const js = stats.errors.length ? '' : readdirSync(out).filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
    return { texte: stats.errors.map(e => e.message).join('\n'), nombre: stats.errors.length, js }
  }
  finally {
    Object.assign(console, garde)
  }
}

// les refus du repli dans le texte des erreurs
const refus = (texte: string): number => (texte.match(/ne peut pas vivre dans le repli d'un <@failed>/g) ?? []).length

// le code du repli tel que compilé, guillemets échappés et blancs ramenés à une espace
const lu = (js: string): string => js.replace(/\\(['"])/g, '$1').replace(/\\n/g, ' ').replace(/\s+/g, ' ')

describe('<@failed> : <@element> et <@module> dans le repli arrêtent la construction à leur ligne', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  const CAS: Array<[string, string]> = [
    ['@element', '  <@element $tag class="e">x</@element>\n'],
    ['@module', '  <@module $comp titre="m"></@module>\n'],
    ['@ELEMENT', '  <@ELEMENT $tag>x</@ELEMENT>\n']
  ]
  for (const prod of [false, true]) {
    for (const [nom, corps] of CAS) {
      it(`<${nom}>, ${prod ? 'production' : 'développement'}`, async () => {
        const { texte, nombre } = await construire(corps, { prod })
        assert.equal(nombre, 1, texte)
        assert.equal(refus(texte), 1, texte)
        assert.match(texte, new RegExp(`<@failed> ligne 3 : la balise <${nom}> ne peut pas vivre dans le repli d'un <@failed>.* Écrivez-la hors du <@failed>`))
      })
    }
  }

  it('dans un partiel : la ligne de son fichier', async () => {
    const { texte } = await construire('  <p>a</p>\n  <@module $comp></@module>\n', { partiel: true })
    assert.equal(refus(texte), 1, texte)
    assert.match(texte, /<@failed> ligne 4 de _cas\.mjs : la balise <@module> ne peut pas vivre/)
  })

  it('hors du repli, avant ou après lui, ou autour de lui : rendues comme avant', async () => {
    for (const place of ['gabarit', 'apres'] as const) {
      const { texte, js } = await construire('  <@element $tag class="e">x</@element>\n  <@module $comp titre="m"></@module>\n', { place })
      assert.equal(texte, '', place)
      assert.ok(js.includes('_updDynEl'), `${place} : la balise de <@element> est suivie`)
      assert.ok(lu(js).includes('mjs-mod'), `${place} : le composant de <@module> est monté`)
    }
    const autour = await construire('  <@element $tag><@failed err>{err.message}</@failed><b>y</b></@element>\n', { place: 'apres' })
    assert.equal(autour.texte, '')
    assert.ok(autour.js.includes('_updDynEl'), 'la balise de <@element> qui porte un repli est suivie')
  })
})

describe('<@failed> : un bloc dans le repli arrête la construction à sa ligne, avec ce qu\'il faut écrire', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  const CAS: Array<[string, string]> = [
    ['if', '  {if err}<b>e</b>{end}\n'],
    ['if', '  <div>{if err.message}<b>e</b>{elsif err}<u>u</u>{else}<i>n</i>{end}</div>\n'],
    ['for', '  {for x in [1, 2]}<i>{x}</i>{end}\n'],
    ['key', '  {key err}<i>k</i>{end}\n'],
    ['await', '  {await Promise.resolve(1)}<i>a</i>{success v}<i>{v}</i>{end}\n'],
    ['const', '  {const n = 1}<i>{n}</i>\n'],
    ['if', '  <pre>{if err}x{end}</pre>\n'],
    ['end', '  <p>a</p>{end}\n'],
    ['else', '  <p>a</p>{else}\n'],
    ['elsif', '  <p>a</p>{elsif err}\n']
  ]
  for (const prod of [false, true]) {
    for (const [bloc, corps] of CAS) {
      it(`${corps.trim()}, ${prod ? 'production' : 'développement'}`, async () => {
        const { texte, nombre } = await construire(corps, { prod })
        assert.equal(nombre, 1, texte)
        assert.equal(refus(texte), 1, texte)
        assert.match(texte, new RegExp(`<@failed> ligne 3 : le bloc \\{${bloc}\\} ne peut pas vivre dans le repli d'un <@failed> .*seules les expressions \\{…\\} sont calculées.*<@nom message="\\{err\\.message\\}">`))
        assert.doesNotMatch(texte, /Failed to parse|Expected:|BALISE FERMANTE/)
      })
    }
  }

  it('deux blocs imbriqués, sur deux lignes : chacun à sa ligne', async () => {
    const { texte } = await construire('  {if err}\n    {for x in [1]}<i>{x}</i>{end}\n  {end}\n')
    assert.equal(refus(texte), 2, texte)
    assert.match(texte, /<@failed> ligne 3 : le bloc \{if\}/)
    assert.match(texte, /<@failed> ligne 4 : le bloc \{for\}/)
  })

  it('dans un partiel : la ligne de son fichier', async () => {
    const { texte } = await construire('  <p>a</p>\n  {for x in [1, 2]}<i>{x}</i>{end}\n', { partiel: true })
    assert.equal(refus(texte), 1, texte)
    assert.match(texte, /<@failed> ligne 4 de _cas\.mjs : le bloc \{for\} ne peut pas vivre/)
  })

  it('ce que le message propose est permis : une expression, un composant qui reçoit l\'erreur', async () => {
    const { texte, js } = await construire('  <p class="t">{err.message ? \'oui\' : \'non\'}</p>\n  <@carte titre="{err.message}"></@carte>\n')
    assert.equal(texte, '')
    assert.ok(lu(js).includes('<mjs-carte titre="'), lu(js).slice(lu(js).indexOf('_mjs_fallback'), lu(js).indexOf('_mjs_fallback') + 600))
  })
})

describe('<@failed> : ce que le repli calculait juste reste accepté', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  // le nom du cas, les paramètres du repli, son corps, ce que son code compilé porte (en production : un exemple seulement, le reste minifié)
  const CAS: Array<[string, string, string, string]> = [
    ['un paramètre error, {error || …}', 'error reset', '  <p>{error || \'inconnue\'}</p>\n', 'µ._esc(error || \'inconnue\')'],
    ['un paramètre error, {error ? … : …}', 'error reset', '  <p>{error ? error.message : \'x\'}</p>\n', 'µ._esc(error ? error.message : \'x\')'],
    ['un paramètre error, {error and …}', 'error reset', '  <p>{error and error.message}</p>\n', 'error && error.message'],
    ['un paramètre error, {error }', 'error reset', '  <p>{error }</p>\n', 'µ._esc(error)'],
    ['un paramètre success, {success ? … : …}', 'success reset', '  <p>{success ? \'a\' : \'b\'}</p>\n', 'µ._esc(success ? \'a\' : \'b\')'],
    ['un paramètre key, {key }', 'key reset', '  <p>{key }</p>\n', 'µ._esc(key)'],
    ['un paramètre end, {end}', 'end reset', '  <p>{end}</p>\n', 'µ._esc(end)'],
    ['{key k} que rien ne referme : un appel', 'err reset', '  <p>{key err}</p>\n', 'µ._esc(key(err))'],
    ['{if … then … else …} en ligne', 'err reset', '  <p>{if err then \'a\' else \'b\'}</p>\n', '(err? \'a\' : \'b\')'],
    ['{for … then …} en ligne', 'err reset', '  <p>{for x in [1, 2] then x}</p>\n', 'results.push(x)'],
    ['<@element> cité dans un <code>', 'err reset', '  <code><@element $tag>x</@element></code>\n', '<code><@element $tag>x</@element></code>'],
    ['<@module> cité dans un <pre>', 'err reset', '  <pre><@module $comp></@module></pre>\n', '<pre><@module $comp></@module></pre>'],
    ['<@element> dans une chaîne d\'un <script>', 'err reset', '  <script>var s = \'<@element $tag>\'</script>\n', 'var s = \'<@element $tag>\''],
    ['<@module> dans un commentaire d\'un <style>', 'err reset', '  <style>/* <@module $comp> */ .a { color: red }</style>\n', '/* <@module $comp> */'],
    ['<@element> dans un <textarea>', 'err reset', '  <textarea><@element $tag></textarea>\n', '<textarea><@element $tag></textarea>']
  ]
  for (const prod of [false, true]) {
    for (const [nom, params, corps, porte] of CAS) {
      it(`${nom}, ${prod ? 'production' : 'développement'}`, async () => {
        const { texte, js } = await construire(corps, { prod, params })
        assert.equal(texte, '', 'construction refusée')
        if (!prod || porte.startsWith('<') || porte.includes('<@')) assert.ok(lu(js).includes(porte), lu(js).slice(lu(js).indexOf('_mjs_fallback'), lu(js).indexOf('_mjs_fallback') + 500))
      })
    }
  }

  it('une expression en ligne garde son {else} et son {end} sans bloc : refusés, chacun à sa ligne', async () => {
    const fin = await construire('  <p>{if err then \'a\'}</p>\n  <p>b</p>{end}\n')
    assert.equal(refus(fin.texte), 1, fin.texte)
    assert.match(fin.texte, /<@failed> ligne 4 : le bloc \{end\} ne peut pas vivre/)
    const sinon = await construire('  <p>{if err then \'a\'}{else}</p>\n')
    assert.equal(refus(sinon.texte), 1, sinon.texte)
    assert.match(sinon.texte, /<@failed> ligne 3 : le bloc \{else\} ne peut pas vivre/)
  })

  it('un vrai bloc après une expression en ligne, une balise vivante après un exemple : refusés à leur ligne', async () => {
    const bloc = await construire('  <p>{if err then \'a\'}</p>\n  {for x in [1]}<i>{x}</i>{end}\n')
    assert.equal(refus(bloc.texte), 1, bloc.texte)
    assert.match(bloc.texte, /<@failed> ligne 4 : le bloc \{for\} ne peut pas vivre/)
    const balise = await construire('  <pre><@module $comp></@module></pre>\n  <@element $tag>x</@element>\n')
    assert.equal(refus(balise.texte), 1, balise.texte)
    assert.match(balise.texte, /<@failed> ligne 4 : la balise <@element> ne peut pas vivre/)
  })
})

describe('<@failed> : une fermante d\'une autre casse que son ouvrante, refusée dans le repli comme dans le gabarit', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  const CAS: Array<[string, string]> = [
    ['@carte', '  <@Carte titre="x">a</@carte>\n'],
    ['@Carte', '  <@carte titre="x">a</@Carte>\n'],
    ['@@progress', '  <@@PROGRESS value="1" max="2"></@@progress>\n'],
    ['@carte', '  <p>a</@carte></p>\n']
  ]
  for (const prod of [false, true]) {
    for (const [nom, corps] of CAS) {
      it(`${corps.trim()}, ${prod ? 'production' : 'développement'}`, async () => {
        const orpheline = new RegExp(`\\[BALISE FERMANTE ORPHELINE\\] \`</${nom}>\` ligne 3 : aucune balise ouvrante correspondante`)
        const gabarit   = await construire(corps, { prod, place: 'gabarit' })
        assert.match(gabarit.texte, orpheline, `le gabarit : ${gabarit.texte}`)
        const repli = await construire(corps, { prod })
        assert.equal(repli.nombre, 1, repli.texte)
        assert.equal((repli.texte.match(/BALISE FERMANTE ORPHELINE/g) ?? []).length, 1, repli.texte)
        assert.match(repli.texte, orpheline)
      })
    }
  }

  it('un exemple montré dans <pre> reste tel qu\'écrit, comme ses autres balises', async () => {
    const { texte } = await construire('  <pre><@Carte titre="x">a</@carte></pre>\n')
    assert.equal(texte, '')
  })

  it('dans un partiel : la ligne de son fichier', async () => {
    const { texte } = await construire('  <p>a</p>\n  <@Carte titre="x">a</@carte>\n', { partiel: true })
    assert.match(texte, /\[BALISE FERMANTE ORPHELINE\] `<\/@carte>` ligne 4 de _cas\.mjs : aucune balise ouvrante correspondante/)
  })

  it('la même casse des deux côtés : appariée, comme dans le gabarit', async () => {
    const { texte, js } = await construire('  <@Carte titre="x">a</@Carte>\n  <@@PROGRESS value="1" max="2"></@@PROGRESS>\n')
    assert.equal(texte, '')
    const code = lu(js)
    assert.ok(code.includes('<mjs-carte titre="x">a</mjs-carte>'), code.slice(code.indexOf('_mjs_fallback'), code.indexOf('_mjs_fallback') + 600))
    assert.ok(code.includes('<mjs-core-progress value="1" max="2"></mjs-core-progress>'), code.slice(code.indexOf('_mjs_fallback'), code.indexOf('_mjs_fallback') + 600))
  })
})
