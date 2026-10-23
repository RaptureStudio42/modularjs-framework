// <@@select> : sur la liste FERMÉE, les flèches droite et gauche choisissent l'option suivante et la précédente, et la flèche haute l'ouvre comme la basse, avec de vraies touches, dans
// Chromium, Firefox et WebKit réels, en développement comme avec un vrai build de production (avec, puis sans, le morceau « Autre » : un
// build dont aucune page n'écrit `other` ne le porte pas).
// - le choix vaut celui de la souris : la liste reste fermée, le bouton dit le nouveau choix, la variable liée suit, `change` part une fois
//   et le champ du formulaire est déjà à jour quand il joue ; aux bords, rien ;
// - liste ouverte, les flèches gardent leur rôle : le curseur du champ de recherche ou de réponse libre se déplace, rien d'autre ne bouge ;
// - choix multiple : rien ; « Autre… » : la flèche saute la ligne et ne l'ouvre pas ; une réponse libre donnée n'est pas remplacée ;
// - page écrite de droite à gauche : comme un <select> natif de la même page, la droite reste « suivant » (le natif ne s'inverse dans aucun des trois moteurs) ;
// - la flèche haute ouvre la liste fermée comme la basse : même ligne active à l'ouverture (l'option choisie, ou « Autre… » quand une réponse libre est donnée),
//   rien n'est choisi, le choix multiple compris ; avec Maj, Ctrl, Alt ou Méta enfoncé, elle ouvre aussi, comme la basse (Alt + flèche ouvre une liste native).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const PAYS = '<@@option value="fr">France</@@option><@@option value="de">Allemagne</@@option><@@option value="us">États-Unis</@@option>'

const AUTRE = `
  <@@select class="libre" name="libre" other value="de">${PAYS}</@@select>
  <@@select class="donnee" name="donnee" other value="Zed">${PAYS}</@@select>
  <@@select class="saisie" name="saisie" other value="de">${PAYS}</@@select>
  <@@select class="hautdonnee" name="hautdonnee" other value="Zed">${PAYS}</@@select>
  <@@select class="basdonnee" name="basdonnee" other value="Zed">${PAYS}</@@select>`

// ce que le formulaire enverrait, lu PENDANT l'évènement ; le bloc à droite du formulaire est écrit de droite à gauche, avec un <select> natif pour comparer
const hote = (avecAutre: boolean) => `<script>
  $lus = []
  $lie = 'de'

  @lire = (e)->
    champs = Array.from(new FormData(e.target.closest('form'))).map((p)-> p[0] + '=' + p[1])
    $lus   = [...$lus, { qui: e.target.className.split(' ')[0], type: e.type, data: e.data, champs }]
</script>

<form class="f" @noUJS @change={@lire(e)} @other={@lire(e)}>
  <@@select class="simple" name="pays" value="de">${PAYS}</@@select>
  <@@select class="lie" name="lie" value=!{$lie}>${PAYS}</@@select>
  <@@select class="vide" name="vide">${PAYS}</@@select>
  <@@select class="multi" name="multi" multiple value={['de']}>${PAYS}</@@select>
  <@@select class="ouverte" name="ouverte" value="de">${PAYS}</@@select>
  <@@select class="cherche" name="cherche" search value="de">${PAYS}</@@select>
  <@@select class="modifs" name="modifs" value="de">${PAYS}</@@select>
  <@@select class="haut" name="haut" value="de">${PAYS}</@@select>
  <@@select class="bas" name="bas" value="de">${PAYS}</@@select>
  <@@select class="hautmulti" name="hautmulti" multiple value={['de']}>${PAYS}</@@select>${avecAutre ? AUTRE : ''}
</form>

<div dir="rtl">
  <@@select class="rtl" name="rtl" value="de">${PAYS}</@@select>
  <select class="natif"><option value="fr">France</option><option value="de" selected>Allemagne</option><option value="us">États-Unis</option></select>
</div>
`

type Scenario = { nom: string; build: 'dev' | 'prod'; autre: boolean }

const SCENARIOS: Scenario[] = [
  { nom: 'développement', build: 'dev', autre: true },
  { nom: 'production, une page écrit other', build: 'prod', autre: true },
  { nom: 'production, aucune page n\'écrit other', build: 'prod', autre: false }
]

