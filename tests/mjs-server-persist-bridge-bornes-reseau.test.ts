// Régression — persist-bridge.ts (BridgePersistAdapter) : deux bornes AU-DELÀ du contrat minimal.
//   1. Taille maximale de réponse — un back qui streame une réponse énorme (ou sans fin) ne doit
//      jamais gonfler la mémoire du process sans borne : la lecture s'arrête dès que la taille
//      configurée est dépassée, load() se replie sur [] avec un avertissement.
//   2. Délai GLOBAL (totalTimeoutMs, distinct de timeoutMs qui ne borne qu'UNE tentative) — un back
//      qui ne répond jamais ne doit pas immobiliser l'appelant pendant la somme complète des
//      tentatives + délais de retry par défaut (jusqu'à ~27 s) : l'échéance absolue coupe court.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { BridgePersistAdapter } from '../src/mjs-server/index.js'

function signer(secret: string, ts: string | string[] | undefined, method: string | undefined, url: string | undefined, body: string): string {
  const canonical = ts +'.'+ method +'.'+ url +'.'+ body
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

describe('mjs-server/persist-bridge — bornes réseau (taille de réponse, délai global)', () => {
  it("load() abandonne une réponse qui dépasse maxResponseBytes — se replie sur [], avertissement émis, JAMAIS un blocage indéfini", async function () {
    this.timeout(8000)
    const SECRET = 'secret-persist-bridge-taille'
    // réponse JSON VALIDE (games au format {id,data}[] réellement attendu par load()) mais
    // volontairement bien plus grande que maxResponseBytes (100 octets, ci-dessous) — un JSON
    // invalide serait de toute façon rejeté par JSON.parse SANS la borne de taille (test creux qui
    // ne prouverait rien) : ici, SANS la borne, ces 2000 entrées bien formées seraient acceptées et
    // rendues telles quelles par load() — la coupure doit intervenir AVANT la fin de la réception.
    const games = Array.from({ length: 2000 }, (_, i) => ({ id: 'g'+ i, data: {} }))
    const corpsValide = JSON.stringify({ ok: true, games })
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        const sig  = signer(SECRET, req.headers['x-mjs-ws-timestamp'], req.method, req.url, body)
        if (sig !== req.headers['x-mjs-ws-signature']) { res.writeHead(401); res.end('signature invalide'); return }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(corpsValide)
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as any).port
    const warns: string[] = []
    const adapter = new BridgePersistAdapter({
      url: `http://127.0.0.1:${port}/mjs-server/persist`, secret: SECRET,
      maxResponseBytes: 100, totalTimeoutMs: 100,   // court — un seul essai suffit à prouver la coupure, pas besoin d'attendre le cumul des retentatives
      onLog: (level, message) => { if (level === 'warn') warns.push(message) },
    })

    const rows = await adapter.load()
    await new Promise<void>(r => server.close(() => r()))

    assert.deepEqual(rows, [], 'une réponse trop grande doit être abandonnée — load() se replie sur []')
    assert.ok(warns.length > 0, `au moins un avertissement attendu, reçu : ${JSON.stringify(warns)}`)
  })

  it("load() respecte totalTimeoutMs (délai GLOBAL) — un back qui ne répond jamais est abandonné bien avant la somme des délais de retry par défaut", async function () {
    this.timeout(8000)
    // accepte la connexion TCP mais NE RÉPOND JAMAIS — force chaque tentative à expirer sur son
    // propre timeoutMs (court, ci-dessous), jamais une réponse HTTP réelle
    const server = createServer((_req, _res) => { /* ne répond jamais */ })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as any).port
    const adapter = new BridgePersistAdapter({
      url: `http://127.0.0.1:${port}/mjs-server/persist`, secret: 'peu-importe',
      timeoutMs: 50, totalTimeoutMs: 150,
      onLog: () => {},
    })

    const debut = Date.now()
    const rows = await adapter.load()
    const duree = Date.now() - debut

    await new Promise<void>(r => server.close(() => r()))

    assert.deepEqual(rows, [])
    // sans l'échéance globale, l'abandon complet (essai + 2 retentatives + délais 2s/10s) prendrait
    // plusieurs SECONDES — avec totalTimeoutMs:150, l'abandon doit intervenir en un temps du même
    // ordre de grandeur, très en-deçà d'une seconde (marge large pour un environnement chargé)
    assert.ok(duree < 2000, `load() aurait dû être abandonné bien avant 2000ms (totalTimeoutMs=150), a pris ${duree}ms`)
  })

  it("load() respecte totalTimeoutMs même quand il est PLUS COURT que timeoutMs (par tentative) — l'essai EN COURS est lui-même écourté, pas seulement borné entre deux essais", async function () {
    this.timeout(8000)
    // accepte la connexion TCP mais NE RÉPOND JAMAIS — timeoutMs très supérieur au délai global :
    // seule une borne appliquée à l'essai LUI-MÊME (pas seulement vérifiée entre deux essais) peut
    // empêcher la première tentative d'épuiser tout son timeoutMs avant que le délai global agisse
    const server = createServer((_req, _res) => { /* ne répond jamais */ })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as any).port
    const adapter = new BridgePersistAdapter({
      url: `http://127.0.0.1:${port}/mjs-server/persist`, secret: 'peu-importe',
      timeoutMs: 3000, totalTimeoutMs: 150,
      onLog: () => {},
    })

    const debut = Date.now()
    const rows = await adapter.load()
    const duree = Date.now() - debut

    await new Promise<void>(r => server.close(() => r()))

    assert.deepEqual(rows, [])
    assert.ok(duree < 1000, `load() aurait dû être abandonné proche de totalTimeoutMs=150 (essai en cours compris), PAS attendre timeoutMs=3000 — a pris ${duree}ms`)
  })
})
