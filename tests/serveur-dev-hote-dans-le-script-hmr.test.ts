// le script du rechargement à chaud (`/__mjs_hmr/client.js`) compose l'adresse de son WebSocket avec l'en-tête Host de la requête : il y
// entrait tel quel, entre guillemets simples, dans du JavaScript servi à la page. Son nom passe par le même filtre que les messages
// (lettres, chiffres, `.`, `:`, `_`, `-`), son port par des chiffres seuls ; les adresses ordinaires ne changent pas. Le client écrit
// l'adresse en chaîne (`'ws://…'.replace(…)`) dont il prend le protocole de la page (`wss:` sous https) : c'est cette chaîne qui est lue

import assert from 'node:assert/strict'
import { StaticServer } from '../src/server/index.js'

const script  = (host?: string): string => (StaticServer.prototype as any).getHMRClientSnippet.call({ host: '127.0.0.1', port: 5173, server: null }, host)
const adresse = (s: string): string | undefined => (s.match(/new WebSocket\([^\n]*?'(wss?:\/\/[^']*)'\.replace\(/) || [])[1]

describe('serveur de développement — l\'en-tête Host dans le script du rechargement à chaud', () => {
  it('un Host qui porte un guillemet ne sort pas de la chaîne du script', () => {
    const s = script("x');alert(1);('")
    assert.ok(!s.includes('alert(1)'), s)
    assert.equal(adresse(s), 'ws://xalert1/__mjs_hmr')
  })

  it('un port qui n\'est pas fait de chiffres ne passe pas', () => {
    const a = adresse(script("localhost:80'+x+'"))
    assert.match(a ?? '', /^ws:\/\/[a-z0-9.:_[\]-]+\/__mjs_hmr$/)
    assert.ok(!(a ?? '').includes('+x+'), a)
  })

  it('les adresses ordinaires restent les mêmes', () => {
    assert.equal(adresse(script('localhost:5173')), 'ws://localhost:5173/__mjs_hmr')
    assert.equal(adresse(script('192.168.1.20:3000')), 'ws://192.168.1.20:3000/__mjs_hmr')
    assert.equal(adresse(script('[::1]:5173')), 'ws://[::1]:5173/__mjs_hmr')
    assert.equal(adresse(script('mon-site.test')), 'ws://mon-site.test/__mjs_hmr')
  })

  it('sans Host : l\'adresse d\'écoute du serveur', () => {
    assert.equal(adresse(script(undefined)), 'ws://127.0.0.1:5173/__mjs_hmr')
  })
})
