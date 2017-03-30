var plugin = require('./index')
var PouchDB = require('pouchdb')
var test = require('tape')

PouchDB.plugin(require('pouchdb-adapter-memory'))
PouchDB.plugin(plugin)

function setup () {
  var name = 'Anything_' + Math.random().toString().slice(2)
  var db = new PouchDB(name, { adapter: 'memory' })

  return db
}

function addDocs(db, count) {
  var prs = []
  for (var i = 0; i < count; i++) {
    prs.push(db.put({ _id: 'item_' + i, item: i }))
  }
  return Promise.all(prs)
}


test('defines a name', function (t) {
  var db = setup()
  t.ok(db.syncToAnything, 'defines a syncToAnything function')

  db.destroy()
  t.end()
})

test('dont call the sync function if theres no docs', function (t) {
  var db = setup()
  var replication = db.syncToAnything(function (docs) {
    t.fail('Sync function should not be called!')
  })

  replication.then(function () {
    t.pass('finished replication')
    db.destroy()
    t.end()
  })
})

test('calls the sync function with the docs when there are docs', function (t) {
  var db = setup()
  addDocs(db, 5).then(function () {
    var replication = db.syncToAnything(function (docs) {
      t.equals(docs.length, 5, 'receives the docs')
      replication.cancel()
      db.destroy()
      t.end()
    })
  })
})
