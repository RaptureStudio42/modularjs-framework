// *hologram : le reflet d'une carte survolée ou agrandie revient quand un script réécrit le contenu de sa balise (Chromium et Firefox réels).
// `textContent =`, `innerHTML =` et `innerHTML +=` emportent avec le texte le calque du reflet (et, pour un tour, le dos de la carte) : le reflet ne revenait pas, la carte
// restait nue jusqu'à ce que la souris sorte puis rentre, et une carte agrandie n'avait plus de reflet avant de rentrer. Le reflet est de nouveau là et suit la souris,
// en un seul exemplaire, sans erreur ; au repos la carte est comme sa jumelle que personne n'a touchée (mêmes marques, même style, aucun calque de trop).
// Cinq cartes, une page chacune : le reflet né au survol, la carte agrandie, la carte agrandie qui tourne, le reflet toujours allumé, le style par défaut dont le calque naît à la pose.
// Une application de production (tous les cas) et une de développement (les réécritures de base).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { navigateurPresent, construire, construireProd, ouvrir, boite, agrandit, type Construit } from './helpers/hologramme-zoom.js'

type Pose = { nom: string, reglage: string, zoom: boolean, allume: boolean }

// allume : le calque est là sans geste (le reflet toujours allumé, ou le style par défaut dont le calque naît à la pose)
const POSES: Pose[] = [
  { nom: 'survol', reglage: '(frost)', zoom: false, allume: false },
  { nom: 'zoom',   reglage: '(frost, zoom: true)', zoom: true, allume: false },
  { nom: 'tour',   reglage: '(frost, zoom: spin)', zoom: true, allume: false },
  { nom: 'allume', reglage: '(frost, on: always)', zoom: false, allume: true },
  { nom: 'defaut', reglage: '', zoom: false, allume: true }
]

// la carte sous essai (.a) et sa jumelle que personne ne touche (.t, dessous, posée de la même façon), pour dire ce que le repos doit être
const source = (p: Pose) => `<div class="carte a" *hologram${p.reglage}><b>A</b></div>
<div class="carte t" *hologram${p.reglage}><b>A</b></div>
<style>
.carte
  width: 200px
  height: 280px
  margin: 60px 0 0 60px
  border-radius: 10px
  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)
  color: #fff
</style>
`

const SOURCES: Record<string, string> = {}
for (const p of POSES) SOURCES['hd-' + p.nom + '.mjs'] = source(p)

const construits: Record<string, Promise<Construit>> = {}
const construit = (env: 'prod' | 'dev') => construits[env] ??= (env === 'prod' ? construireProd : construire)(SOURCES, 'effets-decor-reecrit-hologram-' + env)

type Etat = { calques: number, dos: number, x: number, y: number, marques: string, style: string, texte: string, box: { x: number, y: number, w: number, h: number } }

// ce que la page dit d'une carte : ses calques, la place du reflet, ses marques, son style, sa boîte
const LIRE = ([tag, sel]: string[]): Etat => {
  const carte   = (document.querySelector(tag) as any)._shadow.querySelector(sel) as HTMLElement
  const calques = [...carte.children].filter((c) => c.getAttribute('mjs-fx-layer') === 'hologram') as HTMLElement[]
  const dos     = [...carte.children].filter((c) => c.getAttribute('mjs-fx-layer') === 'hologram-back')
  const r       = carte.getBoundingClientRect()
  const lit     = (n: string) => calques[0] ? parseFloat(calques[0].style.getPropertyValue(n) || 'NaN') : NaN
  return {
    calques: calques.length,
    dos:     dos.length,
    x:       lit('--mjs-fx-hologram-x'),
    y:       lit('--mjs-fx-hologram-y'),
    marques: carte.getAttributeNames().filter((n) => n.startsWith('mjs-fx')).sort().join(' '),
    style:   carte.getAttribute('style') || '',
    texte:   carte.textContent || '',
    box:     { x: r.left, y: r.top, w: r.width, h: r.height }
  }
}

