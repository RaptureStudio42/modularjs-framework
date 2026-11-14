// la précision des valeurs calculées est le défaut : sans la clé `derived`, la sortie est celle de `derived: "precise"`, à
// l'octet ; `derived: "clock"` (mjs.config.json) rend le code de la règle de l'horloge — ni sources posées sur une valeur calculée,
// ni écho de liaison marqué, ni machinerie de précision au cœur, et chaque fichier du runtime redevient son texte sans la
// précision (blocs `<precision>` ôtés, blocs `<horloge>` rendus) ; avec la précision, l'inverse
import { describe, it, before, after } from 'mocha'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import { Bundler, projeterPrecision, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '..', 'src', 'runtime')
const MARQUE  = /^[ \t]*\/\/ <\/?(precision|horloge)>$/m

const SOURCES: Record<string, string> = {
  'pa-paire.mjs': `<script>
$n = 0
$paire = [$n, 1]
@plus = -> $n += 1
</script>
<p class="p">{$paire[0]}</p>
`,
  'pa-annee.mjs': `<script>
$année = [{nom: 'a'}]
</script>

<@pa-enf items=!{$année}>
<p class="etat">{$année[0].nom}</p>
`,
  'pa-enf.mjs': `<script>
@agir = -> $items[0].nom = $items[0].nom + 'Z'
</script>
<p class="vu">{$items ? $items[0].nom : '-'}</p>
`,
}

async function construire(reglages: Record<string, unknown>): Promise<string> {
  const root   = mjsTmp('precision-absente')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', minify: false, ...reglages } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8')
}

const SOURCES_PAIRE = /_mjs_setComputed\(_mjsThis, ?['"]paire['"][^;\n]*?\[["']n["']\]\)/
const ECHO_MARQUE   = /_set\(_mjsThis, ?['"]année['"], ?_mjs_e\.data, ?0\)/

describe('"clock" : le code de la règle de l\'horloge ; sans la clé, la précision (défaut), à l\'octet', function () {
  this.timeout(120000)
  let horloge = ''
  let precis = ''
  let sansCle = ''
  before(async () => {
    horloge = await construire({ derivedMode: 'clock' })
    sansCle = await construire({})
    precis = await construire({ derivedMode: 'precise' })
  })
  after(() => terminateSharedWorkerPool?.())

  it('avec "clock", aucune valeur calculée ne porte de sources', () => {
    assert.match(horloge, /_mjs_setComputed\(_mjsThis, ?['"]paire['"]/)
    assert.doesNotMatch(horloge, SOURCES_PAIRE)
  })

  it('avec "clock", l\'écho d\'une liaison `!{}` s\'écrit comme une affectation ordinaire', () => {
    assert.doesNotMatch(horloge, ECHO_MARQUE)
  })

  it('avec "clock", le cœur n\'a ni machinerie de précision ni marque de bloc', () => {
    assert.ok(horloge.includes('_mjs_setComputed(k, fn) {'), 'accesseur des valeurs calculées de la règle de l\'horloge')
    assert.ok(horloge.includes('_set(k, v) {'), 'écriture de l\'état sans drapeau du code du composant')
    for (const nom of ['_mjsDoute(', '_mjs_src', '_MJS_RATES', '_mjsPrecisFin(']) assert.ok(!horloge.includes(nom), `${nom} absent du cœur`)
    assert.doesNotMatch(horloge, /<\/?(precision|horloge)>/)
  })

  it('sans la clé, la sortie de "precise", à l\'octet', () => {
    assert.ok(sansCle === precis, 'sortie sans la clé = sortie de "precise"')
  })

  it('avec "precise", les sources, l\'écho marqué et la machinerie sont là', () => {
    assert.match(precis, SOURCES_PAIRE)
    assert.match(precis, ECHO_MARQUE)
    assert.ok(precis.includes('_mjs_setComputed(k, fn, src) {'), 'accesseur des valeurs précises')
    for (const nom of ['_mjsDoute(', '_mjs_src', '_mjsPrecisFin(']) assert.ok(precis.includes(nom), `${nom} présent au cœur`)
    assert.doesNotMatch(precis, /<\/?(precision|horloge)>/)
  })
})

describe('fichiers du runtime : les deux textes, avec et sans l\'option', () => {
  const fichiers = readdirSync(RUNTIME).filter((f) => f.endsWith('.ts')).sort()
  const balises  = fichiers.filter((f) => MARQUE.test(readFileSync(join(RUNTIME, f), 'utf-8')))

  it('des fichiers portent des blocs `<precision>` ou `<horloge>`', () => {
    assert.ok(balises.includes('mjs_element.ts') && balises.includes('mjs_init.ts'), `fichiers balisés : ${balises.join(', ')}`)
  })

  for (const f of balises) {
    it(`${f} : un bloc <horloge> ne contient que des lignes en commentaire, et chaque texte se lit sans marque`, () => {
      const brut = readFileSync(join(RUNTIME, f), 'utf-8')
      for (const bloc of brut.match(/^[ \t]*\/\/ <horloge>\n[\s\S]*?^[ \t]*\/\/ <\/horloge>\n/gm) ?? []) {
        const lignes = bloc.split('\n').slice(1, -2)
        assert.ok(lignes.length > 0 && lignes.every((l) => /^[ \t]*\/\//.test(l)), `bloc <horloge> de ${f} :\n${bloc}`)
      }
      for (const precise of [false, true]) {
        const texte = projeterPrecision(brut, precise)
        assert.doesNotMatch(texte, MARQUE, `${f}, précision ${precise}`)
        // un fichier qui exporte se lit en module, les autres en script
        try {
          acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'module' })
        }
        catch {
          acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true })
        }
      }
    })
  }

  // le redessin sans reffet (`rw`, pour `µrefresh` et `$x = $x`) a son propre bloc : il n'entre qu'avec une unité qui l'écrit
  it('mjs_element.ts à l\'horloge : les signatures de l\'horloge ; en précision : celles de la précision ; avec le redessin : celles de `rw`', () => {
    const brut     = readFileSync(join(RUNTIME, 'mjs_element.ts'), 'utf-8')
    const horloge  = projeterPrecision(brut, false)
    const precis   = projeterPrecision(brut, true)
    const redessin = projeterPrecision(brut, true, true)
    for (const s of ['  _set(k, v) {', '  _mjs_setComputed(k, fn) {', '  _mjs_notifyMutation(k, oldValue) {', '  _mjs_invalidate(k) {']) assert.ok(horloge.includes('\n' + s + '\n'), `horloge : ${s}`)
    for (const s of ['  _set(k, v, code) {', '  _mjs_setComputed(k, fn, src) {', '  _mjs_notifyMutation(k, oldValue) {', '  _mjs_invalidate(k) {']) assert.ok(precis.includes('\n' + s + '\n'), `précision : ${s}`)
    for (const s of ['  _mjs_notifyMutation(k, oldValue, rw) {', '  _mjs_invalidate(k, rw) {']) assert.ok(redessin.includes('\n' + s + '\n') && !precis.includes('\n' + s + '\n'), `redessin : ${s}`)
    assert.ok(!horloge.includes('_mjsDoute') && precis.includes('_mjsDoute'), 'machinerie de précision : en précision seulement')
  })
})
