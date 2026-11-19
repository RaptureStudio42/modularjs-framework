// mjs-ws/stats-page — page HTML « /state » : tableau de bord sombre, autonome (aucune
// ressource externe, <style>/<script> inline), servi par le pont (bridge.ts, GET /state) SEULEMENT
// si l'option `stats` de mjsWs() est active. La 1re peinture embarque l'instantané reçu en
// paramètre (pas d'attente réseau) ; une SEULE fonction de rendu (dans le <script>) sert ensuite
// aussi bien l'affichage initial que les rafraîchissements suivants (fetch('/stats') toutes les
// 2 s, même origine) — jamais deux gabarits à maintenir en double. Zéro attribut `style=` en ligne
// (règle nº1 MJS, cf. skill modularjs) : tout passe par les classes CSS ci-dessous, le JS ne
// touche que textContent/innerHTML.

import type { MjsWsStatsSnapshot } from './stats.js'
import { t, getMessagesLang } from '../messages/index.js'

// `</script>` dans une valeur embarquée ne doit JAMAIS fermer la balise prématurément — même
// piège que project_mjs_lexer_no_html_in_script, appliqué ici au JSON de l'instantané initial.
function escapeJsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c')
}

// libellé traduit posé dans le JavaScript de la page : littéral JSON, jamais entre apostrophes — une
// apostrophe (« d'origine »), un guillemet ou une barre oblique inverse d'une traduction ne cassent
// plus le script, et `<` y est neutralisé comme dans l'instantané
function jsString(text: string): string {
  return escapeJsonForScript(JSON.stringify(text))
}

