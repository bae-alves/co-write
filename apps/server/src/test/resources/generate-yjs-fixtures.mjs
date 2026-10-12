// Regenerates yjs-fixtures.json: real Yjs v1 updates with the state vectors Yjs itself computes,
// so the server's parser is tested against the reference implementation.
//
//   cd apps/desktop && node ../server/src/test/resources/generate-yjs-fixtures.mjs
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const Y = createRequire(`${process.cwd()}/`)('yjs')
const hex = (bytes) => Buffer.from(bytes).toString('hex')
const stateVector = (update) =>
  Object.fromEntries(
    [...Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update))].map(([c, k]) => [String(c), k]),
  )
/** The furthest clock any (non-skip) struct of each client reaches, contiguous or not. */
const highWaterMarks = (update) => {
  const marks = {}
  for (const struct of Y.decodeUpdate(update).structs) {
    if (struct.constructor.name === 'Skip') continue
    const end = struct.id.clock + struct.length
    marks[struct.id.client] = Math.max(marks[struct.id.client] ?? 0, end)
  }
  return marks
}
const fixture = (name, update) => ({
  name,
  update: hex(update),
  stateVector: stateVector(update),
  highWaterMarks: highWaterMarks(update),
})

const fixtures = []
const doc = new Y.Doc()
doc.clientID = 1
const updates = []
doc.on('update', (u) => updates.push(u))

const text = doc.getText('content')
text.insert(0, '# Title\n\nHello 🐺 wörld\n')
text.format(0, 7, { bold: true })
text.insertEmbed(3, { image: 'x.png' })
text.delete(10, 4)
fixtures.push(fixture('text with emoji, format, embed, delete', Y.encodeStateAsUpdate(doc)))

const map = doc.getMap('meta')
map.set('base', 'disk text')
map.set('n', 42)
map.set('f', 1.5)
map.set('big', -123456789012)
map.set('flags', [true, false, null])
map.set('nested', { a: { b: ['c', 7] } })
map.set('bytes', new Uint8Array([1, 2, 3]))
map.set('base', 'overwritten') // the old value becomes deleted content
const array = doc.getArray('list')
array.insert(0, [1, 'two', { three: 3 }])
array.insert(0, [new Y.Map(), new Y.Text('inner')])
const xml = doc.getXmlFragment('xml')
xml.insert(0, [new Y.XmlElement('p'), new Y.XmlText('hi')])
array.insert(0, [new Y.Doc({ guid: 'sub-doc' })])
fixtures.push(fixture('every content kind', Y.encodeStateAsUpdate(doc)))
fixtures.push(fixture('a single incremental update', updates[updates.length - 1]))

// Two clients: B has edits A has not seen.
const other = new Y.Doc()
other.clientID = 2
Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
other.getText('content').insert(0, 'B was here ')
fixtures.push(fixture('two clients', Y.encodeStateAsUpdate(other)))
fixtures.push(fixture('empty document', Y.encodeStateAsUpdate(new Y.Doc())))

// Deleted content is garbage-collected into GC structs once the transaction ends.
const gc = new Y.Doc()
gc.clientID = 3
gc.getText('content').insert(0, 'temporary text')
gc.getText('content').delete(0, 9)
fixtures.push(fixture('garbage collected', Y.encodeStateAsUpdate(gc)))

// Merged updates with a gap contain a Skip struct.
const gap = new Y.Doc()
gap.clientID = 4
const gapUpdates = []
gap.on('update', (u) => gapUpdates.push(u))
gap.getText('content').insert(0, 'a')
gap.getText('content').insert(1, 'b')
gap.getText('content').insert(2, 'c')
const skip = Y.mergeUpdates([gapUpdates[0], gapUpdates[2]])
fixtures.push({ ...fixture('merged update with a gap (Skip)', skip), hasSkip: true })

// A room: ana types twice; bo syncs, goes offline and types; ana types again.
const ana = new Y.Doc()
ana.clientID = 10
const anaUpdates = []
ana.on('update', (u) => anaUpdates.push(u))
ana.getText('content').insert(0, 'one')
ana.getText('content').insert(3, ' two')
fixtures.push(fixture('room: ana 1', anaUpdates[0]))
fixtures.push(fixture('room: ana 2', anaUpdates[1]))
fixtures.push(fixture('room: ana full', Y.encodeStateAsUpdate(ana)))
const bo = new Y.Doc()
bo.clientID = 11
Y.applyUpdate(bo, Y.encodeStateAsUpdate(ana))
bo.getText('content').insert(0, 'zero ')
fixtures.push(fixture('room: bo full', Y.encodeStateAsUpdate(bo)))
ana.getText('content').insert(7, ' three')
fixtures.push(fixture('room: ana 3', anaUpdates[2]))

const out = new URL('./yjs-fixtures.json', import.meta.url)
writeFileSync(out, `${JSON.stringify(fixtures, null, 2)}\n`)
console.log(`wrote ${fixtures.length} fixtures to ${out.pathname}`)
