// @confirm={ text: µt('…') } et @title={ text: µt('…') } : la forme OBJET accepte un appel µt(…) pour
// ses textes (text/ok/cancel pour @confirm, text pour @title), mêlé ou non à des chaînes littérales.
// Rien d'autre n'y est ouvert (variable, concaténation, autre appel : erreur du build). Le texte suit
// la langue : après une bascule µlang, le prochain clic (@confirm) ou survol (@title) montre la
// nouvelle langue. Volet compile (transpile direct) puis volet navigateur (Bundler réel + happy-dom,
// dictionnaires fr/en servis par le build), même patron que tests/i18n-e2e.test.ts.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { renderToString, stripEsm, fileToId, ssrScopeFile, topoSortFiles } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function compiler(corps: string): Promise<string> {
  const src = `<script lang="civet">\nx := 0\n</script>\n${corps}`
  const { output } = await transpile(src, { moduleName: 'essai' })
  return output
}

// attribut `nom` de la première balise du gabarit émis, décodé (&quot; &#123; &#125;)
function attributEmis(output: string, nom: string): string {
  const m = output.match(new RegExp(`${nom}='([^']*)'`))
  assert.ok(m, `attribut ${nom} introuvable dans le gabarit`)
  return m![1].replace(/&quot;/g, '"').replace(/&#123;/g, '{').replace(/&#125;/g, '}')
}

describe('@confirm / @title forme objet — compile', () => {
  it('(1) @confirm={ text: µt(…), ok: µt(…) } compile en attribut dynamique qui fabrique le JSON', async () => {
    const out = await compiler(`<button @confirm={ text: µt('q'), ok: µt('ok') }>a</button>`)
    assert.match(out, /_mjs_updAttr\('a1', 'mjs-confirm', JSON\.stringify\(\{ text: µ\.t\('q'\), ok: µ\.t\('ok'\) \}\)(?:, 1)?\)/)
  })

  it('(2) @title={ text: µt(…), side: \'top\' } : texte dynamique, réglages littéraux dans mjs-title-conf', async () => {
    const out = await compiler(`<span @title={ text: µt('aide'), side: 'top', delay: 200 }>a</span>`)
    assert.match(out, /_mjs_updAttr\('a1', 'mjs-title', µ\.t\('aide'\)(?:, 1)?\)/)
    assert.deepEqual(JSON.parse(attributEmis(out, 'mjs-title-conf')), { side: 'top', delay: 200 })
  })

  it('(3) objet mêlé : littéral et µt dans le même objet, µt avec variables', async () => {
    const c = await compiler(`<button @confirm={ text: µt('q', { n: 2 }), ok: 'OK' }>a</button>`)
    assert.match(c, /JSON\.stringify\(\{ text: µ\.t\('q', \{ n: 2 \}\), ok: "OK" \}\)/)
    const t = await compiler(`<span @title={ side: 'bottom', text: µt('aide') }>a</span>`)
    assert.match(t, /'mjs-title', µ\.t\('aide'\)/)
    assert.deepEqual(JSON.parse(attributEmis(t, 'mjs-title-conf')), { side: 'bottom' })
  })

  it('(4) objet tout littéral : sortie compilée identique, octet pour octet, à celle d\'avant', async () => {
    const c = await compiler(`<button @confirm={ text: 'Archiver ?', ok: 'Archiver', cancel: 'Non' }>a</button>`)
    assert.ok(c.includes(`_mjs_cloneTpl("<button mjs-confirm='&#123;&quot;text&quot;:&quot;Archiver ?&quot;,&quot;ok&quot;:&quot;Archiver&quot;,&quot;cancel&quot;:&quot;Non&quot;&#125;'>a</button>")`))
    // empreintes de la sortie entière, où le fragment du gabarit se nomme _mjs_fr
    assert.equal(createHash('sha256').update(c).digest('hex'), '414191fbe442373a0368ddb34927f383caaf71181f1c2b344dbd7bc1f8385a55')
    const t = await compiler(`<span @title={ text: 'Aide', side: 'top', delay: 200 }>a</span>`)
    assert.ok(t.includes(`_mjs_cloneTpl("<span mjs-title='Aide' mjs-title-conf='&#123;&quot;side&quot;:&quot;top&quot;,&quot;delay&quot;:200&#125;'>a</span>")`))
    assert.equal(createHash('sha256').update(t).digest('hex'), '978a39d28871365f09846486080fdde567e973952479c162444e49d0e1bfe010')
  })

  it('(5) variable, concaténation, autre appel : erreur du build, message qui cite µt(…) (confirm et title)', async () => {
    const cas = [
      `<button @confirm={ text: maVar }>a</button>`,
      `<button @confirm={ text: µt('a') + 'b' }>a</button>`,
      `<button @confirm={ text: 'a' + µt('b') }>a</button>`,
      `<button @confirm={ text: autre('a') }>a</button>`,
      `<button @confirm={ text: µt('a') ok: 'x' y }>a</button>`,
      `<button @confirm={ text: µt('a'), ok: µt('b' }>a</button>`,
      `<span @title={ text: maVar }>a</span>`,
      `<span @title={ text: µt('a') + 'b' }>a</span>`,
      `<span @title={ text: µt('a'), side: µt('b') }>a</span>`,
      `<span @title={ text: 'a', delay: µt('b') }>a</span>`,
      `<span @title={ text: autre('a') }>a</span>`
    ]
    for (const corps of cas) {
      await assert.rejects(() => compiler(corps), (e: any) => {
        assert.match(e.message, /objet-invalide|forme objet invalide|invalid object form/i, corps)
        assert.match(e.message, /µt\(/, `le message doit citer µt(…) : ${corps}`)
        return true
      })
    }
  })

  it('messages fr et en : même texte de règle, µt(…) cité avec un exemple', async () => {
    const { fr } = await import('../src/messages/fr.js') as any
    const { en } = await import('../src/messages/en.js') as any
    for (const cle of ['transpiler.confirm-objet-invalide', 'transpiler.title-objet-invalide']) {
      for (const cat of [fr, en]) {
        const m = cat[cle]({ raw: 'R' })
        assert.match(m, /µt\('/, `${cle} doit donner un exemple µt('…')`)
      }
    }
  })
})

function dictionnaires(srcDir: string): void {
  const dir = join(srcDir, 'i18n')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'fr.json'), JSON.stringify({
    q:     'Archiver cette conversation ?',
    ok:    'Archiver',
    aide:  'Aide',
    mixte: 'Question mêlée ?',
    spec:  'Qu\'en dites-vous "vraiment" <b>x</b> & plus {a} ?'
  }))
  writeFileSync(join(dir, 'en.json'), JSON.stringify({
    q:     'Archive this conversation?',
    ok:    'Archive',
    aide:  'Help',
    mixte: 'Mixed question?',
    spec:  'What do you say "really" <i>y</i> & more {a}?'
  }))
}

async function monter(sources: Record<string, string>) {
  const root   = mjsTmp('confirm-title-objet')
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  dictionnaires(srcDir)
  for (const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, `${nom}.mjs`), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' }, runtime: 'all' })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const window: any = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  const files = readdirSync(outDir).filter((f: string) => f.endsWith('.js'))
  const coreFile = files.find((f: string) => /^mjs_core-/.test(f))!
  const raw = readFileSync(join(root, 'bundle.js'), 'utf-8')
  const bodyStart = raw.indexOf('const µReady = ')
  const bodyMatch = raw.match(/const µReady = import\(µCore\)\.then\(async \(\{ µ \}\) => \{\n([\s\S]*)\n\}\);\nif \(typeof window/)
  assert.ok(bodyMatch, 'corps du manifeste introuvable')
  const manifestSrc = [stripEsm(raw.slice(0, bodyStart)), bodyMatch![1]].join('\n').replace(/window\.µ\s*=\s*µ;?/, '')
  const coreCode = stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))
  const otherFiles = files.filter((f: string) => f !== coreFile)
  const idByFile = new Map(otherFiles.map((f: string) => [f, fileToId(f)]))
  const resolve = (url: string): string | null => idByFile.get(url.split('/').pop() || '') ?? null
  const scoped = otherFiles.map((f: string) => {
    const id = idByFile.get(f)!
    const { code, deps } = ssrScopeFile(readFileSync(join(outDir, f), 'utf-8'), id, resolve)
    return { f, id, code, deps }
  })
  const depsById = new Map(scoped.map((s: any) => [s.id, s.deps]))
  const idToFile = new Map(scoped.map((s: any) => [s.id, s.f]))
  const codeById = new Map(scoped.map((s: any) => [s.id, s.code]))
  const sortedIds = topoSortFiles(scoped.map((s: any) => s.id), depsById, idToFile)
  const componentCode = sortedIds.map((id: string) => codeById.get(id)!).join('\n')

  window.__mjsI18nImport = async (url: string) => {
    const f = join(outDir, String(url).split('/').pop()!)
    assert.ok(existsSync(f), `fichier de langue absent : ${url}`)
    return { default: JSON.parse(readFileSync(f, 'utf-8').replace(/^export default /, '').replace(/;\s*$/, '')) }
  }
  window.eval(`${coreCode}\nµ._i18nImport = globalThis.__mjsI18nImport;\n${manifestSrc}\nglobalThis.µ = µ;\nµ.config.title.delay = 10;\n${componentCode}`)

  const insert = (nom: string): any => {
    document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    return document.body.querySelector(`mjs-${nom}`)
  }
  return { window, document, insert }
}

describe('@confirm / @title forme objet avec µt(…) — navigateur (happy-dom)', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('(1) @confirm : la boîte montre le texte fr, puis le texte en après la bascule', async () => {
    const { window, insert } = await monter({
      conf: `<button class="b" @confirm={ text: µt('q'), ok: µt('ok') }>a</button>`
    })
    const el = insert('conf')
    await sleep(150)
    const questions: any[] = []
    window.µ.config.confirm = true
    window.µ.modal = { fire: (o: any) => { questions.push(o); return Promise.resolve({ isConfirmed: false }) } }
    el._shadow.querySelector('.b').click()
    await sleep(30)
    assert.equal(questions.length, 1)
    assert.equal(questions[0].text, 'Archiver cette conversation ?')
    assert.equal(questions[0].confirmButtonText, 'Archiver')

    window.µ.store.__mjsLang = 'en'
    await sleep(150)
    el._shadow.querySelector('.b').click()
    await sleep(30)
    assert.equal(questions.length, 2)
    assert.equal(questions[1].text, 'Archive this conversation?')
    assert.equal(questions[1].confirmButtonText, 'Archive')
  })

  it('(2) @title : la bulle montre le texte fr, puis le texte en après la bascule (side littéral gardé)', async () => {
    const { window, document, insert } = await monter({
      tit: `<span class="s" @title={ text: µt('aide'), side: 'top' }>a</span>`
    })
    const el = insert('tit')
    await sleep(150)
    const survoler = async (): Promise<string> => {
      const s = el._shadow.querySelector('.s')
      s.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, composed: true }))
      await sleep(60)
      const b = document.querySelector('.mjs-title-visible') ?? el._shadow.querySelector('.mjs-title-visible')
      const texte = b ? b.textContent : ''
      s.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, composed: true }))
      await sleep(30)
      return texte
    }
    assert.equal(await survoler(), 'Aide')
    window.µ.store.__mjsLang = 'en'
    await sleep(150)
    assert.equal(await survoler(), 'Help')
    assert.equal(JSON.parse(el._shadow.querySelector('.s').getAttribute('mjs-title-conf')).side, 'top')
  })

  it('(3) objet mêlé : µt pour text, littéral pour ok, les deux restent justes après la bascule', async () => {
    const { window, insert } = await monter({
      mix: `<button class="b" @confirm={ text: µt('mixte'), ok: 'OK' }>a</button>`
    })
    const el = insert('mix')
    await sleep(150)
    const lire = () => JSON.parse(el._shadow.querySelector('.b').getAttribute('mjs-confirm'))
    assert.deepEqual(lire(), { text: 'Question mêlée ?', ok: 'OK' })
    window.µ.store.__mjsLang = 'en'
    await sleep(150)
    assert.deepEqual(lire(), { text: 'Mixed question?', ok: 'OK' })
  })

  it('(6) caractères spéciaux (apostrophe, guillemet, <, &, accolades) : texte tel quel, aucun HTML injecté', async () => {
    const { window, document, insert } = await monter({
      spec: `<button class="b" @confirm={ text: µt('spec') } @title={ text: µt('spec') }>a</button>`
    })
    const el = insert('spec')
    await sleep(150)
    const b = el._shadow.querySelector('.b')
    assert.equal(JSON.parse(b.getAttribute('mjs-confirm')).text, 'Qu\'en dites-vous "vraiment" <b>x</b> & plus {a} ?')
    assert.equal(b.getAttribute('mjs-title'), 'Qu\'en dites-vous "vraiment" <b>x</b> & plus {a} ?')
    b.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, composed: true }))
    await sleep(60)
    const bulle = document.querySelector('.mjs-title-visible') ?? el._shadow.querySelector('.mjs-title-visible')
    assert.ok(bulle, 'bulle affichée')
    assert.equal(bulle.textContent, 'Qu\'en dites-vous "vraiment" <b>x</b> & plus {a} ?')
    assertAbsent(bulle.querySelector('b'), 'aucune balise injectée dans la bulle')
    window.µ.store.__mjsLang = 'en'
    await sleep(150)
    assert.equal(JSON.parse(b.getAttribute('mjs-confirm')).text, 'What do you say "really" <i>y</i> & more {a}?')
    assertAbsent(b.querySelector('i'))
  })

  it('(7) prérendu : les attributs sortent dans la langue de la page, fr par défaut, en sur une page en', async () => {
    const root   = mjsTmp('confirm-title-objet-ssr')
    const srcDir = join(root, 'app')
    mkdirSync(srcDir, { recursive: true })
    dictionnaires(srcDir)
    writeFileSync(join(srcDir, 'pre.mjs'), `<button class="b" @confirm={ text: µt('q'), ok: 'OK' } @title={ text: µt('aide'), side: 'top' }>a</button>`)
    const decoder = (h: string) => h.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    const fr = await renderToString({ sourceDir: srcDir, tag: 'mjs-pre', i18n: { default: 'fr' } })
    assert.match(decoder(fr.html), /mjs-confirm="\{"text":"Archiver cette conversation \?","ok":"OK"\}"/)
    assert.match(fr.html, /mjs-title="Aide"/)
    const en = await renderToString({ sourceDir: srcDir, tag: 'mjs-pre', i18n: { default: 'fr' }, store: { __mjsLang: 'en' } })
    assert.match(decoder(en.html), /mjs-confirm="\{"text":"Archive this conversation\?","ok":"OK"\}"/)
    assert.match(en.html, /mjs-title="Help"/)
  })
})
