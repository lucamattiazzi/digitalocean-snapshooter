const dotenv = require('dotenv')
const got = require('got')

dotenv.config()

const { DO_TOKEN, DROPLET_NAME } = process.env
const MAX_SNAPSHOT_VALIDITY = 1000 * 60 * 60 * 24 * 7 // 7 days
const WAIT_TIME = 10
const MAX_WAIT = 10 * 60
const MAX_TRIALS = MAX_WAIT / WAIT_TIME

const headers = {
  authorization: `Bearer ${DO_TOKEN}`,
}

function wait(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

function getDroplets() {
  const url = 'https://api.digitalocean.com/v2/droplets'
  return got.get(url, { headers }).json()
}

async function checkActionCompleted(actionId) {
  const url = `https://api.digitalocean.com/v2/actions/${actionId}`
  let trials = 0
  while (trials < MAX_TRIALS) {
    await wait(WAIT_TIME)
    const response = await got.get(url, { headers }).json()
    const { status } = response.action
    if (status === 'completed') return true
    if (status === 'errored') return false
    trials++
  }
  return false
}

async function runAction(dropletId, type, payload = {}) {
  console.log(`${new Date().toISOString()} - Starting to perform action ${type}`)
  const start = Date.now()
  const url = `https://api.digitalocean.com/v2/droplets/${dropletId}/actions`
  const json = { type, ...payload }
  const results = await got.post(url, { json, headers }).json()
  const actionId = results.action.id
  const success = await checkActionCompleted(actionId)
  const elapsed = Math.round((Date.now() - start) / 1000)
  console.log(
    `${new Date().toISOString()} - Action ${type} ran in ${elapsed} seconds and ended with ${
      success ? 'success' : 'error'
    }`,
  )
  return success
}

async function listAllSnapshots() {
  const url = 'https://api.digitalocean.com/v2/snapshots'
  const { snapshots } = await got.get(url, { headers }).json()
  return snapshots
}

async function deleteSnapshot(snapshotId) {
  const url = `https://api.digitalocean.com/v2/snapshots/${snapshotId}`
  const results = await got.delete(url, { headers }).json()
  return results
}

const shutdownDroplet = dropletId => runAction(dropletId, 'shutdown')
const powerOffDroplet = dropletId => runAction(dropletId, 'power_off')
const powerOnDroplet = dropletId => runAction(dropletId, 'power_on')
const snapshotDroplet = dropletId =>
  runAction(dropletId, 'snapshot', {
    name: new Date().toISOString().slice(0, 10),
  })

async function generateSnapshot() {
  try {
    const { droplets } = await getDroplets()
    const droplet = droplets.find(d => d.name === DROPLET_NAME)
    if (!droplet) throw `Droplet ${DROPLET_NAME} not found`
    await shutdownDroplet(droplet.id)
    await powerOffDroplet(droplet.id)
    await snapshotDroplet(droplet.id)
    await powerOnDroplet(droplet.id)
    const existingSnapshots = await listAllSnapshots()
    const expiredSnapshots = existingSnapshots.filter(ss => {
      const createdAt = Number(new Date(ss.created_at))
      const duration = Date.now() - createdAt
      const snapshotBelongsToDroplet = String(ss.resource_id) === String(droplet.id)
      return snapshotBelongsToDroplet && duration > MAX_SNAPSHOT_VALIDITY
    })
    for (const snapshot of expiredSnapshots) {
      console.log(`${new Date().toISOString()} - Deleting snapshot ${snapshot.name}`)
      await deleteSnapshot(snapshot.id)
    }
  } catch (err) {
    console.error(err)
  }
  return true
}

generateSnapshot().then(process.exit)
