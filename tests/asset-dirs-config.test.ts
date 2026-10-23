// `assetDirs` dans mjs.config.json : une liste de dossiers d'images en plus de sourceDir. Chemins relatifs au dossier de
// mjs.config.json comme les autres clés ; un type faux ou un dossier absent est une erreur de configuration claire, qui
// nomme la clé et la valeur ; la clé figure dans la liste des clés valides ; sans la clé, rien ne change.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

// un projet jetable avec les dossiers demandés et le mjs.config.json donné
function projet(config: Record<string, unknown>, dossiers: string[] = []): string {
  const root = mjsTmp('assetdirs-config')
  for (const d of dossiers) mkdirSync(join(root, d), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config))
  return root
}

describe('assetDirs — mjs.config.json', () => {
  afterEach(() => setMessagesLang('fr'))

  it('une liste de dossiers existants est acceptée ; resolveBundlerOpts les rend en chemins absolus, relatifs au dossier de la config', () => {
    const root  = projet({ sourceDir: 'src', assetDirs: ['app/assets/images', 'public/img'] }, ['src', 'app/assets/images', 'public/img'])
    const found = findConfig(root)
    assert.ok(found)
    assert.deepEqual(found!.config.assetDirs, ['app/assets/images', 'public/img'])
    assert.deepEqual(resolveBundlerOpts(found!.config, found!.configDir).assetDirs, [join(root, 'app/assets/images'), join(root, 'public/img')])
  })

  it('un chemin absolu est accepté tel quel', () => {
    const root  = projet({ assetDirs: [] }, [])
    const autre = mjsTmp('assetdirs-config-absolu')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ assetDirs: [autre] }))
    const found = findConfig(root)
    assert.deepEqual(resolveBundlerOpts(found!.config, found!.configDir).assetDirs, [resolve(autre)])
  })

  it('une liste vide est acceptée', () => {
    const found = findConfig(projet({ assetDirs: [] }))
    assert.deepEqual(resolveBundlerOpts(found!.config, found!.configDir).assetDirs, [])
  })

  it('sans la clé, resolveBundlerOpts ne rend aucune liste', () => {
    const found = findConfig(projet({ sourceDir: 'src' }, ['src']))
    assert.equal(resolveBundlerOpts(found!.config, found!.configDir).assetDirs, undefined)
  })

  it('une chaîne au lieu d\'une liste est une erreur de configuration qui nomme la clé et la valeur', () => {
    const root = projet({ assetDirs: 'app/assets/images' }, ['app/assets/images'])
    assert.throws(() => findConfig(root), (e: Error) => /\[mjs\.config\.json\]/.test(e.message) && /assetDirs/.test(e.message) && /liste/.test(e.message) && /app\/assets\/images/.test(e.message) && /string/.test(e.message))
  })

  it('un objet ou un nombre au lieu d\'une liste est une erreur de configuration', () => {
    assert.throws(() => findConfig(projet({ assetDirs: { images: 'x' } })), /assetDirs doit être une liste/)
    assert.throws(() => findConfig(projet({ assetDirs: 42 })), /assetDirs doit être une liste/)
    assert.throws(() => findConfig(projet({ assetDirs: null })), /assetDirs doit être une liste/)
  })

  it('un élément qui n\'est pas un chemin de dossier est une erreur qui nomme sa place dans la liste', () => {
    const root = projet({ assetDirs: ['images', 42] }, ['images'])
    assert.throws(() => findConfig(root), (e: Error) => /assetDirs\[1\]/.test(e.message) && /42/.test(e.message))
    assert.throws(() => findConfig(projet({ assetDirs: [''] })), /assetDirs\[0\]/)
    assert.throws(() => findConfig(projet({ assetDirs: [null] })), /assetDirs\[0\]/)
  })

  it('un dossier absent est une erreur de configuration qui nomme le dossier et le chemin cherché', () => {
    const root = projet({ assetDirs: ['images', 'nexiste/pas'] }, ['images'])
    assert.throws(() => findConfig(root), (e: Error) => /\[mjs\.config\.json\]/.test(e.message) && /assetDirs\[1\]/.test(e.message) && e.message.includes('nexiste/pas') && e.message.includes(join(root, 'nexiste/pas')))
  })

  it('un fichier à la place d\'un dossier est une erreur de configuration', () => {
    const root = projet({ assetDirs: ['image.png'] })
    writeFileSync(join(root, 'image.png'), 'x')
    assert.throws(() => findConfig(root), (e: Error) => /assetDirs\[0\]/.test(e.message) && /dossier/.test(e.message) && e.message.includes('image.png'))
  })

  it('la clé est dans la liste des clés valides que rappelle une clé inconnue', () => {
    const root = projet({ assetDir: ['images'] })
    assert.throws(() => findConfig(root), (e: Error) => /clé inconnue 'assetDir'/.test(e.message) && /Clés valides : .*\bassetDirs\b/.test(e.message))
  })

  it('en anglais, les messages sont en anglais', () => {
    const root = projet({ lang: 'en', assetDirs: 'images' })
    assert.throws(() => findConfig(root), (e: Error) => /assetDirs must be a list/.test(e.message))
    assert.throws(() => findConfig(projet({ lang: 'en', assetDirs: ['nexiste/pas'] })), (e: Error) => /assetDirs\[0\]/.test(e.message) && /does not exist/.test(e.message))
  })
})
