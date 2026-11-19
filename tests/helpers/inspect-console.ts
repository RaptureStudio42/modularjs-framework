// harnais de µinspect : des composants compilés par le vrai Bundler, montés ensemble dans happy-dom ; la console de la page
// recueille les groupes « 🔍 [MJS Inspect] … » et leurs lignes From / To, valeurs gardées telles quelles et lues à la FIN d'une
// suite d'écritures — une copie qui suivrait encore l'état réel s'y voit

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler } from '../../src/bundler/index.js'
import { stripEsm } from '../../src/server/renderToString.js'
import { mjsTmp } from './tmp.js'

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

// une Map se lit en paires dans le texte rendu ; une erreur de l'affichage (rattrapée par µinspect) devient une ligne « Erreur »
const CONSOLE = `globalThis.__inspect = [];
console.group = function(t) { if (String(t).indexOf('🔍 [MJS Inspect]') === 0) __inspect.push(['', String(t)]); };
console.groupEnd = function() {};
console.log = function(t, s, v) { if (typeof t === 'string' && /^%c(From|To) /.test(t)) __inspect.push([t.slice(2, t.indexOf(' ')), v]); };
console.warn = function(t, e) { if (String(t).indexOf('🔍') === 0) __inspect.push(['Erreur', String(e && e.stack || e)]); };
globalThis.__lire = function() {
  return __inspect.map(function(e) { return e[0] ? e[0] + ' ' + JSON.stringify(e[1], function(k, x) { return x instanceof Map ? { Map: [...x] } : x; }) : e[1]; });
};`

export async function monterInspect(prefixe: string, sources: Record<string, string>): Promise<{ window: any; jouer: (nom: string, ...methodes: string[]) => Promise<string[]> }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom + '.mjs'), source)
  // sans les outils du développement (panneau, rechargement à chaud) : le cœur et µinspect, non minifiés
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const ordre  = [...files.filter((f) => f.startsWith('mjs_core')), ...files.filter((f) => f.startsWith('mjs_') && !f.startsWith('mjs_core')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(CONSOLE)
  window.eval(ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;')
  window.document.body.innerHTML = Object.keys(sources).map((nom) => `<mjs-${nom}></mjs-${nom}>`).join('')
  const montes = () => Object.keys(sources).every((nom) => window.document.querySelector('mjs-' + nom)?._shadow)
  for (let i = 0; i < 150 && !montes(); i++) await pause(20)
  await pause(60)
  // les méthodes du composant, jouées l'une après l'autre ; ce que µinspect a écrit pendant, lu une fois à la fin (recopié en
  // tableau de ce côté : celui de la page a son propre prototype, qu'une comparaison stricte refuse)
  const jouer = async (nom: string, ...methodes: string[]) => {
    window.eval('__inspect.length = 0')
    for (const m of methodes) {
      window.document.querySelector('mjs-' + nom)[m]()
      await pause(20)
    }
    return [...window.eval('__lire()')] as string[]
  }
  return { window, jouer }
}