const REECRITURES: Record<string, string> = {
  textContent: 'a.textContent = \'Un autre texte\'',
  innerHTML:   'a.innerHTML = \'Un <b>autre</b> texte\'',
  dix:         'for (let i = 0; i < 9; i++) a.textContent = \'essai \' + i; a.textContent = \'Un autre texte\'',
  plus:        'a.innerHTML += \'<i>x</i>\''
}

const lire    = (p: any, tag: string, sel = '.a'): Promise<Etat> => p.evaluate(LIRE, [tag, sel])
const ecrire  = (p: any, tag: string, mode: string) => p.evaluate(([t, code]: string[]) => { new Function('a', code)((document.querySelector(t) as any)._shadow.querySelector('.a')) }, [tag, REECRITURES[mode]])
const meme    = (a: Etat['box'], b: Etat['box']) => ['x', 'y', 'w', 'h'].every((k) => Math.abs((a as any)[k] - (b as any)[k]) < 0.5)

// attend (au plus `delai` ms) que la carte soit dans l'état voulu ; rend le dernier état lu
async function attend(p: any, tag: string, voulu: (e: Etat) => boolean, delai = 20000, sel = '.a'): Promise<Etat> {
  const fin = Date.now() + delai
  let e = await lire(p, tag, sel)
  while (!voulu(e) && Date.now() < fin) {
    await p.waitForTimeout(100)
    e = await lire(p, tag, sel)
  }
  return e
}

// la boîte de la carte ne bouge plus (trois lectures qui se suivent)
async function posee(p: any, tag: string): Promise<Etat['box']> {
  let box = (await lire(p, tag)).box
  for (let i = 0, ok = 0; i < 150 && ok < 3; i++) {
    await p.waitForTimeout(120)
    const suite = (await lire(p, tag)).box
    ok  = meme(box, suite) ? ok + 1 : 0
    box = suite
  }
  return box
}

// la souris à (fx, fy) de la carte, qui est posée ; attend le reflet (un seul, à cette place) et rend l'état
async function suit(p: any, tag: string, fx: number, fy: number): Promise<Etat> {
  const b = await posee(p, tag)
  await p.mouse.move(b.x + b.w * fx, b.y + b.h * fy)
  const e = await attend(p, tag, (x) => x.calques === 1 && Math.abs(x.x - fx) < 0.1 && Math.abs(x.y - fy) < 0.1)
  assert.ok(e.calques === 1 && Math.abs(e.x - fx) < 0.1 && Math.abs(e.y - fy) < 0.1, `le reflet ne suit pas la souris : ${e.calques} calque(s), reflet en ${e.x} ${e.y} pour ${fx} ${fy}`)
  return e
}

// la carte au repos est celle de sa jumelle : la souris sort (et un clic dehors ferme la carte agrandie)
async function repos(p: any, tag: string, erreurs: string[]) {
  await p.mouse.click(650, 785)
  const jumelle = await lire(p, tag, '.t')
  const fin     = await attend(p, tag, (e) => e.calques === jumelle.calques && e.dos === jumelle.dos && e.marques === jumelle.marques && e.style === jumelle.style, 40000)
  assert.deepEqual({ calques: fin.calques, dos: fin.dos, marques: fin.marques, style: fin.style }, { calques: jumelle.calques, dos: jumelle.dos, marques: jumelle.marques, style: jumelle.style }, 'au repos, la carte n\'est pas comme sa jumelle')
  assert.deepEqual(erreurs, [], 'aucune erreur de page')
}