type Construit = { dev: string; prod: Record<'avec' | 'sans', Map<string, Buffer>> }
let construit: Promise<Construit> | null = null

// le script de développement et les deux builds de production, une seule fois pour les trois navigateurs
function construire(): Promise<Construit> {
  construit ??= (async () => {
    const root = mjsTmp('select-fleches')
    const compiler = async (nom: string, source: string, opts: Record<string, unknown>) => {
      const srcDir = join(root, nom, 'src')
      const outDir = join(root, nom, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), source)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), ...opts } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      return outDir
    }
    const devDir = await compiler('dev', hote(true), {})
    const files  = readdirSync(devDir).filter((f) => f.endsWith('.js'))
    const ordre  = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    const dev    = ordre.map((f) => stripEsm(readFileSync(join(devDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(devDir, 'bundle.js'))
    const prod: Construit['prod'] = { avec: new Map(), sans: new Map() }
    for (const [cle, autre] of [['avec', true], ['sans', false]] as const) {
      const dir = await compiler(`prod-${cle}`, hote(autre), { runtime: ['hydrate'], js: 'split', env: 'prod' })
      for (const f of readdirSync(dir)) if (/\.(js|json)$/.test(f)) prod[cle].set(f, readFileSync(join(dir, f)))
      const morceau = [...prod[cle].keys()].find((f) => /^core-select-/.test(f))
      assert.ok(morceau, 'le build de production sépare un morceau par module')
      assert.equal(/select-other-edit/.test(prod[cle].get(morceau!)!.toString('utf-8')), autre, autre ? 'une page écrit other : le morceau « Autre » est là' : 'aucune page n\'écrit other : le morceau « Autre » est retiré')
    }
    return { dev, prod }
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> — flèches, liste fermée (${nom} réel)`, function () {
  this.timeout(240000)
  let present = false
  let browser: any
  let page: any
  let contenu = ''
  let fait: Construit
  let courant: Scenario = SCENARIOS[0]
  const erreurs: string[] = []

  const lire    = (expr: string) => page.evaluate(`(() => { return ${expr} })()`)
  const coque   = (cls: string) => `__q('.${cls}')._shadow`
  const lus     = async () => await lire(`document.querySelector('mjs-hote')._state.lus`) as Array<{ qui: string; type: string; data: any; champs: string[] }>
  const de      = async (cls: string, type = 'change') => (await lus()).filter((l) => l.qui === cls && l.type === type)
  const valeur  = (cls: string) => lire(`__q('.${cls}')._state.value`)
  const libelle = (cls: string) => lire(`${coque(cls)}.querySelector('.select-label').textContent.trim()`)
  const ferme   = (cls: string) => lire(`${coque(cls)}.querySelector('.select-btn').getAttribute('aria-expanded') === 'false' && !${coque(cls)}.querySelector('.select-panel')`)

  // la liste fermée prend le focus du clavier, comme après un Tab ; la touche part du vrai clavier
  const focaliser = (cls: string) => page.evaluate(`${coque(cls)}.querySelector('.select-btn').focus()`)

  async function presser(cls: string, ...touches: string[]) {
    await focaliser(cls)
    for (const t of touches) {
      await page.keyboard.press(t)
      await page.waitForTimeout(100)
    }
  }

  async function ouvrir(cls: string) {
    await page.evaluate(`${coque(cls)}.querySelector('.select-btn').click()`)
    await page.waitForFunction(`${coque(cls)}.querySelector('.select-panel')`, null, { timeout: 30000 })
  }

  // Échap ferme la liste (et le champ de réponse libre d'abord), où que soit le focus
  async function refermer(cls: string) {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForFunction(`!${coque(cls)}.querySelector('.select-panel')`, null, { timeout: 30000 })
  }

  async function charger(sc: Scenario) {
    courant = sc
    const script = sc.build === 'dev' ? `<script>${fait.dev}</script>` : '<script type="module" src="/out/bundle.js"></script>'
    contenu = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote>\n${script}</body></html>`
    erreurs.length = 0
    await page.goto('http://select.test/page', { waitUntil: 'load' })
    const attendus = 11 + (sc.autre ? 5 : 0)
    await page.waitForFunction(`(() => {
      const h = document.querySelector('mjs-hote')
      const m = h && h._shadow ? Array.from(h._shadow.querySelectorAll('mjs-core-select')) : []
      return m.length === ${attendus} && m.every((x) => x.matches(':defined') && !x.hasAttribute('mjs-loading') && x._shadow && x._shadow.querySelector('.select-btn'))
    })()`, undefined, { timeout: 60000 })
    await page.evaluate(`window.__q = (s) => document.querySelector('mjs-hote')._shadow.querySelector(s)`)
    await page.waitForTimeout(400)
  }

  before(async () => {
    const playwright = await import('playwright')
    present = existsSync(playwright[nom].executablePath())
    if (!present) return
    fait    = await construire()
    browser = await playwright[nom].launch()
    page    = await browser.newPage({ viewport: { width: 900, height: 900 } })
    await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', (e: any) => erreurs.push(String(e.message).slice(0, 200)))
    await page.route('http://select.test/**', async (route: any) => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/out/')) {
        const corps = fait.prod[courant.autre ? 'avec' : 'sans'].get(url.pathname.slice(5))
        if (!corps) { await route.fulfill({ status: 404, body: '' }); return }
        await route.fulfill({ status: 200, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: corps })
        return
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: contenu })
    })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const sc of SCENARIOS) describe(sc.nom, function () {
    before(async function () {
      if (!present) { this.skip(); return }
      await charger(sc)
    })

    // le script de développement est collé dans la page : son manifeste tente d'importer ses morceaux, qui n'existent pas à part (comme dans les tests voisins)
    afterEach(function () {
      if (present) assert.deepEqual(erreurs.filter((e) => sc.build === 'prod' || !/dynamically imported|Importing a module script failed/.test(e)), [], 'aucune erreur de page')
    })

    it('droite : l\'option suivante, liste fermée, un seul change avec le champ déjà à jour ; au bord, rien ; gauche : la précédente', async function () {
      if (!present) { this.skip(); return }
      await presser('simple', 'ArrowRight')
      assert.deepEqual((await de('simple')).map((l) => [l.data, l.champs.filter((c) => c.startsWith('pays='))]), [['us', ['pays=us']]], 'un change, déjà avec le champ d\'après')
      assert.equal(await valeur('simple'), 'us')
      assert.equal(await libelle('simple'), 'États-Unis', 'le bouton dit le nouveau choix')
      assert.equal(await ferme('simple'), true, 'la liste reste fermée')
      await presser('simple', 'ArrowRight')
      assert.equal((await de('simple')).length, 1, 'au bord : rien, pas de retour à la première option')
      await presser('simple', 'ArrowLeft', 'ArrowLeft')
      assert.deepEqual((await de('simple')).map((l) => l.data), ['us', 'de', 'fr'])
      assert.deepEqual((await de('simple')).at(-1)!.champs.filter((c) => c.startsWith('pays=')), ['pays=fr'])
      await presser('simple', 'ArrowLeft')
      assert.equal((await de('simple')).length, 3, 'au bord : rien, pas de retour à la dernière option')
      assert.equal(await valeur('simple'), 'fr')
      assert.equal(await ferme('simple'), true)
    })

    it('valeur liée value=!{…} : la variable suit chaque flèche', async function () {
      if (!present) { this.skip(); return }
      await presser('lie', 'ArrowRight')
      assert.equal(await lire(`document.querySelector('mjs-hote')._state.lie`), 'us')
      await presser('lie', 'ArrowLeft')
      assert.equal(await lire(`document.querySelector('mjs-hote')._state.lie`), 'de')
      assert.deepEqual((await de('lie')).map((l) => l.data), ['us', 'de'])
    })

    it('rien de choisi : la gauche ne fait rien, la droite choisit la première option', async function () {
      if (!present) { this.skip(); return }
      await presser('vide', 'ArrowLeft')
      assert.equal((await de('vide')).length, 0)
      await presser('vide', 'ArrowRight')
      assert.deepEqual((await de('vide')).map((l) => l.data), ['fr'])
    })

    it('choix multiple : les flèches ne font rien', async function () {
      if (!present) { this.skip(); return }
      await presser('multi', 'ArrowRight', 'ArrowLeft')
      assert.equal((await de('multi')).length, 0)
      assert.deepEqual(await valeur('multi'), ['de'])
      assert.equal(await ferme('multi'), true)
    })

    it('Maj ou Ctrl enfoncé : rien, la touche reste au navigateur', async function () {
      if (!present) { this.skip(); return }
      await presser('modifs', 'Shift+ArrowRight', 'Control+ArrowRight', 'Shift+ArrowLeft', 'Control+ArrowLeft')
      assert.equal((await de('modifs')).length, 0)
      assert.equal(await valeur('modifs'), 'de')
    })

    it('haut : la flèche haute ouvre la liste fermée comme la basse, sur la même ligne active, sans rien choisir', async function () {
      if (!present) { this.skip(); return }
      for (const [cls, touche] of [['bas', 'ArrowDown'], ['haut', 'ArrowUp']] as const) {
        await presser(cls, touche)
        assert.equal(await lire(`__q('.${cls}')._state.open`), true, `${cls} : la liste est ouverte`)
        assert.equal(await lire(`${coque(cls)}.querySelector('.select-btn').getAttribute('aria-expanded')`), 'true', `${cls} : le bouton le dit`)
        assert.equal(await lire(`__q('.${cls}')._state.activeIndex`), 1, `${cls} : la ligne active est l'option choisie`)
        assert.equal(await valeur(cls), 'de', `${cls} : le choix ne bouge pas`)
        assert.equal((await de(cls)).length, 0, `${cls} : aucun change`)
        await refermer(cls)
      }
    })

    it('choix multiple : la flèche haute ouvre la liste, sans rien changer', async function () {
      if (!present) { this.skip(); return }
      await presser('hautmulti', 'ArrowUp')
      assert.equal(await lire(`__q('.hautmulti')._state.open`), true)
      assert.deepEqual(await valeur('hautmulti'), ['de'])
      assert.equal((await de('hautmulti')).length, 0)
      await refermer('hautmulti')
    })

    it('flèche haute avec Maj, Ctrl, Alt ou Méta enfoncé : elle ouvre la liste comme la basse avec les mêmes touches, sans rien choisir', async function () {
      if (!present) { this.skip(); return }
      for (const modif of ['Shift', 'Control', 'Alt', 'Meta']) {
        const lignes: number[] = []
        for (const touche of ['ArrowDown', 'ArrowUp']) {
          await presser('modifs', `${modif}+${touche}`)
          assert.equal(await lire(`__q('.modifs')._state.open`), true, `${modif}+${touche} : la liste est ouverte`)
          assert.equal(await valeur('modifs'), 'de', `${modif}+${touche} : le choix ne bouge pas`)
          lignes.push(await lire(`__q('.modifs')._state.activeIndex`))
          await refermer('modifs')
        }
        assert.equal(lignes[0], lignes[1], `${modif} : même ligne active, haute et basse`)
      }
      assert.equal((await de('modifs')).length, 0)
    })

    it('liste ouverte sans recherche : droite et gauche ne changent rien', async function () {
      if (!present) { this.skip(); return }
      await focaliser('ouverte')
      await ouvrir('ouverte')
      const active = await lire(`__q('.ouverte')._state.activeIndex`)
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(100)
      assert.equal((await de('ouverte')).length, 0)
      assert.equal(await valeur('ouverte'), 'de')
      assert.equal(await lire(`__q('.ouverte')._state.open`), true, 'la liste reste ouverte')
      assert.equal(await lire(`__q('.ouverte')._state.activeIndex`), active, 'la ligne active ne bouge pas')
      await refermer('ouverte')
    })

    it('liste ouverte avec recherche : droite et gauche déplacent le curseur du champ, le choix et la liste ne bougent pas', async function () {
      if (!present) { this.skip(); return }
      await ouvrir('cherche')
      await page.waitForFunction(`${coque('cherche')}.activeElement === ${coque('cherche')}.querySelector('.select-search')`, null, { timeout: 30000 })
      await page.keyboard.type('ab')
      const curseur = () => lire(`${coque('cherche')}.querySelector('.select-search').selectionStart`)
      assert.equal(await curseur(), 2, 'sanity : le curseur est après « ab »')
      await page.keyboard.press('ArrowLeft')
      assert.equal(await curseur(), 1)
      await page.keyboard.press('ArrowLeft')
      assert.equal(await curseur(), 0)
      await page.keyboard.press('ArrowRight')
      assert.equal(await curseur(), 1)
      assert.equal((await de('cherche')).length, 0)
      assert.equal(await valeur('cherche'), 'de')
      assert.equal(await lire(`__q('.cherche')._state.open`), true)
      await refermer('cherche')
    })

    it('page de droite à gauche : comme le <select> natif voisin, la droite reste « suivant » et la gauche « précédent »', async function () {
      if (!present) { this.skip(); return }
      const natif = () => lire(`document.querySelector('mjs-hote')._shadow.querySelector('.natif').value`)
      await page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.natif').focus()`)
      await page.keyboard.press('ArrowRight')
      await presser('rtl', 'ArrowRight')
      await page.waitForTimeout(100)
      assert.equal(await valeur('rtl'), 'us')
      assert.equal(await natif(), await valeur('rtl'), 'le <select> natif de ce navigateur s\'inverse : revoir le choix fait pour la liste du cœur')
      await page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.natif').focus()`)
      await page.keyboard.press('ArrowLeft')
      await presser('rtl', 'ArrowLeft')
      await page.waitForTimeout(100)
      assert.equal(await valeur('rtl'), 'de')
      assert.equal(await natif(), 'de')
    })

    if (sc.autre) {
      it('« Autre… » : la flèche saute la ligne et ne l\'ouvre pas, la dernière option est le bord', async function () {
        if (!present) { this.skip(); return }
        await presser('libre', 'ArrowRight', 'ArrowRight')
        assert.deepEqual((await de('libre')).map((l) => l.data), ['us'])
        assert.equal((await de('libre', 'other')).length, 0, 'aucune réponse libre ne change')
        assert.equal(await lire(`__q('.libre')._state.otherEditing`), false, 'le champ de réponse libre reste fermé')
        assert.equal(await ferme('libre'), true)
        await presser('libre', 'ArrowLeft')
        assert.deepEqual((await de('libre')).map((l) => l.data), ['us', 'de'])
      })

      it('« Autre… » : avec une réponse libre donnée, la flèche haute ouvre la liste comme la basse, sur la ligne « Autre… »', async function () {
        if (!present) { this.skip(); return }
        for (const [cls, touche] of [['basdonnee', 'ArrowDown'], ['hautdonnee', 'ArrowUp']] as const) {
          await presser(cls, touche)
          assert.equal(await lire(`__q('.${cls}')._state.open`), true, `${cls} : la liste est ouverte`)
          assert.equal(await lire(`__q('.${cls}')._state.activeIndex`), 3, `${cls} : la ligne « Autre… » est active`)
          assert.equal(await lire(`__q('.${cls}')._state.otherEditing`), false, `${cls} : le champ de réponse libre reste fermé`)
          assert.equal(await valeur(cls), 'Zed', `${cls} : la réponse libre reste en place`)
          assert.equal((await de(cls)).length + (await de(cls, 'other')).length, 0, `${cls} : ni change ni other`)
          await refermer(cls)
        }
      })

      it('réponse libre déjà donnée : les flèches ne la remplacent pas', async function () {
        if (!present) { this.skip(); return }
        await presser('donnee', 'ArrowRight', 'ArrowLeft')
        assert.equal((await de('donnee')).length, 0)
        assert.equal((await de('donnee', 'other')).length, 0)
        assert.equal(await valeur('donnee'), 'Zed')
        assert.equal(await libelle('donnee'), 'Zed')
      })

      it('saisie d\'une réponse libre : droite et gauche déplacent le curseur du champ, le choix ne bouge pas', async function () {
        if (!present) { this.skip(); return }
        await ouvrir('saisie')
        await page.evaluate(`${coque('saisie')}.querySelector('.select-other').click()`)
        const champ = `${coque('saisie')}.querySelector('.select-other-input')`
        await page.waitForFunction(`${champ} && ${coque('saisie')}.activeElement === ${champ}`, null, { timeout: 30000 })
        await page.keyboard.type('abc')
        const curseur = () => lire(`${champ}.selectionStart`)
        assert.equal(await curseur(), 3)
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        assert.equal(await curseur(), 1)
        await page.keyboard.press('ArrowRight')
        assert.equal(await curseur(), 2)
        assert.equal((await de('saisie')).length, 0)
        assert.equal(await valeur('saisie'), 'de')
        assert.equal(await lire(`__q('.saisie')._state.otherEditing`), true, 'le champ reste ouvert')
        await refermer('saisie')
      })
    }
  })
})
