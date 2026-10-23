// Le nom d'un dictionnaire (`i18n/<langue>.yml`, `i18n/<langue>/`) a la forme d'une étiquette de langue : un premier
// sous-libellé de 2 à 8 lettres, puis des sous-libellés de lettres et de chiffres séparés par `-` ou `_` (`fr`, `pt-BR`,
// `zh-Hant`, `zh_Hant`, `reel-fr`). La règle ne demandait que 2 ou 3 lettres au premier : `reel-fr` arrêtait la
// construction. Restent refusés les noms qui ne sont pas une étiquette : `..`, une barre inverse, `__proto__`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projet(nom: string, fichiers: Record<string, string>) {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  for (const [rel, texte] of Object.entries(fichiers)) {
    const p = join(src, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, texte)
  }
  return { root, src, out: join(root, 'out'), man: join(root, 'out', 'bundle.js') }
}

// les messages d'erreur d'une construction (levée comprise)
async function construire(p: { src: string, out: string, man: string }): Promise<string[]> {
  const b = new Bundler({ sourceDir: p.src, outputDir: p.out, manifestPath: p.man, i18n: { default: 'fr' } } as any)
  try {
    const s = await b.compile()
    return s.errors.map((e: any) => e.message)
  }
  catch (e: any) {
    return [e.message]
  }
  finally {
    await b.close()
  }
}

describe('i18n — le nom d\'un dictionnaire a la forme d\'une étiquette de langue', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('reel-fr, pt-BR, zh-Hant et zh_Hant sont des noms de langue : la construction passe et chaque langue a son fichier', async () => {
    const p = projet('i18n-noms-etiquette-permis', {
      'accueil.mjs':               "<p>{µt('titre')}</p>\n",
      'i18n/fr.yml':               'titre: "Bonjour"\n',
      'i18n/reel-fr.yml':          'titre: "Salut"\n',
      'i18n/pt-BR.json':           JSON.stringify({ titre: 'Olá' }),
      'i18n/zh-Hant/section.json': JSON.stringify({ k: '你好' }),
      'i18n/zh_Hant.yml':          'titre: "您好"\n'
    })
    const messages = await construire(p)
    assert.deepEqual(messages, [], 'aucune erreur attendue')
    const sorties = readdirSync(p.out).join(' ')
    for (const langue of ['fr', 'reel-fr', 'pt-BR', 'zh_Hant']) assert.ok(sorties.includes(`mjs_i18n-${langue}-`), `fichier de la langue ${langue} attendu : ${sorties}`)
  })

  for (const [libelle, fichier, nom] of [['« .. »', 'i18n/...json', '..'], ['une barre inverse', 'i18n/fr\\CA.json', 'fr\\CA'], ['« __proto__ »', 'i18n/__proto__.json', '__proto__']]) {
    it(`un nom qui n'est pas une étiquette (${libelle}) arrête la construction, avec une erreur qui le nomme`, async () => {
      const p = projet('i18n-noms-etiquette-refuse', {
        'accueil.mjs':  "<p>{µt('titre')}</p>\n",
        'i18n/fr.json': JSON.stringify({ titre: 'Bonjour' }),
        [fichier]:      JSON.stringify({ titre: 'x' })
      })
      const messages = await construire(p)
      assert.ok(messages.some((m) => m.includes(`'${nom}'`)), `erreur attendue qui nomme ${nom} : ${JSON.stringify(messages)}`)
    })
  }
})