// la carte est prête : survolée ou agrandie, ou allumée d'emblée ; son calque est là
async function prete(browser: any, env: 'prod' | 'dev', pose: Pose) {
  const tag = 'mjs-hd-' + pose.nom
  const { p, erreurs } = await ouvrir(browser, await construit(env), tag)
  const b = await boite(p, tag, '.a')
  if (pose.zoom) await agrandit(p, tag, '.a')
  else if (!pose.allume) await p.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
  const avant = await attend(p, tag, (e) => e.calques === 1)
  assert.equal(avant.calques, 1, 'le calque est là avant la réécriture')
  if (pose.nom === 'tour') assert.equal(avant.dos, 1, 'le dos est là avant la réécriture')
  return { p, tag, erreurs, avant }
}

const NAVIGATEURS = (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox']) as Array<'chromium' | 'firefox'>

describe('*hologram : le reflet revient quand un script réécrit le contenu de la carte (navigateurs réels)', function () {
  this.timeout(1800000)

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of NAVIGATEURS) {
    describe(nom, function () {
      let browser: any

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      for (const env of ['prod', 'dev'] as const) {
        describe(env === 'prod' ? 'production' : 'développement', function () {
          for (const pose of POSES) {
            const modes = env === 'prod' ? ['textContent', 'innerHTML'] : ['textContent']
            for (const mode of modes) {
              it(`${pose.nom} : ${mode}, le reflet est de nouveau là, suit la souris, en un seul exemplaire ; au repos rien ne reste`, async function () {
                const { p, tag, erreurs } = await prete(browser, env, pose)
                try {
                  await ecrire(p, tag, mode)
                  const premier = await suit(p, tag, 0.3, 0.35)
                  assert.equal(premier.calques, 1, 'le reflet n\'est pas revenu (ou en plusieurs exemplaires)')
                  const second = await suit(p, tag, 0.7, 0.65)
                  assert.equal(second.calques, 1, 'un seul reflet, après le second déplacement')
                  assert.equal(second.texte, 'Un autre texte', 'le texte neuf n\'est pas resté')
                  await repos(p, tag, erreurs)
                } finally {
                  await p.close()
                }
              })
            }
          }

          if (env !== 'prod') return

          for (const pose of POSES.filter((q) => !q.zoom)) {
            it(`${pose.nom} : dix réécritures dans la même tâche, un seul reflet`, async function () {
              const { p, tag, erreurs } = await prete(browser, env, pose)
              try {
                await ecrire(p, tag, 'dix')
                const e = await suit(p, tag, 0.25, 0.3)
                assert.equal(e.calques, 1, 'un seul reflet')
                await repos(p, tag, erreurs)
              } finally {
                await p.close()
              }
            })

            it(`${pose.nom} : innerHTML +=, la copie figée du reflet ne reste pas à côté du vrai ; au repos rien ne reste`, async function () {
              const { p, tag, erreurs } = await prete(browser, env, pose)
              try {
                await ecrire(p, tag, 'plus')
                const e = await suit(p, tag, 0.25, 0.3)
                assert.equal(e.calques, 1, 'un seul reflet (la copie figée n\'est pas à côté du vrai)')
                await repos(p, tag, erreurs)
              } finally {
                await p.close()
              }
            })
          }

          // le style par défaut a une boucle tant qu'il est à l'écran : son reflet revient seul. Une carte toujours allumée (style de carte) n'a rien qui tourne au repos :
          // son reflet revient au premier mouvement de la souris sur la carte (les cas ci-dessus)
          for (const pose of POSES.filter((q) => q.nom === 'defaut')) {
            it(`${pose.nom} : sans un geste de la souris, le reflet du style par défaut revient de lui-même`, async function () {
              const { p, tag, erreurs } = await prete(browser, env, pose)
              try {
                await ecrire(p, tag, 'textContent')
                const e = await attend(p, tag, (x) => x.calques === 1, 5000)
                assert.equal(e.calques, 1, 'le reflet n\'est pas revenu sans geste')
                assert.deepEqual(erreurs, [], 'aucune erreur de page')
              } finally {
                await p.close()
              }
            })
          }

          // une application qui ne pose que le style par défaut : le fichier de l'effet est construit sans ses sections de carte, et l'aide qui rattache le calque doit y être
          it('style par défaut seul (sans section de carte) : le reflet revient', async function () {
            const tag   = 'mjs-hd-seul'
            const seul  = await construireProd({ 'hd-seul.mjs': source({ nom: 'seul', reglage: '', zoom: false, allume: true }) }, 'effets-decor-reecrit-hologram-seul')
            const { p, erreurs } = await ouvrir(browser, seul, tag)
            try {
              const avant = await attend(p, tag, (e) => e.calques === 1)
              assert.equal(avant.calques, 1, 'le calque est là avant la réécriture')
              await ecrire(p, tag, 'textContent')
              const e = await attend(p, tag, (x) => x.calques === 1, 10000)
              assert.equal(e.calques, 1, 'le reflet n\'est pas revenu')
              assert.deepEqual(erreurs, [], 'aucune erreur de page')
            } finally {
              await p.close()
            }
          })

          // le gestionnaire du script réécrit la carte pendant le clic qui l'agrandit : avant ou après celui de l'effet, la carte s'agrandit quand même
          for (const pose of POSES.filter((q) => q.zoom)) {
            for (const ordre of ['après', 'avant']) {
              it(`${pose.nom} : un clic dont le gestionnaire réécrit la carte (${ordre} celui de l'effet) l'agrandit quand même ; le reflet revient`, async function () {
                const tag = 'mjs-hd-' + pose.nom
                const { p, erreurs } = await ouvrir(browser, await construit(env), tag)
                try {
                  const b = await boite(p, tag, '.a')
                  await p.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
                  await attend(p, tag, (e) => e.calques === 1)
                  await p.evaluate(([t, capture]: any[]) => {
                    const a = (document.querySelector(t) as any)._shadow.querySelector('.a')
                    a.addEventListener('click', () => { a.textContent = 'Un autre texte' }, capture)
                  }, [tag, ordre === 'avant'])
                  await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
                  const e = await attend(p, tag, (x) => /zoomed/.test(x.marques), 15000)
                  assert.ok(/zoomed/.test(e.marques), 'la carte ne s\'est pas agrandie : ' + e.marques)
                  // la carte arrive : on attend sa taille d'arrivée (au moins 1,4 fois la sienne, la marque de vol partie), pas une boîte qui ne bouge pas un instant :
                  // une image en retard laisse la carte à sa place de départ, ou au milieu de son vol, plus longtemps que trois lectures
                  const arrivee = await attend(p, tag, (x) => x.box.w > b.w * 1.4 && !/-fly/.test(x.marques), 20000)
                  assert.ok(arrivee.box.w > b.w * 1.4 && !/-fly/.test(arrivee.marques), 'la carte n\'est pas agrandie : ' + Math.round(arrivee.box.w) + ' px de large pour ' + Math.round(b.w) + ' (' + arrivee.marques + ')')
                  await posee(p, tag)
                  const r = await suit(p, tag, 0.3, 0.35)
                  assert.equal(r.calques, 1, 'le reflet n\'est pas revenu (ou en plusieurs exemplaires)')
                  await repos(p, tag, erreurs)
                } finally {
                  await p.close()
                }
              })
            }
          }

          for (const pose of POSES.filter((q) => q.zoom)) {
            it(`${pose.nom} : la carte agrandie le reste après la réécriture`, async function () {
              const { p, tag, erreurs, avant } = await prete(browser, env, pose)
              try {
                await ecrire(p, tag, 'textContent')
                await p.waitForTimeout(800)
                const e = await lire(p, tag)
                assert.ok(/zoomed/.test(e.marques), 'la carte n\'est plus agrandie : ' + e.marques)
                assert.ok(meme(e.box, avant.box), 'la carte a bougé : ' + JSON.stringify(e.box) + ' au lieu de ' + JSON.stringify(avant.box))
                assert.deepEqual(erreurs, [], 'aucune erreur de page')
              } finally {
                await p.close()
              }
            })
          }
        })
      }
    })
  }
})
