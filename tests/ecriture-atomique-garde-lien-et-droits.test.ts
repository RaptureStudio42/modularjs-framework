// l'écriture atomique d'un chemin fixe garde ce qu'elle remplace : un lien symbolique reste un lien (le contenu neuf va à sa cible), le
// fichier remplacé garde ses droits (exécutable ou non) ; un fichier neuf prend les droits d'un fichier ordinaire du même dossier. Un lien
// qu'elle ne peut pas suivre (vers un dossier, ou vers un fichier d'un dossier en lecture seule) est refusé sans rien détruire, par un
// message qui nomme le fichier et dit pourquoi, en français et en anglais
import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { writeFileAtomicAlways } from '../src/bundler/outputs.js'
import { setMessagesLang } from '../src/messages/index.js'

const droits = (f: string): string => (statSync(f).mode & 0o7777).toString(8)
const temporaires = (dir: string): string[] => readdirSync(dir).filter((f) => f.includes('.tmp-'))

describe('écriture atomique — lien et droits gardés', () => {
  afterEach(() => setMessagesLang('fr'))

  it('un lien symbolique reste un lien, le contenu neuf est dans sa cible', () => {
    const dir = mjsTmp('atomique-lien')
    writeFileSync(join(dir, 'vrai.js'), 'avant')
    symlinkSync(join(dir, 'vrai.js'), join(dir, 'lien.js'))
    writeFileAtomicAlways(join(dir, 'lien.js'), 'après')
    assert.equal(lstatSync(join(dir, 'lien.js')).isSymbolicLink(), true)
    assert.equal(readFileSync(join(dir, 'vrai.js'), 'utf-8'), 'après')
    assert.deepEqual(temporaires(dir), [])
  })

  for (const mode of [0o755, 0o644]) {
    it(`un fichier en ${mode.toString(8)} le reste`, () => {
      const f = join(mjsTmp('atomique-droits'), 'outil.sh')
      writeFileSync(f, 'avant')
      chmodSync(f, mode)
      writeFileAtomicAlways(f, 'après')
      assert.equal(droits(f), mode.toString(8))
      assert.equal(readFileSync(f, 'utf-8'), 'après')
    })
  }

  it('un fichier neuf prend les droits d\'un fichier ordinaire du même dossier', () => {
    const dir = mjsTmp('atomique-neuf')
    writeFileSync(join(dir, 'temoin.js'), 'x')
    writeFileAtomicAlways(join(dir, 'neuf.js'), 'x')
    assert.equal(droits(join(dir, 'neuf.js')), droits(join(dir, 'temoin.js')))
  })

  for (const [lang, attendu] of [['fr', /« [^»]*lien\.js » n'est pas réécrit : c'est un lien vers le dossier/], ['en', /"[^"]*lien\.js" is not rewritten: it is a link to the folder/]] as const) {
    it(`un lien vers un dossier : refusé, le lien et le dossier intacts, un message qui le dit (${lang})`, () => {
      const dir = mjsTmp('atomique-lien-dossier')
      mkdirSync(join(dir, 'd'))
      symlinkSync(join(dir, 'd'), join(dir, 'lien.js'))
      setMessagesLang(lang)
      assert.throws(() => writeFileAtomicAlways(join(dir, 'lien.js'), 'x'), (e: any) => e.code === 'EISDIR' && attendu.test(e.message))
      assert.equal(lstatSync(join(dir, 'lien.js')).isSymbolicLink(), true)
      assert.deepEqual(readdirSync(join(dir, 'd')), [])
      assert.deepEqual(temporaires(dir), [])
    })
  }

  for (const [lang, attendu] of [['fr', /« [^»]*lien\.js » n'est pas réécrit : c'est un lien vers un fichier du dossier « [^»]*lecture », qui est en lecture seule/], ['en', /"[^"]*lien\.js" is not rewritten: it is a link to a file in the folder "[^"]*lecture", which is read-only/]] as const) {
    it(`un lien vers un fichier d'un dossier en lecture seule : refusé, rien détruit, un message qui le dit (${lang})`, () => {
      const dir = mjsTmp('atomique-lien-lecture-seule')
      mkdirSync(join(dir, 'lecture'))
      writeFileSync(join(dir, 'lecture', 'vrai.js'), 'avant')
      symlinkSync(join(dir, 'lecture', 'vrai.js'), join(dir, 'lien.js'))
      chmodSync(join(dir, 'lecture'), 0o555)
      setMessagesLang(lang)
      try {
        assert.throws(() => writeFileAtomicAlways(join(dir, 'lien.js'), 'après'), (e: any) => e.code === 'EACCES' && attendu.test(e.message))
        assert.equal(lstatSync(join(dir, 'lien.js')).isSymbolicLink(), true)
        assert.equal(readFileSync(join(dir, 'lecture', 'vrai.js'), 'utf-8'), 'avant')
        assert.deepEqual(temporaires(dir), [])
      }
      finally {
        chmodSync(join(dir, 'lecture'), 0o755)
      }
    })
  }
})
