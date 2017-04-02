var PouchDB = require('pouchdb')
PouchDB.plugin(require('../../'))

var replicationId = 'my_replication'
var dbName = 'my-database'
var db = new PouchDB(dbName)


/*
 * this 2 functions
 * creates and updates a bunch
 * of PouchDB docs to generate changes
 */

function randomId() {
  var keys = "1234567890ABCDEF"
  return keys[Math.floor(Math.random() * keys.length)]
}

function createAndUpdateDocs() {
  var pr = Promise.resolve()

  for (var i = 0; i < Math.random() * 100; i++) {
    if (Math.random() > 0.3) {
      pr = pr.then(function () {
        return db.post({ data: 'Auto Generated: ' + i })
      })
      continue;
    }

    pr = pr.then(function () {
      return db.allDocs({ limit: 1, include_docs: true, startkey: randomId() })
        .then(function (res) {
          var doc = res.rows[0] && res.rows[0].doc
          if (doc) {
            console.log('updating', doc._id, doc._rev)
            doc.update = Math.random()
            return db.put(doc)
          }
        })
    })
  }

  return pr
}

/*
 * Check in on the replication status,
 * see if we have synced everything
 */
function isSynced() {
  return Promise.all([
    // get last sync info
    db.get('_local/my_replication')
      .catch(function (err) {
        return { last_seq: 0 }
      }),
    // get db write info
    // we always need to instantiate new PouchDB to get the right info
    new PouchDB(dbName).info()
  ])
  .then(function(res) {
    return res[0].last_seq === res[1].update_seq
  })
}

/*
 * this is a mock sync function
 * that just stores the docIds we got passed
 *
 * normally you would do your server calls in here
 */
function mockSync() {
  var docIds = []
  return db.syncToAnything(function (docs) {
    docIds = docIds.concat(docs.map(function (doc) { return doc._id }))
    return new Promise(function (f, r) {
      setTimeout(f, 500)
    })
  }, { sync_id: replicationId })
    .then(function (res) {
      return { result: res, docs: docIds }
    })
}

function clearDatabase() {
  return db.destroy()
    .then(function () {
      db = new PouchDB(dbName)
      return { destroyed: true }
    })
}

/*
 * Adding DOM Handlers
 */
function getElement(selector) {
  return document.querySelector(selector)
}

function attr(attribute, value, element) {
  element[attribute] = value
}

var buttons = [
  '.js-create-docs',
  '.js-sync-docs',
  '.js-delete-docs'
].map(getElement)
  var lastSync = getElement('.js-last-sync')
  var unSynced = getElement('.js-unsynced-documents')

function lockButtons() {
  buttons.map(attr.bind(null, 'disabled', true))
}

function unlockButtons() {
  buttons.map(attr.bind(null, 'disabled', false))
}

function render(info) {
  return isSynced()
    .then(function (status) {
      if (info && info.docs) {
        lastSync.innerHTML = ''
        info.docs.map(function (id) {
          var li = document.createElement('li')
          li.textContent = id
          lastSync.appendChild(li)
        })
      }

      if (info.destroyed) {
        lastSync.innerHTML = ''
      }

      unSynced.textContent = status ? 'Synced' : 'Not Synced'
    })
}

function lockUnlock (action) {
  lockButtons()
  return action()
    .then(render)
    .then(unlockButtons)
    .catch(unlockButtons)
}

function button (selector, event, handler) {
  document.querySelector(selector).addEventListener(event, function (e) {
    e.preventDefault()
    lockUnlock(handler)
  })
}

button('.js-create-docs', 'click', createAndUpdateDocs)
button('.js-sync-docs', 'click', mockSync)
button('.js-delete-docs', 'click', clearDatabase)

/* init app */
lockUnlock(function () { return Promise.resolve() })
