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
  var prefix = Math.random().toString().slice(2)
  var prs = []
  for (var i = 0; i < count; i++) {
    prs.push(db.put({ _id: `item_${prefix}_${i}`, item: i }))
  }
  return Promise.all(prs)
}

/*
test('defines a name', function (t) {
  var db = setup()
  t.ok(db.syncToAnything, 'defines a syncToAnything function')

  db.destroy()
  t.end()
})

test('doesn\'t call the sync function if there are no docs', function (t) {
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
    db.syncToAnything(function (docs) {
      t.equals(docs.length, 5, 'receives the docs')
      db.destroy()
      t.end()
    })
  })
})
*/

test('picks up 2nd replication where the first ended', function (t) {
  var db = setup()
  var callCount = 0

  addDocs(db, 5)
    .then(function () {
      return db.syncToAnything(function (docs) {
        t.equals(docs.length, 5, 'receives first batch of docs')
      })
    })
    .then(addDocs.bind(null, db, 3))
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount++
        t.equals(docs.length, 3, 'receives second batch of docs')
      })
    })
    .then(function () {
      db.destroy()
      t.equals(callCount, 1, 'only calls 2nd sync function once')
      t.end()
    })
})

test('batches large sync tasks', function (t) {
  var db = setup()
  var callCount = 0

  addDocs(db, 11)
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount++
        if (callCount === 3) {
          t.equals(docs.length, 1, 'receives last batch with 1 doc')
        } else {
          t.equals(docs.length, 5, 'receives 5 docs in a batch')
        }

        return Promise.resolve()
      }, {
        batch_size: 5
      })
    })
    .then(function () {
      db.destroy()
      t.equals(callCount, 3, 'sync function called 3 times')
      t.end()
    })
})
