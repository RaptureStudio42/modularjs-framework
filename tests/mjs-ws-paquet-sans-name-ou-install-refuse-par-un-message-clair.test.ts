// app.use() refuse un paquet sans `name` (un texte non vide) ou sans `install` (une fonction), avant toute installation, avec un message
// qui dit ce qui manque, en français et en anglais. Avant : un paquet sans `install` faisait lever une TypeError obscure
// (« pkg.install is not a function ») et journalisait « install('undefined') a levé » ; un paquet sans `name` s'installait
// sous le nom `undefined`, et un second paquet sans `name` était ensuite ignoré sans bruit
import assert from 'node:assert/strict'
import { mjsWs, definePackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t, setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

async function startApp(logs: string[]): Promise<MjsWsApp> {
  const app = mjsWs({ transport: new MemoryTransport(), heartbeat: 0, onLog: (_level, message) => { logs.push(message) } })
  await app.listen()
  return app
}

// le refus attendu : une TypeError dont le texte est celui du catalogue pour ce qui manque
function refusal(missingName: boolean, missingInstall: boolean): (e: unknown) => boolean {
  return (e: unknown) => e instanceof TypeError && e.message === t('ws.core.package-incomplete', { missingName, missingInstall })
}

describe('app.use() : un paquet sans name ou sans install est refusé par un message clair', () => {
  it('sans install : TypeError qui le dit, rien de journalisé, et le nom reste libre', async () => {
    const logs = [] as string[]
    const app  = await startApp(logs)
    try {
      assert.throws(() => app.use({ name: 'x' } as any), refusal(false, true))
      assert.deepEqual(logs.filter(m => /install|paquet|package/i.test(m)), [], 'aucun « install(…) a levé » au journal : le paquet n\'a jamais été installé')
      let ran = false
      app.use({ name: 'x', install: () => { ran = true } })
      assert.ok(ran, 'le même nom s\'installe une fois le paquet complet')
    }
    finally {
      await app.stop()
    }
  })

  it('sans name, ou un name qui n\'est pas un texte : refusé sans appeler install ; deux paquets sans name ne se masquent plus', async () => {
    const logs = [] as string[]
    const app  = await startApp(logs)
    try {
      let runs = 0
      assert.throws(() => app.use({ install: () => { runs++ } } as any), refusal(true, false))
      assert.throws(() => app.use({ install: () => { runs++ } } as any), refusal(true, false), 'le second est refusé lui aussi, jamais ignoré en silence')
      assert.throws(() => app.use({ name: 42, install: () => { runs++ } } as any), refusal(true, false))
      assert.equal(runs, 0, 'install n\'est jamais appelé')
      assert.deepEqual(logs.filter(m => /install|paquet|package/i.test(m)), [])
    }
    finally {
      await app.stop()
    }
  })

  it('un name vide ou fait de blancs : refusé comme un name absent, sans appeler install ; deux paquets au name vide ne se masquent plus', async () => {
    const logs = [] as string[]
    const app  = await startApp(logs)
    try {
      let runs = 0
      assert.throws(() => app.use({ name: '', install: () => { runs++ } }), refusal(true, false))
      assert.throws(() => app.use({ name: '', install: () => { runs++ } }), refusal(true, false), 'le second est refusé lui aussi, jamais ignoré en silence')
      assert.throws(() => app.use({ name: '   ', install: () => { runs++ } }), refusal(true, false))
      assert.throws(() => app.use(definePackage('', () => { runs++ })), refusal(true, false))
      assert.equal(runs, 0, 'install n\'est jamais appelé')
      assert.deepEqual(logs.filter(m => /install|paquet|package/i.test(m)), [])
    }
    finally {
      await app.stop()
    }
  })

  it('ni name ni install (un paquet écrit avec d\'autres noms, ou absent) : le message nomme les deux, et seulement eux', async () => {
    const app = await startApp([])
    try {
      let ran = false
      assert.throws(() => app.use({ nom: 'x', installer: () => { ran = true } } as any), refusal(true, true))
      assert.throws(() => app.use(undefined as any), refusal(true, true))
      assert.equal(ran, false)
      const text = t('ws.core.package-incomplete', { missingName: true, missingInstall: true })
      assert.doesNotMatch(text, /\bnom\b|\binstaller\b|undefined/, 'aucun autre nom que name et install')
    }
    finally {
      await app.stop()
    }
  })

  it('le message existe en français et en anglais, et dit ce qui manque dans chaque cas', () => {
    const before = getMessagesLang()
    const texts  = new Map<string, string>()
    try {
      for (const lang of ['fr', 'en']) {
        setMessagesLang(lang)
        for (const [missingName, missingInstall] of [[true, false], [false, true], [true, true]]) {
          const text = t('ws.core.package-incomplete', { missingName, missingInstall })
          assert.equal(typeof text, 'string', `${lang} : le message existe`)
          assert.equal(/\bname \(/.test(text), missingName, `${lang} : name nommé seulement s'il manque — ${text}`)
          assert.equal(/\binstall \(/.test(text), missingInstall, `${lang} : install nommé seulement s'il manque — ${text}`)
          assert.match(text, /definePackage\('/, `${lang} : la forme à écrire est donnée`)
          texts.set(`${lang} ${missingName} ${missingInstall}`, text)
        }
      }
      assert.notEqual(texts.get('fr true true'), texts.get('en true true'), 'deux langues, deux textes')
      assert.match(texts.get('fr true true') as string, /écrivez/, 'le français vouvoie')
    }
    finally {
      setMessagesLang(before)
    }
  })
})
