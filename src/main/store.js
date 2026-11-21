'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_SETTINGS = {
  targetMin: 40,
  autoLaunch: false,
  sound: true,
  theme: 'light',
  fontScale: 1,
  floatPos: null
}

function emptyData() {
  return { records: [], session: null, settings: { ...DEFAULT_SETTINGS } }
}

class Store {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'data.json')
    this.data = this.read()
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return {
        records: Array.isArray(parsed.records) ? parsed.records : [],
        session: parsed.session || null,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
      }
    } catch {
      return emptyData()
    }
  }

  save() {
    const tmp = this.file + '.tmp'
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
      return true
    } catch (err) {
      console.error('[store] 写入失败', err.message)
      return false
    }
  }

  get records() { return this.data.records }
  get session() { return this.data.session }
  get settings() { return this.data.settings }

  setSession(session) {
    this.data.session = session
  }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch }
  }

  addRecord(record) {
    this.data.records.push(record)
  }

  updateRecord(id, patch) {
    const rec = this.data.records.find((r) => r.id === id)
    if (rec) Object.assign(rec, patch)
    return rec
  }

  removeRecord(id) {
    const before = this.data.records.length
    this.data.records = this.data.records.filter((r) => r.id !== id)
    return this.data.records.length !== before
  }
}

module.exports = { Store, DEFAULT_SETTINGS }
