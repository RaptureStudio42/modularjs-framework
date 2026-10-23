// faux serveur Redis RESP minimal (node:net) pour les tests de l'adaptateur Redis : répond aux commandes que
// l'adaptateur envoie, retient celles reçues et peut pousser un message pub/sub à ses abonnés
import { createServer, type Socket } from 'node:net'

export interface FauxRedis {
  url: string
  /** commandes reçues, dans l'ordre (nom en majuscules, puis les arguments) */
  commandes: string[][]
  /** connexions qui ont envoyé SUBSCRIBE */
  abonnes: Socket[]
  /** pousse un message `message canal corps` à chaque abonné */
  pousser(canal: string, corps: string): void
  fermer(): Promise<void>
}

const bulk = (s: string): string => `$${Buffer.byteLength(s)}\r\n${s}\r\n`

// `cles` : ce que KEYS et SCAN listent (motif `préfixe*` seulement) ; `pageScan` : clés par réponse de SCAN
export async function fauxRedis(opts: { cles?: string[]; pageScan?: number } = {}): Promise<FauxRedis> {
  const cles     = opts.cles ?? []
  const page     = opts.pageScan ?? 2
  const commandes: string[][] = []
  const abonnes: Socket[] = []
  const sockets  = new Set<Socket>()
  const filtrer  = (motif: string): string[] => cles.filter(k => motif.endsWith('*') ? k.startsWith(motif.slice(0, -1)) : k === motif)

  const repondre = (sock: Socket, args: string[]): void => {
    const cmd = args[0].toUpperCase()
    commandes.push([cmd, ...args.slice(1)])
    if (cmd === 'SUBSCRIBE') { if (!abonnes.includes(sock)) abonnes.push(sock); sock.write(`*3\r\n${bulk('subscribe')}${bulk(args[1])}:1\r\n`) }
    else if (cmd === 'PING') sock.write('+PONG\r\n')
    else if (cmd === 'INCR') sock.write(':1\r\n')
    else if (cmd === 'KEYS') { const ks = filtrer(args[1]); sock.write(`*${ks.length}\r\n${ks.map(bulk).join('')}`) }
    else if (cmd === 'SCAN') {
      const debut   = Number(args[1])
      const iMatch  = args.findIndex(a => a.toUpperCase() === 'MATCH')
      const motif   = iMatch === -1 ? '*' : args[iMatch + 1]
      const tranche = cles.slice(debut, debut + page).filter(k => filtrer(motif).includes(k))
      const suite   = debut + page >= cles.length ? '0' : String(debut + page)
      sock.write(`*2\r\n${bulk(suite)}*${tranche.length}\r\n${tranche.map(bulk).join('')}`)
    }
    else if (cmd === 'PUBLISH' || cmd === 'DEL') sock.write(':0\r\n')
    else sock.write('+OK\r\n')
  }

  const srv = createServer(sock => {
    sockets.add(sock)
    let tampon = ''
    sock.on('data', d => {
      tampon += d.toString()
      for (;;) {
        const tete = /^\*(\d+)\r\n/.exec(tampon)
        if (!tete) break
        let i = tete[0].length
        const args: string[] = []
        let complet = true
        for (let k = 0; k < Number(tete[1]); k++) {
          const lg = /^\$(\d+)\r\n/.exec(tampon.slice(i))
          if (!lg) { complet = false; break }
          i += lg[0].length
          args.push(tampon.slice(i, i + Number(lg[1])))
          i += Number(lg[1]) + 2
        }
        if (!complet || i > tampon.length) break
        tampon = tampon.slice(i)
        repondre(sock, args)
      }
    })
    sock.on('error', () => {})
    sock.on('close', () => sockets.delete(sock))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as { port: number }).port

  return {
    url: `redis://127.0.0.1:${port}`,
    commandes,
    abonnes,
    pousser(canal, corps) { for (const s of abonnes) s.write(`*3\r\n${bulk('message')}${bulk(canal)}${bulk(corps)}`) },
    fermer() {
      for (const s of sockets) s.destroy()
      return new Promise<void>(r => srv.close(() => r()))
    },
  }
}
