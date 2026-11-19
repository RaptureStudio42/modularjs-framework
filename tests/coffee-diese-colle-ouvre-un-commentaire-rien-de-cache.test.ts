// En CoffeeScript, `#` ouvre toujours un commentaire, `#x` compris : une ligne `#x = 'a` ou `#voir "la doc` (guillemet laissé ouvert)
// ne cache pas le code qui suit — `µajax('/v')` y reste réécrit, dans un module `.coffee.mjs` (développement et production) comme
// dans le <script> d'un composant ; en Civet, `#x` est lu comme Civet le lit (un nom), le guillemet ouvre une chaîne : la
// construction refuse, jamais en silence ; un vrai nom privé `#x` d'un script `lang="js"` ou `"ts"` reste un nom. Une regex étendue
// qui porte une interpolation `#{…}` garde son texte : un `µajax` écrit hors de `#{…}` n'y est pas réécrit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const Q = '\''

async function composant(lang: string, corps: string): Promise<{ msg: string, out: string, avertis: string[] }> {
  const e = console.error, w = console.warn
  console.error = console.warn = () => {}
  try {
    const r: any = await transpile(`<p>x</p>\n<script${lang ? ` lang="${lang}"` : ''}>\n${corps}\n</script>\n`, { moduleName: 'Cas', defaultScriptLang: 'civet' })
    return { msg: '', out: String(r.output), avertis: (r.data.sectionWarnings as string[]).filter(l => l.includes('µajax')) }
  }
  catch (err: any) {
    return { msg: String(err?.message ?? err), out: '', avertis: [] }
  }
  finally {
    console.error = e
    console.warn = w
  }
}

async function module(nom: string, texte: string, dev: boolean): Promise<{ erreurs: string[], out: string }> {
  const racine = mjsTmp('diese-colle')
  const src    = join(racine, 'src')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, nom), texte)
  writeFileSync(join(src, 'fiche.mjs'), `<script>\n@import { lire y } ${Q}${nom}${Q}\n</script>\n<p>{y}</p>\n<button @click={lire()}>x</button>\n`)
  const b: any = new Bundler({ sourceDir: src, outputDir: join(racine, 'out'), manifestPath: join(racine, 'bundle.js') } as any)
  b.envMode = dev ? 'dev' : 'prod'
  const journal = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  let st: any
  try {
    st = await b.compile()
  }
  finally {
    [console.log, console.warn, console.error] = journal
  }
  await b.close()
  const prefixe = nom.split('.')[0] + '-'
  const fichier = readdirSync(join(racine, 'out')).find(f => f.startsWith(prefixe) && f.endsWith('.js'))
  return { erreurs: (st.errors ?? []).map((x: any) => String(x?.message ?? x)), out: fichier ? readFileSync(join(racine, 'out', fichier), 'utf8') : '' }
}

const COMMENTES = [`#x = ${Q}a`, '#voir "la doc']

describe('CoffeeScript : `#` collé à un mot ouvre un commentaire, rien n\'est caché', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const ligne of COMMENTES) {
    for (const dev of [true, false]) {
      it(`module .coffee.mjs, ${dev ? 'développement' : 'production'} : « ${ligne} » puis µajax(${Q}/v${Q}) — l'appel est réécrit`, async () => {
        const r = await module('outils.coffee.mjs', `${ligne}\nexport lire = -> µajax(${Q}/v${Q})\nexport y = ${Q}b${Q}\n`, dev)
        assert.deepEqual(r.erreurs, [])
        assert.doesNotMatch(r.out, /µajax\(/, r.out)
        if (dev) assert.match(r.out, /_mjs_ajax\('\/v'\)/, r.out)
      })
    }

    it(`composant CoffeeScript : « ${ligne} » puis µajax(${Q}/v${Q}) — l'appel est réécrit`, async () => {
      const r = await composant('coffee', `${ligne}\nr = µajax(${Q}/v${Q})\ny = ${Q}b${Q}`)
      assert.equal(r.msg, '')
      assert.match(r.out, /_mjs_ajax\('\/v'\)/)
    })

    it(`module .civet.mjs et composant Civet : « ${ligne} » — lu comme Civet le lit, jamais un appel laissé en silence`, async () => {
      const m = await module('outils.civet.mjs', `${ligne}\nexport lire = -> µajax(${Q}/v${Q})\nexport y = ${Q}b${Q}\n`, true)
      assert.ok(m.erreurs.length > 0 || /_mjs_ajax\('\/v'\)/.test(m.out), m.out)
      const c = await composant('', `${ligne}\nr = µajax(${Q}/v${Q})\ny = ${Q}b${Q}`)
      assert.ok(c.msg !== '' || /_mjs_ajax\('\/v'\)/.test(c.out), c.out)
    })
  }

  for (const lang of ['js', 'ts']) {
    it(`lang="${lang}" : un vrai nom privé #x reste un nom`, async () => {
      const r = await composant(lang, 'class A {\n  #x = 1\n  lire() { return this.#x }\n}\n$v = new A().lire()')
      assert.equal(r.msg, '')
      assert.match(r.out, /#x = 1/)
      assert.match(r.out, /this\.#x/)
    })
  }

  for (const lang of ['', 'coffee']) {
    it(`${lang || 'civet'} : regex étendue à interpolation — µajax écrit hors de #{…} reste du texte, sans avertissement`, async () => {
      const r = await composant(lang, `n = 1\nre = ///\n  a#{n}\n  µajax(u)\n///\ns = re.source`)
      assert.equal(r.msg, '')
      assert.deepEqual(r.avertis, [])
      assert.doesNotMatch(r.out, /_mjs_ajax\(u\)/)
      assert.ok(r.out.includes('µajax(u)') || r.out.includes('µajax\\(u\\)'), r.out.split('\n').filter(l => l.includes('ajax')).join('\n'))
      // CoffeeScript interpole lui-même `#{…}` d'une regex étendue (RegExp), Civet le laisse en texte
      if (lang === 'coffee') assert.match(r.out, /RegExp\(/)
      else assert.ok(r.out.includes('#{n}'), r.out)
    })
  }
})
