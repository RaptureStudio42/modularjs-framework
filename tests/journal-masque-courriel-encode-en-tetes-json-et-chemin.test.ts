// le journal masquait les jetons des paramètres d'adresse, `Bearer`, les JWT et les courriels écrits avec `@`, mais laissait en clair
// un courriel écrit `%40` (`?email=jean%40x.fr`, la forme d'un formulaire GET), la valeur des en-têtes `Cookie:` et `Authorization:`
// (`Basic …` compris), un mot de passe dans du JSON (`"password": "…"`), un jeton dans le chemin d'une adresse (`/reinitialiser/<jeton>`),
// `oauth_verifier` et `code_verifier`. Un slug lisible reste en clair

import assert from 'node:assert/strict'
import { maskSecrets } from '../src/server/journal.js'

describe('journal — secrets masqués hors des paramètres d\'adresse', () => {
  const masques: [string, string][] = [
    ['https://site.fr/desinscription?email=jean.dupont%40gmail.com', 'https://site.fr/desinscription?email=***%40gmail.com'],
    ['https://site.fr/desinscription?email=jean.dupont%40gmail.com&page=2', 'https://site.fr/desinscription?email=***%40gmail.com&page=2'],
    ['Cookie: sessionid=abc123def456; csrftoken=xyz789', 'Cookie: ***'],
    ['en-têtes : {"cookie":"sessionid=abc123","accept":"text/html"}', 'en-têtes : {"cookie":"***","accept":"text/html"}'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'Authorization: Basic ***'],
    ['requête : {"authorization": "Token 9f8e7d6c5b4a"}', 'requête : {"authorization": "Token ***"}'],
    ['refusé (Cookie: sid=abc123) puis repli', 'refusé (Cookie: ***) puis repli'],
    ['identifiants refusés : Basic dXNlcjpwYXNz', 'identifiants refusés : Basic ***'],
    ['POST échoué : {"password":"hunter2","token":"abc123"}', 'POST échoué : {"password":"***","token":"***"}'],
    ['corps : {"user": {"email_confirmation": "x", "password_confirmation": "hunter2", "pin": 1234}}', 'corps : {"user": {"email_confirmation": "x", "password_confirmation": "***", "pin": 1234}}'],
    ['https://site.fr/reinitialiser/7f3a9c2b1d4e5f60718293a4b5c6d7e8', 'https://site.fr/reinitialiser/***'],
    ['/reinitialiser/Zk3mQ9xLp2wR7tYb/confirmer', '/reinitialiser/***/confirmer'],
    ['/invitation/550e8400-e29b-41d4-a716-446655440000?lang=fr', '/invitation/***?lang=fr'],
    ['échec de https://site.fr/telecharger/Zk3mQ9xLp2wR7tYbN4.pdf (404)', 'échec de https://site.fr/telecharger/***.pdf (404)'],
    ['https://site.fr/cb?oauth_verifier=VERIF123&code_verifier=PKCE456', 'https://site.fr/cb?oauth_verifier=***&code_verifier=***'],
  ]
  for (const [texte, attendu] of masques) {
    it(`masqué : ${texte}`, () => assert.equal(maskSecrets(texte), attendu))
  }

  const intacts = [
    '/blog/mon-article-sur-les-chats-2024',
    'https://site.fr/produits/samsung-galaxy-s24-ultra?couleur=noir',
    '/docs/anticonstitutionnellement',
    '/fichiers/rapport-annuel-2024.pdf',
    'https://site.fr/blog/MonArticleSurLesChats',
    'Basic authentication failed for user',
    'Cookie consent missing',
    '{"statusCode": 500, "code": "ENOENT", "state": "ouvert"}',
    'Error: x\n    at foo (/home/projet/node_modules/paquet-tres-long-nom/index.js:1:2)',
  ]
  for (const texte of intacts) {
    it(`en clair : ${texte.split('\n')[0]}`, () => assert.equal(maskSecrets(texte), texte))
  }
})
