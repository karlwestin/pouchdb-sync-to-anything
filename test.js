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

function DocCheck () {
  var checked = []
  return function notSyncedBefore (docs) {
    var newIds = docs.map(function (doc) { return doc._id })
    var intersection = newIds.reduce(function(sum, id) {
      return sum || checked.indexOf(id) !== -1
    }, false)
    checked = checked.concat(newIds)
    return !intersection
  }
}

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
  var callCount = 0
  addDocs(db, 5)
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount++
        t.equals(docs.length, 5, 'receives the docs')
      })
    })
    .then(function () {
        t.equals(callCount, 1, 'Sync function got called')
        db.destroy()
        t.end()
    })
})

test('picks up 2nd replication where the first ended', function (t) {
  var db = setup()
  var callCount2 = 0
  var callCount1 = 0
  var notSyncedBefore = new DocCheck()

  addDocs(db, 5)
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount1++
        t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
        t.equals(docs.length, 5, 'receives first batch of docs')
      })
    })
    .then(addDocs.bind(null, db, 3))
    .then(function () {
      return db.syncToAnything(function (docs) {
        callCount2++
        t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
        t.equals(docs.length, 3, 'receives second batch of docs')
      })
    })
    .then(function () {
      db.destroy()
      t.equals(callCount1, 1, 'calls 1st sync function once')
      t.equals(callCount2, 1, 'only calls 2nd sync function once')
      t.end()
    })
})

test('batches large sync tasks', function (t) {
  var db = setup()
  var callCount = 0
  var batch_size = 5
  var notSyncedBefore = new DocCheck()

  addDocs(db, 11)
    .then(function () {
      return db.syncToAnything(function (docs) {
        t.ok(docs.length <= batch_size && docs.length > 0, 'limits docs to 5, never empty')
        t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
        return Promise.resolve()
      }, {
        batch_size: batch_size
      })
    })
    .then(function () {
      db.destroy()
      t.end()
    })
})


/* Error Handling */
test('Error Handling: Picks up where it left off if sync fails', function (t) {
  var db = setup()

  var batch_size = 5
  var notSyncedBefore = new DocCheck()

  addDocs(db, 10)
    .then(function () {
      var callCount = 0
      return db.syncToAnything(function (docs) {
        callCount++
        if (callCount === 2) {
          t.ok(notSyncedBefore(docs), 'docs in the batch has not been synced before')
          return Promise.reject('write error')
        }

        return Promise.resolve()
      }, {
        batch_size: batch_size
      })
      .then(function () {
        t.fail('first replication should fail')
      })
      .catch(function (err) {
        t.equals(err.result.status, 'aborting', 'sets status to failed')
        t.equals(callCount, 2, 'failed on 2nd call')
      })
    })
    .then(function () {
      var callCount = 0
      return db.syncToAnything(function (docs) {
        if (callCount === 0) {
          t.notOk(notSyncedBefore(docs), 'first set of docs should have been attempted before')
        }

        callCount++
      })
    })
    .then(function (result) {
      t.equals(result.status, 'complete', 'sets status to success')
      t.end()
    })
})
