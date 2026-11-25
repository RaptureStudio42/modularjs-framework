// `structuredClone` dans les fenêtres happy-dom du rendu serveur, du prérendu et du harnais de test : happy-dom ne le donne pas, et une
// page qui l'appelait arrêtait le rendu (« structuredClone is not defined »), donc aussi `mjs build` qui prérend cette page
// la copie passe par un canal de Node : même algorithme que le `structuredClone` de Node, celui de V8, comme Chromium (refus d'une
// fonction, d'un symbole, d'un proxy ; cycles, dates, tables, erreurs, tampons gardés ; `transfer` respecté). Le port qui reçoit est
// déplacé dans le contexte de la fenêtre : la copie est faite des objets de LA PAGE (`instanceof Array`, `Object.prototype` de la page,
// comme au navigateur), pas de ceux de Node
// un canal par fenêtre, ouvert au premier appel ; ses ports ne retiennent jamais Node (`unref`) et se ferment avec la fenêtre

import { MessageChannel, moveMessagePortToContext, receiveMessageOnPort, type MessagePort } from 'node:worker_threads'

interface ClonePorts { sender: MessagePort, receiver: MessagePort }

// pose `structuredClone` sur la fenêtre ; rend la fermeture de son canal, à appeler quand la fenêtre se ferme
export function provideStructuredClone(window: any): () => void {
  let ports: ClonePorts | undefined
  let closed = false
  window.structuredClone = function structuredClone(...args: any[]): unknown {
    if (args.length === 0) throw new window.TypeError('Failed to execute \'structuredClone\' on \'Window\': 1 argument required, but only 0 present.')
    const [value, options] = args
    // fenêtre déjà fermée (une suite qui tourne encore) : canal d'un seul appel, fermé aussitôt
    const current = ports ?? openPorts(window)
    if (!closed) ports = current
    try {
      try {
        current.sender.postMessage(value, options?.transfer)
      }
      catch (error) {
        throw pageError(window, error)
      }
      return receiveMessageOnPort(current.receiver)!.message
    }
    finally {
      if (closed) closePorts(current)
    }
  }
  return () => {
    closed = true
    if (ports) closePorts(ports)
    ports = undefined
  }
}

function openPorts(window: any): ClonePorts {
  const { port1, port2 } = new MessageChannel()
  const receiver         = moveMessagePortToContext(port2, window)
  port1.unref()
  receiver.unref()
  return { sender: port1, receiver }
}

function closePorts(ports: ClonePorts): void {
  ports.sender.close()
  ports.receiver.close()
}

// un refus de Node devient l'erreur de la page, comme au navigateur : `DOMException` nommée `DataCloneError`, `TypeError` (une liste
// `transfer` qui n'en est pas une), `RangeError` (une structure trop profonde) ; une erreur levée par la page elle-même pendant la copie
// (un accesseur) est de la page : elle sort telle quelle, même nommée `DataCloneError`
function pageError(window: any, error: any): unknown {
  if (error instanceof DOMException && error.name === 'DataCloneError') return new window.DOMException(error.message, 'DataCloneError')
  if (error instanceof TypeError) return new window.TypeError(error.message)
  if (error instanceof RangeError) return new window.RangeError(error.message)
  return error
}