// libellé traduit posé dans le HTML de la page (titre de l'onglet, h1, pied) : échappé comme du texte — une
// traduction qui contient `<` ou `&` n'y glisse jamais de balise
function htmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#111;color:#e4e4e4;padding:24px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
h1{font-size:18px;font-weight:600;margin:0 0 4px;letter-spacing:.02em}
.sub{color:#888;font-size:12px;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{background:#181818;border:1px solid #262626;border-radius:8px;padding:14px 16px}
.card h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7aa2ff;margin:0 0 10px}
.row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:13px;border-top:1px solid #1f1f1f}
.row:first-of-type{border-top:none}
.row span:first-child{color:#999}
.row span:last-child{font-variant-numeric:tabular-nums;color:#f0f0f0}
footer{margin-top:20px;color:#555;font-size:11px}
`.trim()

// familles affichées, dans l'ordre — [clé JSON, titre traduit, [[champ, libellé traduit], …]] ;
// intervalles entre pings et mémoire/uptime ont une forme différente (cf. render() plus bas), traitées à part.
// libellés résolus via t() À LA CONSTRUCTION du script (buildScript(), appelée PAR REQUÊTE par
// renderStatsPage — jamais au chargement du module, pour respecter la langue courante) ; les clés
// JSON ('connexions', 'actives', …) restent des littéraux, JAMAIS traduites (elles indexent
// l'instantané de stats.ts, cf. render() ci-dessous — un libellé traduit casserait ces accès).
function buildScript(): string {
  // locale factorisée UNE fois (posée ici, injectée 2× ci-dessous — fmt() et l'horodatage) —
  // même politique que t() : résolue PAR REQUÊTE, jamais figée au chargement du module.
  const locale = getMessagesLang() === 'en' ? 'en-US' : 'fr-FR'
  return `
var FAMILIES = [
  ['connections', ${jsString(t('ws.stats.title-connections'))}, [['active',${jsString(t('ws.stats.field-active'))}],['parked',${jsString(t('ws.stats.field-parked'))}],['welcomed',${jsString(t('ws.stats.field-accepted'))}],['refused',${jsString(t('ws.stats.field-refused'))}],['refusedCap',${jsString(t('ws.stats.field-refused-cap'))}],['refusedOrigin',${jsString(t('ws.stats.field-refused-origin'))}],['refusedBan',${jsString(t('ws.stats.field-refused-ban'))}],['closed',${jsString(t('ws.stats.field-closed'))}]]],
  ['rooms', ${jsString(t('ws.stats.title-rooms'))}, [['count',${jsString(t('ws.stats.field-number'))}],['membersTotal',${jsString(t('ws.stats.field-members-total'))}],['presenceSubscribers',${jsString(t('ws.stats.field-subscribers-presence'))}]]],
  ['streams', ${jsString(t('ws.stats.title-stream'))}, [['count',${jsString(t('ws.stats.field-number'))}],['deltasEmitted',${jsString(t('ws.stats.field-deltas-emitted'))}],['resyncsReplay',${jsString(t('ws.stats.field-resyncs-replay'))}],['resyncsReset',${jsString(t('ws.stats.field-resyncs-reset'))}]]],
  ['messages', ${jsString(t('ws.stats.title-messages'))}, [['received',${jsString(t('ws.stats.field-received'))}],['sent',${jsString(t('ws.stats.field-sent'))}],['buffered',${jsString(t('ws.stats.field-buffered'))}],['replayed',${jsString(t('ws.stats.field-replayed'))}],['dropped',${jsString(t('ws.stats.field-rejected'))}],['binaryReceived',${jsString(t('ws.stats.field-binary-received'))}],['binaryIgnored',${jsString(t('ws.stats.field-binary-ignored'))}]]],
  ['guard', ${jsString(t('ws.stats.title-guard'))}, [['kicksRate',${jsString(t('ws.stats.field-kicks-rate'))}],['kicksSilence',${jsString(t('ws.stats.field-kicks-silence'))}],['kicksBackpressure',${jsString(t('ws.stats.field-kicks-congestion'))}],['kicksPayload',${jsString(t('ws.stats.field-kicks-payload'))}],['tokenExpired',${jsString(t('ws.stats.field-expirations-token'))}],['bans',${jsString(t('ws.stats.field-bans'))}]]],
  ['bridge', ${jsString(t('ws.stats.title-bridge'))}, [['http401','401'],['rateLimited',${jsString(t('ws.stats.field-rate-limited'))}],['webhooksSent',${jsString(t('ws.stats.field-webhooks-sent'))}],['webhooksFailed',${jsString(t('ws.stats.field-webhooks-failed'))}],['webhooksAbandoned',${jsString(t('ws.stats.field-webhooks-abandoned'))}]]],
  ['adapter', ${jsString(t('ws.stats.title-adapter'))}, [['published',${jsString(t('ws.stats.field-published'))}],['received',${jsString(t('ws.stats.field-received'))}],['ignoredOrigin',${jsString(t('ws.stats.field-ignored-origin'))}],['reordered',${jsString(t('ws.stats.field-reordered'))}],['reconnects',${jsString(t('ws.stats.field-reconnects'))}]]],
  ['sessions', ${jsString(t('ws.stats.title-sessions'))}, [['issued',${jsString(t('ws.stats.field-emitted'))}],['resumed',${jsString(t('ws.stats.field-resumed'))}],['expired',${jsString(t('ws.stats.field-expired'))}],['overflowed',${jsString(t('ws.stats.field-overflowed'))}]]]
]

function fmt(n) { return typeof n === 'number' ? n.toLocaleString('${locale}') : String(n) }

function card(title, rows) {
  var body = rows.map(function(r) { return '<div class="row"><span>'+ r[0] +'</span><span>'+ r[1] +'</span></div>' }).join('')
  return '<div class="card"><h2>'+ title +'</h2>'+ body +'</div>'
}

function render(data) {
  var cards = FAMILIES.map(function(f) {
    var fam  = data[f[0]] || {}
    var rows = f[2].map(function(fld) { return [fld[1], fmt(fam[fld[0]])] })
    return card(f[1], rows)
  })
  var lat = data.pingIntervals || {}
  cards.push(card(${jsString(t('ws.stats.title-interval-ping'))}, [
    ['p50', lat.p50 == null ? '—' : fmt(lat.p50)],
    ['p95', lat.p95 == null ? '—' : fmt(lat.p95)],
    [${jsString(t('ws.stats.field-sample'))}, fmt(lat.samples)]
  ]))
  cards.push(card(${jsString(t('ws.stats.title-memory'))}, [
    ['uptime', fmt(data.uptime) +' s'],
    ['RSS', fmt(Math.round(((data.memory && data.memory.rss) || 0) / 1048576)) +' Mo'],
    ['process', data.processId]
  ]))
  document.getElementById('grid').innerHTML = cards.join('')
  document.getElementById('sub').textContent = ${jsString(t('ws.stats.sub-process'))}+ data.processId +${jsString(t('ws.stats.sub-since'))}+ fmt(data.uptime) +${jsString(t('ws.stats.sub-s'))}
  document.getElementById('ts').textContent = new Date(data.timestamp).toLocaleTimeString('${locale}')
}

function refresh() {
  fetch('/stats', { headers: { accept: 'application/json' } })
    .then(function(r) { return r.json() })
    .then(render)
    .catch(function() {})
}
`.trim()
}

/** Page HTML complète — cf. le commentaire de tête (gabarit UNIQUE, initial + rafraîchissements). */
export function renderStatsPage(snapshot: MjsWsStatsSnapshot): string {
  const initial = escapeJsonForScript(JSON.stringify(snapshot))
  return `<!doctype html>
<html lang="${getMessagesLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlText(t('ws.stats.title-page'))}</title>
<style>
${CSS}
</style>
</head>
<body>
<h1>${htmlText(t('ws.stats.title-page'))}</h1>
<p class="sub" id="sub"></p>
<div class="grid" id="grid"></div>
<footer>${htmlText(t('ws.stats.footer'))} <span id="ts"></span></footer>
<script>
${buildScript()}
var INITIAL_STATS = ${initial}
render(INITIAL_STATS)
setInterval(refresh, 2000)
</script>
</body>
</html>
`
}
