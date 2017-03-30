var EE = require('events').EventEmitter
var inherits = require('inherits')

inherits(Replicator, EE)

function Replicator(db) {
  EE.call(this)
  var replicator = this
  var promise = new Promise(function (fullfill, reject) {
    replicator.once('complete', fullfill)
    replicator.once('error', reject)
  })

  this.then = function then (resolve, reject) {
    return promise.then(resolve, reject)
  }

  this.cancel = function cancel () {
    replicator.cancelled = true
  }

  return this
}

function sync (syncer, opts) {
  opts = opts || {}
  var db = this
  var id = 'my-replication-id'
  var returnValue = new Replicator(db)
  var batch_size = opts.batch_size || 100
  var changesOpts = {}
  var currentBatch

  var pendingBatch = {
    changes: [],
    seq: 0,
    docs: []
  }
  var batches = []

  function complete () {
    returnValue.emit('complete')
  }

  function getChange (change) {
    return db.get(change.id)
  }

  function getBatchDocs () {
    return Promise.all(currentBatch.changes.map(getChange))
  }

  function writeDocs(docs) {
    if (!docs.length) {
      return Promise.resolve()
    }
    return syncer(docs)
  }

  function startNextBatch () {
    currentBatch = batches.shift()
    if (!currentBatch) {
      return complete()
    }

    getBatchDocs()
      .then(writeDocs)
      .then(startNextBatch)
  }

  function processPendingBatch () {
    batches.push(pendingBatch)
    pendingBatch = {
      changes: [],
      seq: 0,
      docs: []
    }

    startNextBatch()
  }

  function onChange (change) {
    pendingBatch.seq = change.seq
    pendingBatch.changes.push(change)
  }

  function onChangesComplete (changes) {
    changesOpts.since = changes.last_seq
    processPendingBatch()
  }

  function getChanges () {
    // TODO: cancel when replication is aborted
    var changes = db.changes(changesOpts)
    changes.on('change', onChange)
    changes.then(onChangesComplete)
  }

  function startChanges () {
    changesOpts = {
      since: 0,
      limit: batch_size,
      style: 'main_only', // only get winning revisions
      return_docs: true
    }

    getChanges()
  }

  startChanges()

  return returnValue
}

module.exports = {
  syncToAnything: sync
}
