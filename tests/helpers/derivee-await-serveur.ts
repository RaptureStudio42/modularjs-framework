// rendu serveur d'une valeur dérivée qui attend (`$x = await f($q)`), puis reprise de sa page dans happy-dom : `servir` rend une balise
// par le moteur happy-dom (renderToString) et lit les valeurs rangées dans `#__mjs_store` (clé `__mjsAwait`) ; `reprendre` charge le
// cœur et les composants dans une fenêtre où cette balise est posée avant eux, comme dans une page servie, puis pose `corps`. Les appels
// que fait la page, les composants les notent eux-mêmes (`__appels`) ; les appels `µ.warn` du cœur sont notés (`__avis`)

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { renderToString } from '../../src/server/renderToString.js'
import { construire, pause } from './derivee-await-banc.js'
import { mjsTmp } from './tmp.js'

// la réponse qui arrive après `ms` millisecondes, sans réseau
export const TARD = `<script module>
  plusTard = (valeur, ms) -> new Promise((tenir) -> setTimeout((-> tenir(valeur)), ms))
</script>
`

// la page que rend le serveur pour `tag`, et les valeurs qu'il y range (null sans balise ou sans clé `__mjsAwait`)
export async function servir(prefixe: string, sources: Record<string, string>, tag: string, opts: any = {}): Promise<{ res: any, graine: any }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, nom), source)
  const res: any = await renderToString({ sourceDir: srcDir, outputDir: join(root, 'out'), tag, settleMs: 2000, ...opts } as any)
  const balise   = /id=["']?__mjs_store["']?[^>]*>([\s\S]*?)<\/script>/.exec(res.sharedScript || '')
  return { res, graine: balise ? JSON.parse(balise[1]).__mjsAwait ?? null : null }
}

// le navigateur : la balise du magasin servi est là avant le cœur, comme dans une page servie
export async function reprendre(prefixe: string, sources: Record<string, string>, graine: any, corps: string): Promise<any> {
  const { code } = await construire(prefixe, sources)
  const w: any   = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  w.document.body.innerHTML = '<script id="__mjs_store" type="application/json">' + JSON.stringify({ __mjsAwait: graine }) + '</script>'
  w.eval(code + '\nglobalThis.µ = µ;\nglobalThis.__avis = [];\nµ.warn = function(...a) { globalThis.__avis.push(a.map(String).join(" ")); };')
  w.document.body.insertAdjacentHTML('beforeend', corps)
  await pause(150)
  return w
}

// les appels notés par la page, recopiés hors de la fenêtre
export const appels = (w: any): string[] => Array.from(w.__appels || [], String)
