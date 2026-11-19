// `µinspect` oublié dans le code livré : la construction de production l'embarque, et un avertissement nomme le fichier de l'appli qui
// l'appelle, au premier tour comme au tour suivant (unité reprise du cache). Un texte qui le cite (chaîne, exemple affiché dans un `<pre>`,
// commentaire) n'est pas un appel : ni avertissement, ni module embarqué. Un module du cœur (catalogue du framework, installé ou non sous
// `node_modules`) ne fait rien dire ; la construction de développement non plus
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CAS: Record<string, string> = {
  sucre:     '<script>\n$n = 0\nµinspect $n\n</script>\n<button @click={$n++}>{$n}</button>\n',
  verbeux:   "<script>\n$n = 0\nµ.inspect('n')\n</script>\n<button @click={$n++}>{$n}</button>\n",
  siDebug:   '<script>\n$n = 0\nif µ.debugMode\n  µinspect $n\n</script>\n<p>{$n}</p>\n',
  chaine:    "<script>\n$s = 'appel µ.inspect(x) dans une chaîne'\n</script>\n<p>{$s}</p>\n",
  pre:       "<pre><span class=\"comment\"># équivalent verbeux : µ.inspect('count')</span></pre>\n",
  preSucre:  '<pre>µinspect $count</pre>\n',
  diese:     "<script>\n$n = 0\n# µinspect $n\n# µ.inspect('n')\n</script>\n<p>{$n}</p>\n",
  bloc:      "<script>\n$n = 0\n###\nµ.inspect('n')\n###\n</script>\n<p>{$n}</p>\n"
}

// une construction : les avertissements µinspect de chaque tour, et si le module µinspect part (sa trace console.group)
async function construire(page: string, env: 'dev' | 'prod', tours: number, coeur?: string): Promise<{ avertis: string[][], embarque: boolean }> {
  const root = mjsTmp(`inspect-production-${env}`)
  const src  = join(root, 'src')
  const out  = join(root, 'public')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'compteur.mjs'), page)
  const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env, ...(coeur ? { coreModulesDir: coeur } : {}) } as any)
  const garde = { log: console.log, warn: console.warn }
  const avertis: string[][] = []
  try {
    console.log = console.warn = () => {}
    for (let i = 0; i < tours; i++) {
      const stats = await b.compile()
      assert.deepEqual(stats.errors, [])
      avertis.push(stats.warnings.filter((w) => w.includes('µinspect')))
    }
  }
  finally {
    Object.assign(console, garde)
    await b.close()
  }
  const js = readdirSync(out).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(out, f), 'utf-8')).join('\n')
  return { avertis, embarque: /console\.group\b/.test(js) }
}

// un catalogue du cœur à un seul module, `<@@outil>`, qui appelle µinspect
function catalogue(dossier: string): string {
  mkdirSync(dossier, { recursive: true })
  writeFileSync(join(dossier, 'outil.mjs'), '<script>\n$n = 0\nµinspect $n\n</script>\n<p>{$n}</p>\n')
  return dossier
}

describe('construction — µinspect dans une construction de production', function () {
  this.timeout(180000)
  afterEach(() => setMessagesLang('fr'))

  it('appel par le sucre : un avertissement nomme le fichier, au premier tour et au tour suivant', async () => {
    setMessagesLang('fr')
    const { avertis: [premier, second], embarque } = await construire(CAS.sucre, 'prod', 2)
    assert.equal(premier.length, 1, premier.join('\n'))
    assert.match(premier[0], /µinspect reste dans le code de cette construction de production \([^)]*src\/compteur\.mjs\)/)
    assert.deepEqual(second, premier)
    assert.equal(embarque, true)
  })

  for (const nom of ['verbeux', 'siDebug']) {
    it(`vrai appel (${nom}) : un avertissement`, async () => {
      const { avertis: [premier], embarque } = await construire(CAS[nom], 'prod', 1)
      assert.equal(premier.length, 1, premier.join('\n'))
      assert.equal(embarque, true)
    })
  }

  for (const nom of ['chaine', 'pre', 'preSucre', 'diese', 'bloc']) {
    it(`texte qui le cite (${nom}) : ni avertissement, ni module embarqué`, async () => {
      const { avertis: [premier], embarque } = await construire(CAS[nom], 'prod', 1)
      assert.deepEqual(premier, [])
      assert.equal(embarque, false)
    })
  }

  it('développement : aucun avertissement', async () => {
    const { avertis: [premier] } = await construire(CAS.sucre, 'dev', 1)
    assert.deepEqual(premier, [])
  })

  for (const ou of ['coeur', 'node_modules/modularjs-framework/src/core-modules']) {
    it(`module du cœur qui l'appelle (${ou}) : aucun avertissement`, async () => {
      const coeur = catalogue(join(mjsTmp('inspect-production-coeur'), ou))
      const { avertis: [premier], embarque } = await construire('<@@outil></@@outil>\n', 'prod', 1, coeur)
      assert.deepEqual(premier, [])
      assert.equal(embarque, true)
    })
  }
})
